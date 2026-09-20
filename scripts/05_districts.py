"""Stage 05 — the district layer and the ZIP -> district crosswalk.

Promotes spike 00c from "the mechanism works" to a stage Phase 4 can key on,
and closes the two things the spike deliberately left open
(reports/00c_district_spike.md, "Scope" and "ZCTA coverage is not ZIP
coverage").

1. VINTAGE. The spike labelled every row `cd119_base`. That is true of a state
   that never redrew and false of one whose new map we simply cannot draw, and
   the difference is the whole of invariant 3. reference/district_overrides.csv
   names all eleven states whose maps moved since the 119th was seated, and
   every district row now carries a `map_status` that distinguishes:

     cd119_current     no known redraw; the map we draw is the law
     cd119_superseded  a redraw is IN EFFECT and we do not hold its geometry,
                       so these districts are out of date and must say so
     cd119_contested   a redraw was enacted then blocked; cd119 still governs
     override_applied  we drew the new map

   Nine states are superseded today. That is not a defect to hide — it is the
   number the UI has to state, and stage 06 will weight it by dollars.

2. ZIPS WITH NO ZCTA. Only 85.12% of the 5-digit ZIPs in FEC's cm.txt resolve,
   because ZCTAs do not exist for PO-box-only or point ZIPs and committees use
   PO boxes heavily. The spike required the remainder to be answered as
   something other than "no data", so this stage also builds a ZIP3 prefix
   index: the districts a ZIP's three-digit neighbourhood touches. It is
   deliberately wider than the truth, which is why it is labelled
   `zip3_prefix` on every row and never merged with an exact answer.

Nothing here is population-weighted. Census publishes no CD119 block
equivalency file (spike 00c proved it by deriving the vintage), so the
crosswalk is an area intersection and `derivation` says so on every row.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _districts as D
import _fetch
from _db import DATA, REPO, connect, raw_path
from _report import Report, fmt_int, fmt_pct

CENSUS = "https://www2.census.gov/geo/tiger"
RAW = os.path.join(DATA, "raw", "census")
INTERIM = os.path.join(DATA, "interim")

#: Same three files as spike 00c, already in the manifest and so a no-op on a
#: machine that ran the spike. 20m is the zoomed-out view; 500k is the web map.
SOURCES = [
    ("cb_2025_us_cd119_500k.zip",
     f"{CENSUS}/GENZ2025/shp/cb_2025_us_cd119_500k.zip", "cd119_500k"),
    ("cb_2025_us_cd119_20m.zip",
     f"{CENSUS}/GENZ2025/shp/cb_2025_us_cd119_20m.zip", "cd119_20m"),
    ("cb_2020_us_zcta520_500k.zip",
     f"{CENSUS}/GENZ2020/shp/cb_2020_us_zcta520_500k.zip", "zcta520_500k"),
]

#: 435 voting members plus DC and the territories. Below 435 means a truncated
#: download or the wrong layer, not a real change.
MIN_DISTRICT_FEATURES = 435

#: A ZCTA resolving to no district is a ZIP the UI cannot answer for.
MIN_ZCTA_RESOLVED = 0.99

#: Intersection area / ZCTA area. Below this is a generalisation sliver rather
#: than a real split; the largest-overlap district is exempt so the filter can
#: never orphan a ZCTA.
MIN_OVERLAP_SHARE = 0.01

#: ~15% of ZIPs genuinely cross a district boundary.
SPLIT_SHARE_BAND = (0.05, 0.40)

#: Share of distinct FEC committee ZIPs that must resolve once the ZIP3
#: fallback is allowed. Measured 99.76% on the 2024 cm.txt, against 85.12%
#: without the fallback — the fallback is the difference between answering for
#: six ZIPs in seven and answering for all but one in four hundred. Ratcheted
#: just below the achieved value, the way 03_hygiene ratchets its coverage
#: floor: the point is to catch a regression, not to assert a target nobody
#: measured. The small headroom is for FEC amendment churn adding ZIPs.
MIN_FEC_ZIP_RESOLVED = 0.995

DERIVATION = "spatial_intersection:cb_2025_us_cd119_500k x cb_2020_us_zcta520_500k"


def fetch_sources(manifest):
    """Download and unpack every shapefile. Returns {subdir: .shp path}."""
    paths = {}
    for key, url, subdir in SOURCES:
        dest = os.path.join(RAW, key)
        _fetch.download(url, dest, manifest, key)
        manifest.save()
        members = _fetch.extract_all_members(
            dest, os.path.join(RAW, subdir),
            [".shp", ".dbf", ".shx", ".prj", ".cpg"])
        shp = [m for m in members if m.endswith(".shp")]
        if not shp:
            raise RuntimeError(f"{key} contained no .shp")
        paths[subdir] = shp[0]
    return paths


def build_districts(con, cd_shp, overrides):
    """One row per congressional district, carrying its map vintage.

    The registry is applied in Python rather than SQL because map_status() is
    the rule the tests pin, and a CASE expression duplicating it here is
    exactly the kind of second code path that lets a suppressed or stale value
    leak through the one nobody updated.
    """
    con.execute(f"""
        CREATE OR REPLACE TABLE districts_raw AS
        SELECT STATEFP AS statefp, CD119FP AS cd, GEOID AS district_geoid,
               NAMELSAD AS district_name, CDSESSN AS congress, geom
        FROM ST_Read('{cd_shp}')
    """)
    rows = []
    unmapped = set()
    for statefp, geoid in con.execute(
            "SELECT DISTINCT statefp, district_geoid FROM districts_raw"
    ).fetchall():
        usps = D.usps_of(statefp)
        if usps is None:
            unmapped.add(statefp)
            continue
        ov = overrides.get(usps)
        rows.append((
            geoid, usps, D.map_status(usps, overrides),
            ov.vintage if ov else "cd119 (119th Congress, Census 2025)",
            ov.enacted_date if ov else None,
            ov.legal_status if ov else None,
            ov.provenance_url if ov else None,
            ov.provenance_kind if ov else None,
            ov.notes if ov else None,
        ))
    con.execute("""
        CREATE OR REPLACE TABLE district_vintage (
            district_geoid VARCHAR, state_usps VARCHAR, map_status VARCHAR,
            map_vintage VARCHAR, enacted_date VARCHAR, legal_status VARCHAR,
            provenance_url VARCHAR, provenance_kind VARCHAR, notes VARCHAR)
    """)
    con.executemany(
        "INSERT INTO district_vintage VALUES (?,?,?,?,?,?,?,?,?)", rows)
    con.execute("""
        CREATE OR REPLACE TABLE districts AS
        SELECT r.statefp, r.cd, r.district_geoid, r.district_name, r.congress,
               v.state_usps, v.map_status, v.map_vintage, v.enacted_date,
               v.legal_status, v.provenance_url, v.provenance_kind, v.notes
        FROM districts_raw r
        JOIN district_vintage v USING (district_geoid)
    """)
    return unmapped


def build_crosswalk(con, zcta_shp):
    """ZCTA x district intersection, sliver-filtered, plus the ZIP3 index."""
    con.execute(f"""
        CREATE OR REPLACE TABLE zcta AS
        SELECT ZCTA5CE20 AS zcta, geom, ST_Area(geom) AS zcta_area
        FROM ST_Read('{zcta_shp}')
    """)
    con.execute("""
        CREATE OR REPLACE TABLE pairs AS
        SELECT z.zcta, z.zcta_area, d.district_geoid,
               ST_Area(ST_Intersection(z.geom, d.geom)) AS inter_area
        FROM zcta z JOIN districts_raw d ON ST_Intersects(z.geom, d.geom)
    """)
    con.execute(f"""
        CREATE OR REPLACE TABLE zip_districts AS
        WITH scored AS (
            SELECT *,
                   CASE WHEN zcta_area > 0 THEN inter_area / zcta_area END
                       AS overlap_share,
                   row_number() OVER (PARTITION BY zcta
                                      ORDER BY inter_area DESC) AS rk
            FROM pairs
        )
        SELECT s.zcta AS zip5, s.district_geoid, s.overlap_share,
               s.rk = 1 AS is_primary,
               d.state_usps, d.map_status,
               '{D.RESOLVED_ZCTA}' AS resolution,
               '{DERIVATION}' AS derivation
        FROM scored s JOIN districts d USING (district_geoid)
        -- The dominant district is kept unconditionally so the sliver filter
        -- can never orphan a ZCTA; every genuine co-occupant clears the bar.
        WHERE s.rk = 1 OR s.overlap_share >= {MIN_OVERLAP_SHARE}
    """)
    # The prefix index is built FROM the exact answers, so it inherits their
    # sliver filtering and never invents a district the intersection rejected.
    con.execute(f"""
        CREATE OR REPLACE TABLE zip3_districts AS
        SELECT substr(zip5, 1, 3) AS zip3, district_geoid,
               any_value(state_usps) AS state_usps,
               any_value(map_status) AS map_status,
               count(DISTINCT zip5) AS supporting_zips,
               '{D.RESOLVED_ZIP3}' AS resolution
        FROM zip_districts
        GROUP BY zip3, district_geoid
    """)


def fec_zip_coverage(con):
    """How many ZIPs that actually appear in FEC data can we answer for?

    The measurement that matters is not ZCTA coverage — that is 100% by
    construction — but the share of real committee ZIPs the UI can resolve,
    before and after the prefix fallback.
    """
    cm = raw_path(2024, "cm.txt")
    if not os.path.exists(cm):
        return None
    cm_cols = ["CMTE_ID", "CMTE_NM", "TRES_NM", "CMTE_ST1", "CMTE_ST2",
               "CMTE_CITY", "CMTE_ST", "CMTE_ZIP", "CMTE_DSGN", "CMTE_TP",
               "CMTE_PTY_AFFILIATION", "CMTE_FILING_FREQ", "ORG_TP",
               "CONNECTED_ORG_NM", "CAND_ID"]
    types = ", ".join(f"'{c}': 'VARCHAR'" for c in cm_cols)
    con.execute(f"""
        CREATE OR REPLACE TABLE fec_zips AS
        SELECT DISTINCT substr(CMTE_ZIP, 1, 5) AS zip5
        FROM read_csv('{cm}', delim='|', header=false, names={cm_cols},
                      types={{{types}}}, ignore_errors=true)
        WHERE CMTE_ZIP IS NOT NULL AND length(CMTE_ZIP) >= 5
          AND regexp_matches(substr(CMTE_ZIP, 1, 5), '^[0-9]{{5}}$')
    """)
    return con.execute("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM zip_districts z WHERE z.zip5 = f.zip5))
                   AS exact_hit,
               count(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM zip_districts z WHERE z.zip5 = f.zip5)
                   AND EXISTS (SELECT 1 FROM zip3_districts p
                               WHERE p.zip3 = substr(f.zip5, 1, 3)))
                   AS prefix_hit
        FROM fec_zips f
    """).fetchone()


def main():
    t0 = time.time()
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(INTERIM, exist_ok=True)
    manifest = _fetch.Manifest(os.path.join(RAW, "MANIFEST.json"))

    overrides = D.load_overrides()          # raises on a malformed row
    gaps = D.sourcing_gaps(overrides)
    paths = fetch_sources(manifest)

    con = connect()
    con.execute("INSTALL spatial; LOAD spatial;")

    print("  districts…")
    unmapped = build_districts(con, paths["cd119_500k"], overrides)
    print("  intersecting ZCTAs against districts…")
    build_crosswalk(con, paths["zcta520_500k"])

    features = con.execute("SELECT count(*) FROM districts").fetchone()[0]
    by_status = con.execute("""
        SELECT map_status, count(*) FROM districts
        GROUP BY map_status ORDER BY 2 DESC
    """).fetchall()
    superseded = dict(by_status).get(D.MAP_SUPERSEDED, 0)

    zcta_total = con.execute("SELECT count(*) FROM zcta").fetchone()[0]
    resolved = con.execute(
        "SELECT count(DISTINCT zip5) FROM zip_districts").fetchone()[0]
    rows = con.execute("SELECT count(*) FROM zip_districts").fetchone()[0]
    split = con.execute("""
        SELECT count(*) FROM (SELECT zip5 FROM zip_districts
                              GROUP BY zip5 HAVING count(*) > 1)
    """).fetchone()[0]
    resolved_share = resolved / zcta_total if zcta_total else 0
    split_share = split / resolved if resolved else 0

    cov = fec_zip_coverage(con)

    # The shapes stay in districts_raw for stage 07's tiles; what leaves here
    # is the attribute table, which is what stage 06 aggregates against.
    for select, name in (
            ("SELECT * FROM districts", "districts"),
            ("SELECT * FROM zip_districts", "zip_district_crosswalk"),
            ("SELECT * FROM zip3_districts", "zip3_district_index")):
        out = os.path.join(INTERIM, name + ".parquet")
        con.execute(f"COPY ({select}) TO '{out}' (FORMAT parquet)")

    # ---- report -----------------------------------------------------------
    r = Report("05_districts",
               "Stage 05 — district layer and ZIP → district crosswalk")
    r.kv("Districts", fmt_int(features))
    r.kv("Override registry", f"{len(overrides)} states")
    r.kv("Elapsed", f"{time.time() - t0:.1f}s")

    r.section("Map vintage")
    r.para(
        "Census `cb_2025_us_cd119` draws the districts as they stood when the "
        "119th Congress was seated. Eleven states have since moved: nine are "
        "voting on new lines in 2026, and two enacted maps that were blocked. "
        "`map_status` is carried on every district row so a stale district is "
        "never reported as a current one.")
    r.table(["map_status", "districts"],
            [(f"`{s}`", fmt_int(n)) for s, n in by_status])
    r.para(
        f"**{fmt_int(superseded)} districts ({fmt_pct(superseded / features)}) "
        "are drawn from a map that is no longer the law**, because their state "
        "redrew and we do not yet hold the new geometry. This is the number "
        "the UI has to state plainly; stage 06 will weight it by dollars.")

    r.section("What Phase 3 still owes")
    r.table(["gap", "states"], [
        ("geometry for an in-effect redraw",
         ", ".join(gaps["geometry"]) or "none"),
        ("provenance still documentary, not the enacting authority",
         ", ".join(gaps["provenance"]) or "none"),
    ])
    r.para(
        "Neither list fails the build. Sourcing eleven states' shapefiles from "
        "their enacting legislature or court is tracked work, not a defect, "
        "and a gate that fails on every run until it is finished is a gate "
        "nobody reads. What *would* be a defect — a state whose map moved and "
        "that we report as current — is the acceptance check below.")

    r.section("ZIP → district")
    r.table(["measure", "value"], [
        ("ZCTAs in `cb_2020_us_zcta520_500k`", fmt_int(zcta_total)),
        ("ZCTAs resolving to ≥1 district",
         f"{fmt_int(resolved)} ({fmt_pct(resolved_share)})"),
        ("crosswalk rows", fmt_int(rows)),
        ("ZCTAs spanning >1 district",
         f"{fmt_int(split)} ({fmt_pct(split_share)})"),
    ])

    if cov:
        total, exact_hit, prefix_hit = cov
        answered = exact_hit + prefix_hit
        r.section("Answering for a ZIP with no ZCTA")
        r.table(["measure", "value"], [
            ("distinct 5-digit ZIPs in FEC `cm.txt` (2024)", fmt_int(total)),
            ("resolved exactly, via ZCTA intersection",
             f"{fmt_int(exact_hit)} ({fmt_pct(exact_hit / total)})"),
            ("resolved via the ZIP3 prefix fallback",
             f"{fmt_int(prefix_hit)} ({fmt_pct(prefix_hit / total)})"),
            ("still unresolved",
             f"{fmt_int(total - answered)} "
             f"({fmt_pct((total - answered) / total)})"),
        ])
        r.para(
            "The prefix answer names every district the ZIP's three-digit "
            "neighbourhood touches. It is deliberately wider than the truth — "
            "that is what makes it honest rather than a guess dressed as a "
            "lookup — and `resolution` records which of the two answers a row "
            "came from, so the UI can render them differently and never "
            "silently equate them.")

    r.check("district features", features >= MIN_DISTRICT_FEATURES,
            f"{features} (minimum {MIN_DISTRICT_FEATURES})")
    r.check("every STATEFP maps to a USPS code", not unmapped,
            "unmapped: " + (", ".join(sorted(unmapped)) or "none"))
    r.check("every district carries a map_status",
            con.execute("SELECT count(*) FROM districts "
                        "WHERE map_status IS NULL").fetchone()[0] == 0,
            "map_status non-null")
    r.check("no state in the registry is reported as current",
            con.execute("""
                SELECT count(*) FROM districts
                WHERE map_status = ? AND state_usps IN (
                    SELECT unnest(?))""",
                [D.MAP_CURRENT, list(overrides)]).fetchone()[0] == 0,
            "a redrawn state never renders as cd119_current")
    r.check("ZCTA resolution rate", resolved_share >= MIN_ZCTA_RESOLVED,
            f"{fmt_pct(resolved_share)} (minimum {fmt_pct(MIN_ZCTA_RESOLVED)})")
    r.check("split-ZIP share within expected band",
            SPLIT_SHARE_BAND[0] <= split_share <= SPLIT_SHARE_BAND[1],
            f"{fmt_pct(split_share)} (band {fmt_pct(SPLIT_SHARE_BAND[0])}–"
            f"{fmt_pct(SPLIT_SHARE_BAND[1])})")
    if cov:
        total, exact_hit, prefix_hit = cov
        share = (exact_hit + prefix_hit) / total
        r.check("FEC committee ZIPs answerable after the ZIP3 fallback",
                share >= MIN_FEC_ZIP_RESOLVED,
                f"{fmt_pct(share)} (minimum {fmt_pct(MIN_FEC_ZIP_RESOLVED)})")

    con.close()
    return r.write()


if __name__ == "__main__":
    sys.exit(main())
