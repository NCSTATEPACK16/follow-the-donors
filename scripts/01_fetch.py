"""Stage 01 — acquire FEC bulk data.

Follows follow-the-ppp/scripts/01_fetch.py: a manifest of
{url, sha256, size, timestamp} keyed by filename, resumable downloads, and an
acceptance check that exits nonzero.

Two things here are specific to FEC data and are the reason this is not a
generic downloader:

1. **`itcont.txt` is never extracted.** Each indivYY.zip contains itcont.txt
   *plus* a byte-identical `by_date/` re-slicing of the same rows — measured:
   for 2024 both sum to 11,040,734,781 bytes. A naive `unzip` therefore writes
   20.6 GB, and the build machine has ~17 GB free. The member is streamed by
   `stream_member()` instead; it never lands on disk.

2. **The individual file is opt-in** (`--with-individuals`). The PAC core —
   cn, cm, ccl, pas2, weball — is 26 MB zipped and is all that Phases 1-2 need.
   indiv is 3.95 GB (2024) + 2.04 GB (2026) and is only needed for the
   aggregate-only individual path.
"""

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEC = os.path.join(REPO, "data", "raw", "fec")
HEADERS_DIR = os.path.join(FEC, "headers")
MANIFEST_PATH = os.path.join(FEC, "MANIFEST.json")

BULK = "https://www.fec.gov/files/bulk-downloads"
#: r2.dev 403s the default Python-urllib UA; FEC is friendlier but identify
#: ourselves anyway so a maintainer can see who is pulling 4 GB.
UA = "follow-the-donors/0.1 (static campaign finance map; contact via repo)"

CYCLES = (2024, 2026)

#: (prefix, member_to_extract). A member of None means stream-only: the file
#: is downloaded but never expanded, because expanding it would not fit.
PAC_CORE = [
    ("cn", "cn.txt"),
    ("cm", "cm.txt"),
    ("ccl", "ccl.txt"),
    ("pas2", "itpas2.txt"),
    ("weball", None),      # member name varies by cycle; resolved at extract
    ("oth", None),         # 3.28 GB extracted for 2024 — stream it
]
INDIVIDUALS = [("indiv", None)]

#: FEC publishes these; weball/webk/webl do not exist and live in fec_layouts.py
HEADER_FILES = ("cn", "cm", "ccl", "pas2", "indiv", "oth", "oppexp")

#: Stage fails below this. Every file named above must land, because a missing
#: dimension file does not error downstream — it silently drops candidates.
MIN_MANIFEST_ENTRIES = len(CYCLES) * len(PAC_CORE) + len(HEADER_FILES)


def load_manifest():
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH) as fh:
            return json.load(fh)
    return {}


def save_manifest(m):
    with open(MANIFEST_PATH, "w") as fh:
        json.dump(m, fh, indent=2, sort_keys=True)


def _open(url, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    return urllib.request.urlopen(req, timeout=120)


def remote_size(url):
    """Content-Length via HEAD. None when the server won't say."""
    try:
        req = urllib.request.Request(url, method="HEAD",
                                     headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as resp:
            n = resp.headers.get("Content-Length")
            return int(n) if n is not None else None
    except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError):
        return None


def download(url, dest, manifest, key):
    """Resumable download. Skips when the manifest size matches what's on disk.

    The HEAD comes first deliberately. Resuming blind from the local file size
    asks for `Range: bytes=N-` where N is already EOF, and the server answers
    416 rather than "you're done" — which is how a fully-downloaded file with
    no manifest entry (a fresh clone, an interrupted manifest write) turns into
    a hard failure instead of a no-op.
    """
    entry = manifest.get(key)
    have = os.path.getsize(dest) if os.path.exists(dest) else 0
    if entry and have == entry.get("size"):
        return False

    total = remote_size(url)
    if total is not None and have > total:
        # Local file is longer than the source: a truncated resume target or a
        # changed upstream file. Start over rather than append to garbage.
        os.remove(dest)
        have = 0

    if total is None or have < total:
        for attempt in range(5):
            try:
                headers = {"Range": f"bytes={have}-"} if have else {}
                with _open(url, headers) as resp:
                    mode = "ab" if have and resp.status == 206 else "wb"
                    if mode == "wb":
                        have = 0
                    with open(dest, mode) as fh:
                        while chunk := resp.read(1 << 20):
                            fh.write(chunk)
                break
            except urllib.error.HTTPError as exc:
                if exc.code == 416 and os.path.exists(dest):
                    break  # already complete; fall through to hashing
                if attempt == 4:
                    raise
                print(f"    retry {attempt + 1} after HTTP {exc.code}")
                time.sleep(2 ** attempt)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                if attempt == 4:
                    raise
                print(f"    retry {attempt + 1} after {exc}")
                time.sleep(2 ** attempt)

    h = hashlib.sha256()
    with open(dest, "rb") as fh:
        while chunk := fh.read(1 << 20):
            h.update(chunk)
    manifest[key] = {
        "url": url,
        "sha256": h.hexdigest(),
        "size": os.path.getsize(dest),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    return True


def extract_member(zip_path, member, dest_dir):
    """Extract exactly one member. Never `extractall`: see the by_date/ note."""
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        if member is None:
            # Single-member archives (weball) name their member by cycle.
            candidates = [n for n in names if not n.endswith("/")]
            if len(candidates) != 1:
                return None
            member = candidates[0]
        if member not in names:
            return None
        out = os.path.join(dest_dir, os.path.basename(member))
        if os.path.exists(out) and os.path.getsize(out) == zf.getinfo(member).file_size:
            return out
        with zf.open(member) as src, open(out, "wb") as dst:
            while chunk := src.read(1 << 20):
                dst.write(chunk)
        return out


def stream_member(zip_path, member):
    """Yield decoded lines of a zip member without materialising it on disk.

    This is how itcont.txt (10.28 GB) is read on a machine with 17 GB free.
    """
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open(member) as fh:
            trailing = b""
            while chunk := fh.read(1 << 22):
                lines = (trailing + chunk).split(b"\n")
                trailing = lines.pop()
                for line in lines:
                    yield line.decode("utf-8", errors="replace")
            if trailing:
                yield trailing.decode("utf-8", errors="replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-individuals", action="store_true",
                    help="also fetch indivYY.zip (3.95 GB for 2024). Not needed "
                         "for the PAC core; only the aggregate-only path uses it.")
    args = ap.parse_args()

    os.makedirs(HEADERS_DIR, exist_ok=True)
    manifest = load_manifest()

    wanted = list(PAC_CORE) + (INDIVIDUALS if args.with_individuals else [])
    fetched, skipped = [], []

    for name in HEADER_FILES:
        key = f"headers/{name}_header_file.csv"
        dest = os.path.join(HEADERS_DIR, f"{name}_header_file.csv")
        url = f"{BULK}/data_dictionaries/{name}_header_file.csv"
        print(f"  {key}")
        (fetched if download(url, dest, manifest, key) else skipped).append(key)
        save_manifest(manifest)

    extracted = {}
    for cycle in CYCLES:
        outdir = os.path.join(FEC, str(cycle))
        os.makedirs(outdir, exist_ok=True)
        yy = str(cycle)[2:]
        for prefix, member in wanted:
            fname = f"{prefix}{yy}.zip"
            key = f"{cycle}/{fname}"
            dest = os.path.join(outdir, fname)
            print(f"  {key}")
            (fetched if download(f"{BULK}/{cycle}/{fname}", dest, manifest, key)
             else skipped).append(key)
            save_manifest(manifest)
            if member is not None or prefix == "weball":
                got = extract_member(dest, member, outdir)
                if got:
                    extracted[key] = got

    # ---- acceptance -------------------------------------------------------
    missing = [k for k, v in manifest.items()
               if not os.path.exists(os.path.join(FEC, k))
               or os.path.getsize(os.path.join(FEC, k)) != v["size"]]
    ok = len(manifest) >= MIN_MANIFEST_ENTRIES and not missing

    os.makedirs(os.path.join(REPO, "reports"), exist_ok=True)
    lines = ["# Stage 01 Fetch Report", "",
             f"Cycles: {', '.join(str(c) for c in CYCLES)}",
             f"Individual contributions included: {args.with_individuals}", "",
             "| object | bytes | sha256 |", "|---|---|---|"]
    for k in sorted(manifest):
        e = manifest[k]
        lines.append(f"| `{k}` | {e['size']:,} | `{e['sha256'][:16]}…` |")
    total = sum(e["size"] for e in manifest.values())
    lines += ["", f"Total downloaded: **{total / 2**30:.2f} GB**", "",
              "## Extracted members", ""]
    for k, p in sorted(extracted.items()):
        lines.append(f"- `{k}` -> `{os.path.relpath(p, REPO)}` "
                     f"({os.path.getsize(p):,} bytes)")
    lines += ["",
              "`itcont.txt` is deliberately absent: indivYY.zip carries a",
              "byte-identical `by_date/` copy, so extracting it writes 20.6 GB on",
              "a machine with ~17 GB free. Read it with `stream_member()`.", "",
              "## Acceptance", "",
              f"- Manifest entries: {len(manifest)} (minimum {MIN_MANIFEST_ENTRIES})",
              f"- Files whose on-disk size disagrees with the manifest: {len(missing)}",
              f"- Result: {'PASS' if ok else 'FAIL'}"]
    with open(os.path.join(REPO, "reports", "01_fetch.md"), "w") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"\n{len(fetched)} fetched, {len(skipped)} already current, "
          f"{total / 2**30:.2f} GB total")
    if not ok:
        print(f"FAIL: {len(manifest)} manifest entries, {len(missing)} size mismatches",
              file=sys.stderr)
        return 1
    print("wrote reports/01_fetch.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
