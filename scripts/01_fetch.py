"""Stage 01 — acquire FEC bulk data.

A manifest of {url, sha256, size, timestamp} keyed by filename, resumable
downloads, and an acceptance check that exits nonzero. The reusable parts live
in _fetch.py; what stays here is what is specific to FEC data.

Three things here are FEC-specific and are the reason this is not a generic
downloader:

1. **`itcont.txt` is never extracted.** Each indivYY.zip contains itcont.txt
   *plus* a byte-identical `by_date/` re-slicing of the same rows — measured:
   for 2024 both sum to 11,040,734,781 bytes. A naive `unzip` therefore writes
   20.6 GB, and the build machine has ~17 GB free. Read it with
   `_fetch.stream_member()`; it never lands on disk.

2. **The individual file is opt-in** (`--with-individuals`). The PAC core —
   cn, cm, ccl, pas2, weball — is 26 MB zipped and is all that Phases 1-2 need.
   indiv is 3.95 GB (2024) + 2.04 GB (2026).

3. **Every file in headers/ must appear in the manifest.** This is not
   bookkeeping. A hand-written `weball_header_file.csv` once sat in that
   directory alongside the real downloads, five minutes newer and byte-
   identical to `fec_layouts.WEBALL` — and any schema gate that globs
   `headers/*.csv` would have compared WEBALL against a copy of WEBALL and
   passed tautologically. FEC publishes no header file for weball/webk/webl;
   those layouts live in fec_layouts.py and are gated structurally against the
   data instead (see 02_normalize.py).
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _fetch
from _db import CYCLES, FEC, HEADERS_DIR, MANIFEST_PATH
from _report import Report, fmt_int

BULK = "https://www.fec.gov/files/bulk-downloads"

#: (prefix, member_to_extract). `None` means either "single-member archive,
#: take whatever is in it" (weball, whose member name varies by cycle) or
#: "stream-only, do not expand" (oth, indiv).
PAC_CORE = [
    ("cn", "cn.txt"),
    ("cm", "cm.txt"),
    ("ccl", "ccl.txt"),
    ("pas2", "itpas2.txt"),
    ("weball", None),      # member name varies by cycle; resolved at extract
    ("oth", None),         # 3.28 GB extracted for 2024 — stream it
]
INDIVIDUALS = [("indiv", None)]

#: Plain CSVs, not zipped, with their column names in a real header row —
#: unlike every pipe-delimited bulk file above, which ships headerless.
#: Fetched so that 02_normalize can assert a schema contract against it.
#: NOT loaded into any table yet: independent expenditures are Phase 4 display
#: work, and this bulk file (73,449 rows for 2024) is a *narrower universe*
#: than the OpenFEC schedule_e endpoint (156,863). They are not interchangeable.
LOOSE_CSVS = [("independent_expenditure_{cycle}.csv", "{cycle}")]

#: FEC publishes these. weball/webk/webl 404 — see the module docstring.
HEADER_FILES = ("cn", "cm", "ccl", "pas2", "indiv", "oth", "oppexp")

#: Stage fails below this. Every file named above must land, because a missing
#: dimension file does not error downstream — it silently drops candidates.
MIN_MANIFEST_ENTRIES = (
    len(CYCLES) * (len(PAC_CORE) + len(LOOSE_CSVS)) + len(HEADER_FILES)
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--with-individuals", action="store_true",
                    help="also fetch indivYY.zip (3.95 GB for 2024). Not needed "
                         "for the PAC core; only the aggregate-only path uses it.")
    args = ap.parse_args()

    os.makedirs(HEADERS_DIR, exist_ok=True)
    manifest = _fetch.Manifest(MANIFEST_PATH)

    wanted = list(PAC_CORE) + (INDIVIDUALS if args.with_individuals else [])
    fetched, skipped = [], []

    for name in HEADER_FILES:
        key = f"headers/{name}_header_file.csv"
        dest = os.path.join(HEADERS_DIR, f"{name}_header_file.csv")
        url = f"{BULK}/data_dictionaries/{name}_header_file.csv"
        print(f"  {key}")
        (fetched if _fetch.download(url, dest, manifest, key)
         else skipped).append(key)
        manifest.save()

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
            (fetched if _fetch.download(f"{BULK}/{cycle}/{fname}", dest,
                                        manifest, key)
             else skipped).append(key)
            manifest.save()
            if member is not None or prefix == "weball":
                got = _fetch.extract_member(dest, member, outdir)
                if got:
                    extracted[key] = got

        for template, _ in LOOSE_CSVS:
            fname = template.format(cycle=cycle)
            key = f"{cycle}/{fname}"
            dest = os.path.join(outdir, fname)
            print(f"  {key}")
            (fetched if _fetch.download(f"{BULK}/{cycle}/{fname}", dest,
                                        manifest, key)
             else skipped).append(key)
            manifest.save()

    # ---- acceptance -------------------------------------------------------
    missing = [k for k, v in manifest.items()
               if not os.path.exists(os.path.join(FEC, k))
               or os.path.getsize(os.path.join(FEC, k)) != v["size"]]

    # Every file sitting in headers/ must be something we downloaded and
    # recorded. See the module docstring: an unmanifested file there is
    # indistinguishable by name from a published contract.
    on_disk = {f for f in os.listdir(HEADERS_DIR) if f.endswith(".csv")}
    manifested = {os.path.basename(k) for k in manifest if k.startswith("headers/")}
    unmanifested = sorted(on_disk - manifested)

    total = sum(e["size"] for e in manifest.values())
    report = Report("01_fetch", "Stage 01 — fetch FEC bulk data")
    report.kv("Cycles", ", ".join(str(c) for c in CYCLES))
    report.kv("Individual contributions included", str(args.with_individuals))

    report.section("Objects")
    report.table(["object", "bytes", "sha256"],
                 [(f"`{k}`", fmt_int(manifest[k]["size"]),
                   f"`{manifest[k]['sha256'][:16]}…`") for k in sorted(manifest)])
    report.para(f"Total downloaded: **{total / 2**30:.2f} GB**")

    report.section("Extracted members")
    report.table(["archive", "member", "bytes"],
                 [(f"`{k}`", f"`{os.path.relpath(p, FEC)}`",
                   fmt_int(os.path.getsize(p)))
                  for k, p in sorted(extracted.items())])
    report.para(
        "`itcont.txt` is deliberately absent: indivYY.zip carries a "
        "byte-identical `by_date/` copy, so extracting it writes 20.6 GB on a "
        "machine with ~17 GB free. Read it with `_fetch.stream_member()`.")

    report.check("manifest entries", len(manifest) >= MIN_MANIFEST_ENTRIES,
                 f"{len(manifest)} (minimum {MIN_MANIFEST_ENTRIES})")
    report.check("on-disk size agrees with manifest", not missing,
                 f"{len(missing)} mismatch(es)"
                 + (f": {missing[:5]}" if missing else ""))
    report.check("no unmanifested file in headers/", not unmanifested,
                 f"{unmanifested}" if unmanifested
                 else "every headers/*.csv is a recorded download")

    print(f"\n{len(fetched)} fetched, {len(skipped)} already current, "
          f"{total / 2**30:.2f} GB total")
    return report.write()


if __name__ == "__main__":
    sys.exit(main())
