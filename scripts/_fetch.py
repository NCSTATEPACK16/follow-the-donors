"""Resumable downloads with a sha256 manifest.

Lifted out of 01_fetch.py when the district spike became the third caller.
The manifest is the reason this is not two lines of urlretrieve: it makes a
re-run a no-op, which is what "every stage is idempotent" actually costs.

The HEAD in download() comes first deliberately. Resuming blind from the local
file size asks for `Range: bytes=N-` where N is already EOF, and the server
answers **416** rather than "you're done" — which is how a fully-downloaded
file with no manifest entry (a fresh clone, an interrupted manifest write)
turns into a hard failure instead of a no-op. Do not remove it.
"""

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
import zipfile

#: Identify ourselves. r2.dev 403s the default Python-urllib UA, and a
#: maintainer at fec.gov or census.gov deserves to see who is pulling 4 GB.
UA = "follow-the-donors/0.1 (static campaign finance map; contact via repo)"


class Manifest(dict):
    """A {key: {url, sha256, size, timestamp}} map that persists to JSON."""

    def __init__(self, path):
        super().__init__()
        self.path = path
        if os.path.exists(path):
            with open(path) as fh:
                self.update(json.load(fh))

    def save(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w") as fh:
            json.dump(self, fh, indent=2, sort_keys=True)


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


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def download(url, dest, manifest, key):
    """Resumable download. Returns True when bytes moved, False when current."""
    entry = manifest.get(key)
    have = os.path.getsize(dest) if os.path.exists(dest) else 0
    if entry and have == entry.get("size"):
        return False

    os.makedirs(os.path.dirname(dest), exist_ok=True)
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

    manifest[key] = {
        "url": url,
        "sha256": sha256_file(dest),
        "size": os.path.getsize(dest),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    return True


def extract_member(zip_path, member, dest_dir):
    """Extract exactly one member. Never `extractall`.

    The FEC individual-contribution archive carries a byte-identical `by_date/`
    re-slicing alongside itcont.txt, so extractall writes 20.6 GB on a machine
    with ~17 GB free. Census shapefile archives are equally happy to spray a
    dozen sidecar files. One member, named, every time.

    `member=None` means "the archive has exactly one file, take it" — weball's
    member name varies by cycle.
    """
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        if member is None:
            candidates = [n for n in names if not n.endswith("/")]
            if len(candidates) != 1:
                return None
            member = candidates[0]
        if member not in names:
            return None
        out = os.path.join(dest_dir, os.path.basename(member))
        if os.path.exists(out) and os.path.getsize(out) == zf.getinfo(member).file_size:
            return out
        os.makedirs(dest_dir, exist_ok=True)
        with zf.open(member) as src, open(out, "wb") as dst:
            while chunk := src.read(1 << 20):
                dst.write(chunk)
        return out


def extract_all_members(zip_path, dest_dir, suffixes):
    """Extract every member whose name ends in one of `suffixes`.

    A shapefile is irreducibly several files (.shp needs .dbf, .shx, .prj), so
    this is the one case where taking more than one member is correct.
    """
    out = []
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if name.endswith("/") or not name.lower().endswith(tuple(suffixes)):
                continue
            dst_path = os.path.join(dest_dir, os.path.basename(name))
            if not (os.path.exists(dst_path)
                    and os.path.getsize(dst_path) == zf.getinfo(name).file_size):
                os.makedirs(dest_dir, exist_ok=True)
                with zf.open(name) as src, open(dst_path, "wb") as dst:
                    while chunk := src.read(1 << 20):
                        dst.write(chunk)
            out.append(dst_path)
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


def load_env(path=None):
    """Populate os.environ from a .env file. Existing values always win.

    Same shape as follow-the-ppp's loader. Credentials live here and nowhere
    else: .env is gitignored, and nothing read through this ever reaches a
    published artifact.
    """
    if path is None:
        path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if not os.path.exists(path):
        return
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())
