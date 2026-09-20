"""Stage 07 — publishable artifacts: district and state geometry, sector
breakdowns, the Senate rollup, and the metadata every view reads.

This is a port of web/prototypes/export_data.py into the repo's stage
conventions, not a rewrite — that script already does all of this correctly
and is what round 2's prototypes were judged against. The derivation rules
(cents conversion, ring rewind, per-cycle breaks, the Senate correction) move
into _artifacts.py as pure, tested functions; this file is the I/O shell:
query, call, write, check.

Round 2 settled discrete zoom and a canvas + WebGL2 press instead of
MapLibre, which is why this produces plain simplified GeoJSON rather than
vector tiles. See docs/superpowers/plans/2026-09-19-v1-canvas-launch.md.
"""

import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _artifacts as A
from _db import CYCLES, DATA, GATE_CYCLES, REPO, connect, table_exists
from _report import Report, fmt_int, fmt_money, fmt_pct

ARTIFACTS = os.path.join(DATA, "artifacts")

FILING_PERIOD = {
    "2024": "2023-01-01 through 2024-12-31 (FEC bulk pas2, as filed)",
    "2026": "2025-01-01 through the most recent FEC bulk pas2 refresh, as filed",
}

#: Only 2024 hard-gates; see _db.GATE_CYCLES. 2026 is a mid-cycle snapshot and
#: reconciliation.relative is MEASURED and shipped with the data rather than
#: written into the page as a constant that quietly goes stale.
GATED = {str(c) for c in GATE_CYCLES}

MAPSHAPER_ARGS = ("-simplify", "visvalingam", "weighted", "10%", "keep-shapes",
                   "-clean")

RING_CHECK = os.path.join(REPO, "scripts", "_ring_check.cjs")
D3_ARRAY = os.path.join(REPO, "web", "prototypes", "vendor", "d3-array.min.js")
D3_GEO = os.path.join(REPO, "web", "prototypes", "vendor", "d3-geo.min.js")

#: Every d3.geoArea for a district or state must read as a small patch of the
#: globe, never as "the whole sphere minus this patch" (~12.57 sr). 0.1 sr is
#: comfortably above the largest real state (Alaska, ~0.028 sr unsimplified)
#: and comfortably below the unrewound-ring failure mode.
MAX_GEO_AREA_SR = 0.1

#: 436 of the 441 districts draw on Albers USA. AS/GU/MP/PR/VI cannot be
#: projected there and are rendered as off-map chips by the frontend, but
#: they still carry real geometry and real money in this artifact.
EXPECTED_DISTRICTS = 441


def mapshaper(*args):
    subprocess.run(["npx", "--yes", "mapshaper@0.6.102", *args],
                    check=True, cwd=REPO)


def rewind_file(path):
    fc = A.load_geojson(path)
    n = A.rewind_for_d3(fc)
    A.dump_geojson(fc, path)
    return n


def geo_areas(*paths):
    """d3.geoArea for every feature in the given GeoJSON files, via the
    actual vendored d3-geo the frontend ships — the point is that the
    CONSUMER agrees the rings are wound correctly, not that a human inspected
    coordinate order."""
    out = subprocess.run(
        ["node", RING_CHECK, D3_ARRAY, D3_GEO, *paths],
        check=True, cwd=REPO, capture_output=True, text=True)
    return json.loads(out.stdout)


def build_districts_and_states(con, cycle):
    """Raw features -> simplified, dissolved, rewound GeoJSON on disk.

    Money is integer cents for the same reason the tiles carried cents:
    floats round differently between encoders. The party split rides on the
    district feature itself rather than its own file, so a hover needs no
    second fetch to colour a polygon that is already loaded.
    """
    rows = con.execute(f"""
        WITH party AS (
            SELECT district_geoid,
                   SUM(CASE WHEN cand_party IN {A.sql_list(A.REP_CODES)}
                            THEN amount ELSE 0 END) AS rep,
                   SUM(CASE WHEN cand_party IN {A.sql_list(A.DEM_CODES)}
                            THEN amount ELSE 0 END) AS dem,
                   SUM(amount) AS tot
            FROM attribution_{cycle}
            WHERE bucket = 'district'
            GROUP BY 1
        )
        SELECT d.district_geoid,
               t.state_usps, t.cd, t.district_name,
               t.map_status, t.map_vintage, t.legal_status,
               t.pac_dollars, t.contributions, t.candidates, t.donor_committees,
               COALESCE(p.rep, 0)                AS rep_dollars,
               COALESCE(p.dem, 0)                AS dem_dollars,
               COALESCE(p.tot - p.rep - p.dem, 0) AS oth_dollars,
               ST_AsGeoJSON(d.geom)               AS gj
        FROM districts_raw d
        JOIN district_totals_{cycle} t USING (district_geoid)
        LEFT JOIN party p USING (district_geoid)
        ORDER BY d.district_geoid
    """).fetchall()

    features = [
        A.district_feature(
            geoid, st, cd, name, status, vintage, legal, pac_dollars,
            contribs, cands, donors, rep, dem, oth, json.loads(gj))
        for (geoid, st, cd, name, status, vintage, legal, pac_dollars,
             contribs, cands, donors, rep, dem, oth, gj) in rows
    ]

    raw = os.path.join(ARTIFACTS, f"_districts.raw.{cycle}.geojson")
    A.dump_geojson({"type": "FeatureCollection", "features": features}, raw)

    # Shared-boundary simplification. Per-geometry simplify opens slivers
    # between neighbouring districts; mapshaper simplifies the shared arc
    # once, so contiguous borders stay contiguous. A gap between two
    # districts would read as misregistration, which in this design system
    # MEANS something.
    dist = os.path.join(ARTIFACTS, f"districts-{cycle}-v1.geojson")
    mapshaper(raw, *MAPSHAPER_ARGS,
              "-o", "precision=0.0001", "format=geojson", dist)

    # States are dissolved from the same simplified topology, deliberately —
    # see _artifacts.senate_rollup's boundary_note for why a state border
    # carries none of the district layer's vintage caveat.
    states = os.path.join(ARTIFACTS, f"states-{cycle}-v1.geojson")
    mapshaper(raw, *MAPSHAPER_ARGS,
              "-dissolve", "state", "sum-fields=pac_cents,contributions",
              "-o", "precision=0.0001", "format=geojson", states)

    os.remove(raw)
    dist_rings = rewind_file(dist)
    states_rings = rewind_file(states)

    return features, dist, states, dist_rings, states_rings


def build_sectors(con, cycle):
    rows = con.execute(f"""
        SELECT district_geoid, sector, pac_dollars
        FROM district_sector_{cycle}
        WHERE pac_dollars > 0
        ORDER BY district_geoid, pac_dollars DESC
    """).fetchall()
    by_district = A.sector_breakdown(rows)
    path = os.path.join(ARTIFACTS, f"sectors-{cycle}-v1.json")
    with open(path, "w") as fh:
        json.dump(by_district, fh, separators=(",", ":"))
    return by_district, path


def build_senate(con, cycle):
    """Election year comes from `cn`, de-duplicated to distinct
    (CAND_ID, CAND_ELECTION_YR) FIRST. `cn` is not unique on CAND_ID —
    joining it raw fans every contribution out across the candidate's
    duplicate registrations and doubles the money. Same class of defect as
    the ccl fan-out CLAUDE.md records, so it gets the same treatment."""
    rows = con.execute(f"""
        WITH cn_cycle AS (
            SELECT DISTINCT CAND_ID, CAND_ELECTION_YR
            FROM cn WHERE cycle = '{cycle}'
        )
        SELECT a.cand_id, a.office_st, c.CAND_ELECTION_YR AS yr,
               a.cand_party, SUM(a.amount) AS amt, COUNT(*) AS n,
               COUNT(DISTINCT a.donor_cmte_id) AS donors
        FROM attribution_{cycle} a
        LEFT JOIN cn_cycle c ON c.CAND_ID = a.cand_id
        WHERE a.bucket = 'statewide' AND a.office = 'S'
        GROUP BY 1, 2, 3, 4
    """).fetchall()

    # `committees` is unique on (cmte_id, cycle) — checked — so this join
    # cannot fan out the way a raw `ccl` join does.
    sector_rows = con.execute(f"""
        SELECT a.office_st,
               COALESCE(c.sector, 'Unclassified') AS sector,
               SUM(a.amount) AS dollars
        FROM attribution_{cycle} a
        LEFT JOIN (SELECT DISTINCT cmte_id, sector
                   FROM committees WHERE cycle = '{cycle}') c
          ON c.cmte_id = a.donor_cmte_id
        WHERE a.bucket = 'statewide' AND a.office = 'S'
        GROUP BY 1, 2
        ORDER BY 1, 3 DESC
    """).fetchall()

    senate = A.senate_rollup(str(cycle), rows, sector_rows)
    path = os.path.join(ARTIFACTS, f"senate-{cycle}-v1.json")
    with open(path, "w") as fh:
        json.dump(senate, fh, indent=2)
    return senate, path


def build_meta(con, cycle, features):
    cycle_s = str(cycle)
    tot, stale = con.execute(f"""
        SELECT SUM(pac_dollars),
               SUM(CASE WHEN map_status = 'cd119_superseded'
                        THEN pac_dollars ELSE 0 END)
        FROM district_totals_{cycle}
    """).fetchone()

    computed, reported = con.execute(f"""
        SELECT SUM(computed), SUM(reported) FROM reconciliation_{cycle}
    """).fetchone()
    rel = (float(computed) - float(reported)) / float(reported)

    pac_dollars = [r[0] for r in con.execute(
        f"SELECT pac_dollars FROM district_totals_{cycle}").fetchall()]
    breaks = A.quantile_breaks_cents(pac_dollars)
    labels = A.break_labels(breaks)

    meta = {
        "cycle": cycle_s,
        "gated": cycle_s in GATED,
        "filing_period": FILING_PERIOD[cycle_s],
        "breaks_cents": breaks,
        "break_labels": labels,
        "district_dollars": float(tot),
        "superseded_dollars": float(stale),
        "superseded_share": float(stale) / float(tot),
        "reconciliation": {
            "computed": float(computed),
            "reported": float(reported),
            "relative": rel,
        },
        "status_counts": dict(con.execute(f"""
            SELECT map_status, COUNT(*) FROM district_totals_{cycle}
            GROUP BY 1
        """).fetchall()),
        "party": {
            "rep_cents": sum(f["properties"]["rep_cents"] for f in features),
            "dem_cents": sum(f["properties"]["dem_cents"] for f in features),
            "oth_cents": sum(f["properties"]["oth_cents"] for f in features),
        },
    }
    if cycle_s not in GATED:
        meta["mid_cycle"] = (
            f"The {cycle_s} cycle is still in progress. These are "
            f"contributions as filed, not final: filing periods are "
            f"partial, amendments are continuous, and the totals here run "
            f"{rel:+.2%} against the FEC's own published candidate "
            f"summaries. The {cycle_s} figures are reported, never gated."
        )
    path = os.path.join(ARTIFACTS, f"meta-{cycle}-v1.json")
    with open(path, "w") as fh:
        json.dump(meta, fh, indent=2)
    return meta, path


def main():
    t0 = time.time()
    os.makedirs(ARTIFACTS, exist_ok=True)
    con = connect(read_only=True)
    con.execute("INSTALL spatial; LOAD spatial;")

    if not table_exists(con, "districts_raw"):
        print("districts_raw missing — run scripts/05_districts.py first")
        return 1
    if not table_exists(con, "district_totals_2024"):
        print("district_totals_2024 missing — run scripts/06_aggregate.py first")
        return 1

    r = Report("07_artifacts", "Stage 07 — publishable artifacts")
    r.kv("Cycles", ", ".join(str(c) for c in CYCLES))
    r.kv("Gated", ", ".join(str(c) for c in GATE_CYCLES))

    for cycle in CYCLES:
        cycle_s = str(cycle)
        if not table_exists(con, f"district_totals_{cycle}"):
            continue

        print(f"  {cycle}…")
        features, dist_path, states_path, dist_rings, states_rings = \
            build_districts_and_states(con, cycle)
        sectors, sectors_path = build_sectors(con, cycle)
        senate, senate_path = build_senate(con, cycle)
        meta, meta_path = build_meta(con, cycle, features)

        r.section(f"{cycle_s}")
        r.table(["artifact", "size"], [
            (os.path.basename(p), f"{os.path.getsize(p)/1e6:.2f} MB")
            for p in (dist_path, states_path, sectors_path, senate_path,
                      meta_path)
        ])
        r.para(
            f"{fmt_int(len(features))} district features · "
            f"{fmt_money(meta['district_dollars'])} · "
            f"**{fmt_pct(meta['superseded_share'])} on a superseded map** · "
            f"reconciliation {meta['reconciliation']['relative']:+.2%}.")
        r.para(
            f"Senate: {fmt_int(len(senate['states']))} states · "
            f"{fmt_money(senate['total_cents']/100)} · "
            f"{senate['seats_up']} up / {senate['banked_states']} banked · "
            f"{fmt_int(len(senate['corrections']))} correction(s).")

        # ---- acceptance checks, this cycle -------------------------------

        r.check(f"{cycle_s} districts artifact has exactly "
                f"{EXPECTED_DISTRICTS} features",
                len(features) == EXPECTED_DISTRICTS,
                f"{len(features)} features")

        db_total_cents = int(round(float(
            con.execute(f"SELECT SUM(pac_dollars) FROM district_totals_{cycle}"
                        ).fetchone()[0]) * 100))
        feature_cents = sum(f["properties"]["pac_cents"] for f in features)
        r.check(f"{cycle_s} feature pac_cents sums to district_totals × 100 "
                "exactly",
                feature_cents == db_total_cents,
                f"{feature_cents} vs {db_total_cents}")

        attribution_cents = int(round(float(con.execute(f"""
            SELECT SUM(amount) FROM attribution_{cycle}
            WHERE bucket = 'district'
        """).fetchone()[0]) * 100))
        r.check(f"{cycle_s} district bucket of attribution equals the "
                "artifact total",
                attribution_cents == db_total_cents,
                f"{attribution_cents} vs {db_total_cents}")

        cand_totals_cents = int(round(float(con.execute(f"""
            SELECT SUM(pac_dollars) FROM candidate_totals_{cycle}
            WHERE bucket = 'statewide' AND office = 'S'
        """).fetchone()[0]) * 100))
        r.check(f"{cycle_s} Senate artifact equals candidate_totals to the "
                "cent",
                senate["total_cents"] == cand_totals_cents,
                f"{senate['total_cents']} vs {cand_totals_cents}")

        null_vintage = sum(
            1 for f in features
            if f["properties"]["map_status"] is None
            or f["properties"]["map_vintage"] is None
            or f["properties"]["legal_status"] is None)
        r.check(f"{cycle_s} every feature carries map_status, map_vintage, "
                "legal_status",
                null_vintage == 0,
                f"{null_vintage} features missing a vintage field")

        vintage_counts = dict(con.execute(f"""
            SELECT map_status, COUNT(*) FROM district_vintage GROUP BY 1
        """).fetchall())
        r.check(f"{cycle_s} map_status counts match district_vintage exactly",
                meta["status_counts"] == vintage_counts,
                f"{meta['status_counts']} vs {vintage_counts}")

        areas = geo_areas(dist_path, states_path)
        max_area = max((a["area"] for a in areas), default=None)
        r.check(f"{cycle_s} every ring is wound for d3-geo "
                f"(max area < {MAX_GEO_AREA_SR} sr)",
                max_area is not None and max_area < MAX_GEO_AREA_SR,
                f"max {max_area} sr over {len(areas)} features "
                f"({dist_rings + states_rings} rings rewound)")

        state_count = len(senate["states"])
        r.check(f"{cycle_s} Senate states sum to 50",
                state_count == 50,
                f"{state_count} states")
        if cycle_s == "2026":
            # The DC->MD bug is specific to the 2026 cn file — 2024's cn
            # already records this candidate correctly under MD, so 2024
            # legitimately has zero corrections. Only 2026 is asserted here.
            r.check("2026 DC->MD Senate correction is recorded, "
                    "35 seats up / 15 banked",
                    bool(senate["corrections"]) and senate["seats_up"] == 35
                    and senate["banked_states"] == 15,
                    f"{len(senate['corrections'])} correction(s), "
                    f"{senate['seats_up']} up / {senate['banked_states']} "
                    "banked")

        non_string_ids = sum(
            1 for f in features
            if not isinstance(f["properties"]["geoid"], str)
            or not isinstance(f["properties"]["cd"], str))
        non_string_ids += sum(
            1 for st in senate["states"] if not isinstance(st, str))
        r.check(f"{cycle_s} every ID in every artifact is a JSON string",
                non_string_ids == 0,
                f"{non_string_ids} non-string ID(s)")

    r.kv("Elapsed", f"{time.time() - t0:.1f}s")
    con.close()
    return r.write()


if __name__ == "__main__":
    sys.exit(main())
