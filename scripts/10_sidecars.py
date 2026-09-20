"""Stage 10 — sidecars and the generation manifest.

Four small files that round out what the frontend needs beyond the district
and state geometry: a search index, a national ZIP crosswalk, national
stats, and `generation.json` — the one artifact that is NOT versioned and
may be overwritten in place (1-hour cache), because it is the manifest that
tells the frontend which versioned filenames to ask for. Every other
artifact this pipeline writes is immutable; a corrected one takes a new name.

`zip-districts-v1.json` is not per-cycle: `zip_districts` and
`zip3_districts` carry no `cycle` column (ZIP-to-district geometry does not
change with a filing cycle, only redistricting does, and that is already
captured in `map_status` on each row).
"""

import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _artifacts as A
import _districts as D
import _sidecars as S
from _db import CYCLES, DATA, connect, table_exists
from _report import Report, fmt_int, fmt_money, fmt_pct

ARTIFACTS = os.path.join(DATA, "artifacts")
DISTRICTS_DIR = os.path.join(ARTIFACTS, "districts")

#: A ZIP known (queried 2026-09-19) to resolve BOTH ways with different
#: district sets — the exact answer is {3401, 3402}, the prefix answer for
#: its 080 neighbourhood is {3401, 3402, 3403}. Used to assert the two are
#: distinguishable in the artifact, not just present.
KNOWN_DUAL_ZIP = "08062"
KNOWN_DUAL_ZIP3 = "080"


def build_search(con, cycle):
    district_rows = con.execute(f"""
        SELECT district_geoid, state_usps, cd, district_name
        FROM district_totals_{cycle} ORDER BY district_geoid
    """).fetchall()
    candidate_rows = con.execute(f"""
        SELECT district_geoid, cand_id, cand_name, cand_party
        FROM candidate_totals_{cycle}
        WHERE bucket = 'district'
    """).fetchall()
    index = S.build_search_index(district_rows, candidate_rows)
    path = os.path.join(ARTIFACTS, f"search-{cycle}-v1.json")
    with open(path, "w") as fh:
        json.dump(index, fh, separators=(",", ":"))
    return index, path


def build_zip_crosswalk(con):
    exact_rows = con.execute("""
        SELECT zip5, district_geoid, overlap_share, is_primary, resolution
        FROM zip_districts
    """).fetchall()
    prefix_rows = con.execute("""
        SELECT zip3, district_geoid, supporting_zips, resolution
        FROM zip3_districts
    """).fetchall()
    crosswalk = S.build_zip_crosswalk(exact_rows, prefix_rows)
    path = os.path.join(ARTIFACTS, "zip-districts-v1.json")
    with open(path, "w") as fh:
        json.dump(crosswalk, fh, separators=(",", ":"))
    return crosswalk, path


def build_stats(con, cycle):
    """National figures a district page does not already carry: counts
    (districts, candidates, donor committees), the national sector mix
    (independently aggregated from district_sector, not read back from
    stage 07's or 09's files), and a Senate summary. Everything a district
    or state ALREADY carries — dollars, map_status counts, party split,
    reconciliation — lives in meta-{cycle}-v1.json and is not repeated here.
    """
    districts_total, districts_with_money = con.execute(f"""
        SELECT count(*), count(*) FILTER (WHERE pac_dollars > 0)
        FROM district_totals_{cycle}
    """).fetchone()
    candidates = con.execute(f"""
        SELECT count(DISTINCT cand_id) FROM candidate_totals_{cycle}
        WHERE bucket = 'district'
    """).fetchone()[0]
    donor_committees = con.execute(f"""
        SELECT count(DISTINCT donor_cmte_id) FROM attribution_{cycle}
        WHERE bucket = 'district'
    """).fetchone()[0]

    sector_rows = con.execute(f"""
        SELECT sector, SUM(pac_dollars) FROM district_sector_{cycle}
        GROUP BY 1
    """).fetchall()
    sector_cents = [[sector, A.dollars_to_cents(dollars)]
                     for sector, dollars in sector_rows]
    national_sectors = A.fold_sectors_to_top5(sector_cents)

    senate_states, senate_total_dollars = con.execute(f"""
        SELECT count(DISTINCT a.office_st), SUM(a.amount)
        FROM attribution_{cycle} a
        WHERE a.bucket = 'statewide' AND a.office = 'S'
    """).fetchone()

    stats = {
        "cycle": str(cycle),
        "districts": int(districts_total),
        "districts_with_money": int(districts_with_money),
        "candidates": int(candidates),
        "donor_committees": int(donor_committees),
        "national_sectors": national_sectors,
        "senate": {
            "states_with_money": int(senate_states),
            "total_cents": A.dollars_to_cents(senate_total_dollars),
        },
    }
    path = os.path.join(ARTIFACTS, f"stats-{cycle}-v1.json")
    with open(path, "w") as fh:
        json.dump(stats, fh, indent=2)
    return stats, path


def versioned_artifact_paths(cycles):
    """{published filename: path on disk} for every versioned artifact
    stage 07, 09 and 10 produce, EXCLUDING the 441-per-cycle district pages
    — those are named by a pattern (see district_page_manifest) rather than
    enumerated 882 times over."""
    paths = {}
    for cycle in cycles:
        cycle_s = str(cycle)
        for name in (f"districts-{cycle_s}-v1.geojson",
                     f"states-{cycle_s}-v1.geojson",
                     f"sectors-{cycle_s}-v1.json",
                     f"senate-{cycle_s}-v1.json",
                     f"meta-{cycle_s}-v1.json",
                     f"search-{cycle_s}-v1.json",
                     f"stats-{cycle_s}-v1.json"):
            paths[name] = os.path.join(ARTIFACTS, name)
    paths["zip-districts-v1.json"] = os.path.join(ARTIFACTS, "zip-districts-v1.json")
    return paths


def district_page_manifest(con, cycles):
    """A pattern + count + geoid list rather than 882 literal filenames.

    The geoid list (882 short strings, ~10 KB) lets the frontend construct
    every district page URL without a directory listing or a second fetch,
    while `directory` + `pattern` keep the manifest from having to spell out
    every one of 882 relative paths individually.
    """
    out = {"directory": "districts", "pattern": "{geoid}-{cycle}-v1.json",
           "cycles": {}}
    for cycle in cycles:
        cycle_s = str(cycle)
        geoids = [row[0] for row in con.execute(
            f"SELECT district_geoid FROM district_totals_{cycle} "
            "ORDER BY district_geoid").fetchall()]
        out["cycles"][cycle_s] = {"count": len(geoids), "geoids": geoids}
    return out


def build_generation_manifest(con, cycles, reconciliation):
    artifact_paths = versioned_artifact_paths(cycles)
    manifest = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
            .isoformat(timespec="seconds"),
        "cycles": {
            str(c): {"filing_period": A.FILING_PERIOD[str(c)]}
            for c in cycles
        },
        "reconciliation": reconciliation,
        # Relative path, not absolute: this file is read by the frontend
        # over HTTP from wherever the artifact set is served, not from this
        # machine's filesystem.
        "artifacts": {name: name for name in artifact_paths},
        "district_pages": district_page_manifest(con, cycles),
    }
    path = os.path.join(ARTIFACTS, "generation.json")
    with open(path, "w") as fh:
        json.dump(manifest, fh, indent=2)
    return manifest, path, artifact_paths


def main():
    t0 = time.time()
    os.makedirs(ARTIFACTS, exist_ok=True)
    con = connect(read_only=True)

    if not table_exists(con, "district_totals_2024"):
        print("district_totals_2024 missing — run scripts/06_aggregate.py first")
        return 1
    dist_2024 = os.path.join(ARTIFACTS, "districts-2024-v1.geojson")
    if not os.path.exists(dist_2024):
        print(f"{dist_2024} missing — run scripts/07_artifacts.py first")
        return 1

    r = Report("10_sidecars", "Stage 10 — sidecars and the generation manifest")
    r.kv("Cycles", ", ".join(str(c) for c in CYCLES))

    active_cycles = [c for c in CYCLES if table_exists(con, f"district_totals_{c}")]
    reconciliation = {}
    search_by_cycle = {}

    for cycle in active_cycles:
        cycle_s = str(cycle)
        print(f"  {cycle}…")
        index, search_path = build_search(con, cycle)
        stats, stats_path = build_stats(con, cycle)
        search_by_cycle[cycle_s] = index

        computed, reported = con.execute(f"""
            SELECT SUM(computed), SUM(reported) FROM reconciliation_{cycle}
        """).fetchone()
        rel = (float(computed) - float(reported)) / float(reported)
        reconciliation[cycle_s] = {
            "computed": float(computed), "reported": float(reported),
            "relative": rel,
        }

        r.section(f"{cycle_s}")
        r.para(
            f"Search index: {fmt_int(len(index))} districts. "
            f"Stats: {fmt_int(stats['candidates'])} candidates, "
            f"{fmt_int(stats['donor_committees'])} donor committees, "
            f"reconciliation {rel:+.2%}.")
        r.table(["artifact", "size"], [
            (os.path.basename(p), f"{os.path.getsize(p)/1e3:.1f} KB")
            for p in (search_path, stats_path)
        ])

    crosswalk, zip_path = build_zip_crosswalk(con)
    zip5_rows = sum(len(v) for v in crosswalk["by_zip5"].values())
    zip3_rows = sum(len(v) for v in crosswalk["by_zip3"].values())

    r.section("ZIP crosswalk")
    r.para(
        f"{fmt_int(len(crosswalk['by_zip5']))} exact ZIPs "
        f"({fmt_int(zip5_rows)} rows), "
        f"{fmt_int(len(crosswalk['by_zip3']))} ZIP3 prefixes "
        f"({fmt_int(zip3_rows)} rows). "
        f"{os.path.basename(zip_path)}: "
        f"{os.path.getsize(zip_path)/1e6:.2f} MB.")

    manifest, generation_path, artifact_paths = build_generation_manifest(
        con, active_cycles, reconciliation)

    r.section("generation.json")
    r.para(
        f"{fmt_int(len(artifact_paths))} versioned top-level artifacts named, "
        "plus a pattern covering "
        f"{fmt_int(sum(c['count'] for c in manifest['district_pages']['cycles'].values()))} "
        "district pages.")

    # ---- acceptance checks -------------------------------------------------

    dist_geojson_geoids = {}
    for cycle in active_cycles:
        with open(os.path.join(ARTIFACTS, f"districts-{cycle}-v1.geojson")) as fh:
            fc = json.load(fh)
        dist_geojson_geoids[str(cycle)] = {
            f["properties"]["geoid"] for f in fc["features"]}

    orphan_search_geoids = []
    for cycle_s, index in search_by_cycle.items():
        search_geoids = {row["geoid"] for row in index}
        orphan_search_geoids += sorted(
            search_geoids - dist_geojson_geoids[cycle_s])
    r.check("every district_geoid in the search index exists in stage 07's "
            "artifact",
            len(orphan_search_geoids) == 0,
            f"{len(orphan_search_geoids)} orphan geoid(s)")

    missing_resolution = sum(
        1 for rows in crosswalk["by_zip5"].values()
        for row in rows if not row.get("resolution"))
    missing_resolution += sum(
        1 for rows in crosswalk["by_zip3"].values()
        for row in rows if not row.get("resolution"))
    r.check("no ZIP row is missing resolution",
            missing_resolution == 0,
            f"{missing_resolution} row(s) missing resolution")

    exact_for_known = crosswalk["by_zip5"].get(KNOWN_DUAL_ZIP)
    prefix_for_known = crosswalk["by_zip3"].get(KNOWN_DUAL_ZIP3)
    distinguishable = (
        bool(exact_for_known) and bool(prefix_for_known)
        and all(row["resolution"] == D.RESOLVED_ZCTA for row in exact_for_known)
        and all(row["resolution"] == D.RESOLVED_ZIP3 for row in prefix_for_known)
        and {row["district_geoid"] for row in exact_for_known}
            != {row["district_geoid"] for row in prefix_for_known})
    r.check(f"an exact and a prefix answer for {KNOWN_DUAL_ZIP} are "
            "distinguishable",
            distinguishable,
            f"exact={exact_for_known} prefix={prefix_for_known}")

    missing_files = [name for name, path in artifact_paths.items()
                      if not os.path.exists(path)]
    sample_geoid_misses = 0
    for cycle_s, cyc in manifest["district_pages"]["cycles"].items():
        on_disk = len([
            f for f in os.listdir(DISTRICTS_DIR)
            if f.endswith(f"-{cycle_s}-v1.json")])
        if on_disk != cyc["count"]:
            sample_geoid_misses += abs(on_disk - cyc["count"])
    r.check("generation.json names every versioned artifact, and every "
            "named file exists on disk",
            len(missing_files) == 0 and sample_geoid_misses == 0,
            f"{len(missing_files)} missing top-level artifact(s), "
            f"{sample_geoid_misses} district-page count mismatch(es)")

    r.kv("Elapsed", f"{time.time() - t0:.1f}s")
    con.close()
    return r.write()


if __name__ == "__main__":
    sys.exit(main())
