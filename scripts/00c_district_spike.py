"""Spike 00c — can we build a ZIP5 -> congressional district crosswalk from
public-domain Census files alone?

This is the one thing docs/HANDOFF.md calls "the genuine risk in this project,
not the ETL". Every aggregate in Phase 4 is keyed on district, so if this key
cannot be built the aggregation is built on sand. It runs BEFORE 02_normalize
for exactly that reason.

The HUD USPS ZIP crosswalk — what everyone else uses — is barred to us: it is
sublicensed to governmental entities and registered non-profits only, and this
site carries ads. See CLAUDE.md, "Barred sources".

Scope: the MECHANISM only. Ten states redrew maps in 2025-26 and this spike
sources none of those overrides; every row here is cd119 base. Sourcing them
is Phase 3.

Two routes were considered, and the choice is recorded on every output row
rather than assumed:

  (a) BLOCK EQUIVALENCY — Census block-assignment file -> block -> ZCTA.
      Population-correct, and the approved plan specified it.
      **It does not exist for CD119.** The plan's cited path
      (data/maps-data/data/cd119/) 404s, and the two block-assignment files
      Census actually publishes are data/baf/ (dated 2011, CD112) and
      data/baf2020/ (dated 2020-12-11, CD116). check_baf_vintage() proves
      this per-run by deriving both sides: it counts Texas districts in the
      newest BAF and compares against the Texas district count in the cd119
      shapefile. No hardcoded "36 vs 38" — if Census ever publishes a CD119
      BAF, this check starts passing on its own.

  (b) SPATIAL INTERSECTION — cb_2025_us_cd119 x cb_2020_us_zcta520.
      An area approximation, not population-weighted. This is what we use,
      and `derivation` says so on every row, in the same spirit as
      follow-the-ppp's geo_precision: never silently equate two methods of
      different quality.

Generalised (500k) boundaries produce slivers where a ZCTA clips a district by
a few metres of rounding. MIN_OVERLAP_SHARE drops those; the largest-overlap
district is always kept so no ZCTA is lost to the filter.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _fetch
from _db import DATA, REPO, connect
from _report import Report, fmt_int, fmt_pct

CENSUS = "https://www2.census.gov/geo/tiger"
BAF = "https://www2.census.gov/geo/docs/maps-data/data"
RAW = os.path.join(DATA, "raw", "census")
INTERIM = os.path.join(DATA, "interim")

#: (key, url, extract_subdir). The 20m file is the zoomed-out view; 500k is
#: the web map. ZCTA has no cartographic-boundary release after 2020 — TIGER's
#: tl_2025_us_zcta520 is 529 MB against this file's 67 MB, and we never render
#: ZCTAs, only look them up.
SOURCES = [
    ("cb_2025_us_cd119_500k.zip",
     f"{CENSUS}/GENZ2025/shp/cb_2025_us_cd119_500k.zip", "cd119_500k"),
    ("cb_2025_us_cd119_20m.zip",
     f"{CENSUS}/GENZ2025/shp/cb_2025_us_cd119_20m.zip", "cd119_20m"),
    ("cb_2020_us_zcta520_500k.zip",
     f"{CENSUS}/GENZ2020/shp/cb_2020_us_zcta520_500k.zip", "zcta520_500k"),
]

#: The newest block-assignment file Census publishes, used only to prove which
#: Congress it describes. One state is enough and TX is the clearest signal:
#: it gained two seats between CD116 and CD119.
BAF_PROBE = (f"{BAF}/baf2020/BlockAssign_ST48_TX.zip",
             "BlockAssign_ST48_TX_CD.txt", "48")

#: 435 voting members. The file also carries DC and the territories, so the
#: real count is a little higher; below 435 means the download is truncated or
#: we are reading the wrong layer.
MIN_DISTRICT_FEATURES = 435

#: A ZCTA that resolves to no district is a ZIP the UI cannot answer for.
MIN_ZCTA_RESOLVED = 0.99

#: Intersection area / ZCTA area. Below this is a generalisation sliver, not a
#: real split. The largest-overlap district is exempt.
MIN_OVERLAP_SHARE = 0.01

#: ~15% of ZIPs genuinely cross a district boundary. Far below means the
#: sliver filter is eating real splits; far above means it is not working.
SPLIT_SHARE_BAND = (0.05, 0.40)

DERIVATION = "spatial_intersection:cb_2025_us_cd119_500k x cb_2020_us_zcta520_500k"
VINTAGE = "cd119 base (119th Congress, Census 2025 cartographic boundary)"
LEGAL_STATUS = "cd119_base — no state redistricting override applied"


def fetch_sources(manifest):
    """Download and unpack every shapefile. Returns {subdir: .shp path}."""
    paths = {}
    for key, url, subdir in SOURCES:
        dest = os.path.join(RAW, key)
        print(f"  {key}")
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


def check_baf_vintage(con, manifest, cd_shp):
    """Derive which Congress the newest published BAF describes.

    Returns (baf_districts, cd119_districts) for the probe state. Equal counts
    would mean route (a) is viable; unequal proves it is a different vintage.
    """
    url, member, statefp = BAF_PROBE
    dest = os.path.join(RAW, os.path.basename(url))
    print(f"  {os.path.basename(url)} (BAF vintage probe)")
    _fetch.download(url, dest, manifest, os.path.basename(url))
    manifest.save()

    districts = set()
    for i, line in enumerate(_fetch.stream_member(dest, member)):
        if i == 0 or not line.strip():
            continue  # BLOCKID|DISTRICT header
        parts = line.rstrip("\r").split("|")
        if len(parts) >= 2 and parts[1].strip():
            districts.add(parts[1].strip())
    # ZZ is Census's "not in any district" filler, not a district.
    districts.discard("ZZ")

    cd119 = con.execute(
        f"SELECT count(*) FROM ST_Read('{cd_shp}') WHERE STATEFP = ?",
        [statefp]).fetchone()[0]
    return len(districts), cd119


def build_crosswalk(con, cd_shp, zcta_shp):
    """ZCTA x district intersection, sliver-filtered. Writes one table."""
    con.execute(f"""
        CREATE OR REPLACE TABLE cd AS
        SELECT STATEFP AS statefp, CD119FP AS cd, GEOID AS district_geoid,
               NAMELSAD AS district_name, CDSESSN AS congress, geom
        FROM ST_Read('{cd_shp}')
    """)
    con.execute(f"""
        CREATE OR REPLACE TABLE zcta AS
        SELECT ZCTA5CE20 AS zcta, geom, ST_Area(geom) AS zcta_area
        FROM ST_Read('{zcta_shp}')
    """)
    con.execute("""
        CREATE OR REPLACE TABLE pairs AS
        SELECT z.zcta, z.zcta_area, c.statefp, c.cd, c.district_geoid,
               c.district_name, c.congress,
               ST_Area(ST_Intersection(z.geom, c.geom)) AS inter_area
        FROM zcta z JOIN cd c ON ST_Intersects(z.geom, c.geom)
    """)
    con.execute(f"""
        CREATE OR REPLACE TABLE crosswalk AS
        WITH scored AS (
            SELECT *,
                   CASE WHEN zcta_area > 0 THEN inter_area / zcta_area END
                       AS overlap_share,
                   row_number() OVER (PARTITION BY zcta
                                      ORDER BY inter_area DESC) AS rk
            FROM pairs
        )
        SELECT zcta, statefp, cd, district_geoid, district_name, congress,
               overlap_share,
               rk = 1 AS is_primary,
               '{DERIVATION}' AS derivation,
               '{VINTAGE}' AS vintage,
               '{LEGAL_STATUS}' AS legal_status
        FROM scored
        -- Keep the dominant district unconditionally so the sliver filter can
        -- never orphan a ZCTA, plus every genuine co-occupant above threshold.
        WHERE rk = 1 OR overlap_share >= {MIN_OVERLAP_SHARE}
    """)


def main():
    t0 = time.time()
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(INTERIM, exist_ok=True)
    manifest = _fetch.Manifest(os.path.join(RAW, "MANIFEST.json"))

    paths = fetch_sources(manifest)
    con = connect()
    con.execute("INSTALL spatial; LOAD spatial;")

    features = con.execute(
        f"SELECT count(*) FROM ST_Read('{paths['cd119_500k']}')").fetchone()[0]
    baf_n, cd119_n = check_baf_vintage(con, manifest, paths["cd119_500k"])

    print("  intersecting ZCTAs against districts…")
    build_crosswalk(con, paths["cd119_500k"], paths["zcta520_500k"])

    zcta_total = con.execute("SELECT count(*) FROM zcta").fetchone()[0]
    resolved = con.execute(
        "SELECT count(DISTINCT zcta) FROM crosswalk").fetchone()[0]
    rows = con.execute("SELECT count(*) FROM crosswalk").fetchone()[0]
    split = con.execute("""
        SELECT count(*) FROM (
            SELECT zcta FROM crosswalk GROUP BY zcta HAVING count(*) > 1)
    """).fetchone()[0]
    resolved_share = resolved / zcta_total if zcta_total else 0
    split_share = split / resolved if resolved else 0

    # Secondary measurement: how many ZIPs that actually appear in FEC data
    # resolve? ZCTAs are Census approximations of ZIP codes and do not cover
    # PO-box-only or point ZIPs, so full ZCTA coverage is not full ZIP coverage.
    cm = os.path.join(DATA, "raw", "fec", "2024", "cm.txt")
    fec_total = fec_hit = None
    if os.path.exists(cm):
        cm_cols = ["CMTE_ID", "CMTE_NM", "TRES_NM", "CMTE_ST1", "CMTE_ST2",
                   "CMTE_CITY", "CMTE_ST", "CMTE_ZIP", "CMTE_DSGN", "CMTE_TP",
                   "CMTE_PTY_AFFILIATION", "CMTE_FILING_FREQ", "ORG_TP",
                   "CONNECTED_ORG_NM", "CAND_ID"]
        cols = ", ".join(f"'{c}': 'VARCHAR'" for c in cm_cols)
        con.execute(f"""
            CREATE OR REPLACE TABLE cm_zips AS
            SELECT DISTINCT substr(CMTE_ZIP, 1, 5) AS zip5
            FROM read_csv('{cm}', delim='|', header=false,
                          names={cm_cols}, types={{{cols}}},
                          ignore_errors=true)
            WHERE CMTE_ZIP IS NOT NULL AND length(CMTE_ZIP) >= 5
              AND regexp_matches(substr(CMTE_ZIP, 1, 5), '^[0-9]{{5}}$')
        """)
        fec_total = con.execute("SELECT count(*) FROM cm_zips").fetchone()[0]
        fec_hit = con.execute("""
            SELECT count(*) FROM cm_zips z
            WHERE EXISTS (SELECT 1 FROM crosswalk c WHERE c.zcta = z.zip5)
        """).fetchone()[0]

    out = os.path.join(INTERIM, "zip5_district_crosswalk.parquet")
    con.execute(f"COPY crosswalk TO '{out}' (FORMAT parquet)")

    # ---- report -----------------------------------------------------------
    r = Report("00c_district_spike",
               "Spike 00c — ZIP5 → congressional district crosswalk")
    r.kv("Question", "can this be built from public-domain Census files alone?")
    r.kv("Elapsed", f"{time.time() - t0:.1f}s")

    r.section("Route (a) — block equivalency: REJECTED")
    r.para(
        "The approved plan specified Census's 119th CD Block Equivalency File. "
        "That path 404s. The two block-assignment files Census actually "
        "publishes are `data/baf/` (dated 2011) and `data/baf2020/` (dated "
        "2020-12-11). Their vintage is derived rather than assumed: count the "
        "districts each source gives Texas, which gained two seats between the "
        "116th and 119th Congresses.")
    r.table(["source", "Texas districts"],
            [("`baf2020` BlockAssign_ST48_TX_CD.txt", fmt_int(baf_n)),
             ("`cb_2025_us_cd119_500k.shp`", fmt_int(cd119_n))])
    r.para(
        f"{'Equal — route (a) is viable and this spike is stale.' if baf_n == cd119_n else
            f'**Unequal ({baf_n} vs {cd119_n}). The newest published BAF is not CD119, '
            'so route (a) does not exist.** Block-level, population-weighted '
            'assignment is unavailable for the current districts from any '
            'public-domain source. Route (b) is used.'}")

    r.section("Route (b) — spatial intersection: USED")
    r.table(["measure", "value"], [
        ("district features in `cb_2025_us_cd119_500k`", fmt_int(features)),
        ("ZCTAs in `cb_2020_us_zcta520_500k`", fmt_int(zcta_total)),
        ("ZCTAs resolving to ≥1 district", f"{fmt_int(resolved)} ({fmt_pct(resolved_share)})"),
        ("crosswalk rows", fmt_int(rows)),
        ("ZCTAs spanning >1 district", f"{fmt_int(split)} ({fmt_pct(split_share)})"),
    ])
    r.para(
        "Every row carries `derivation`, `vintage` and `legal_status`. The "
        "derivation is an **area approximation, not population-weighted** — a "
        "ZCTA split 50/50 by area may be split 90/10 by people. That is "
        "recorded, never silently equated with a block-level assignment, in "
        "the same spirit as follow-the-ppp's `geo_precision`.")

    if fec_total:
        r.section("ZCTA coverage is not ZIP coverage")
        r.table(["measure", "value"], [
            ("distinct 5-digit ZIPs in FEC `cm.txt` (2024)", fmt_int(fec_total)),
            ("resolving against the crosswalk",
             f"{fmt_int(fec_hit)} ({fmt_pct(fec_hit / fec_total)})"),
        ])
        r.para(
            "ZCTAs are Census *approximations* of ZIP codes and do not exist "
            "for PO-box-only or point ZIPs. The shortfall here is that gap, "
            "not a defect in the join — and it is the number the UI's ZIP "
            "entry will actually live with. Phase 3 decides how to answer for "
            "an unresolvable ZIP; it must not render as 'no data'.")

    r.section("Scope")
    r.para(
        "Mechanism only. Ten states redrew congressional maps in 2025-26 and "
        "this spike sources **no overrides** — every row is `cd119_base`. "
        "Adding a state later is a data change, not a code change. Output is "
        f"`{os.path.relpath(out, REPO)}`, gitignored: a cd119-only crosswalk "
        "has an unsolved vintage problem and must not be enshrined as "
        "committed reference data.")

    r.check("district features", features >= MIN_DISTRICT_FEATURES,
            f"{features} (minimum {MIN_DISTRICT_FEATURES})")
    r.check("ZCTA resolution rate", resolved_share >= MIN_ZCTA_RESOLVED,
            f"{fmt_pct(resolved_share)} (minimum {fmt_pct(MIN_ZCTA_RESOLVED)})")
    r.check("split-ZIP share within expected band",
            SPLIT_SHARE_BAND[0] <= split_share <= SPLIT_SHARE_BAND[1],
            f"{fmt_pct(split_share)} (band "
            f"{fmt_pct(SPLIT_SHARE_BAND[0])}–{fmt_pct(SPLIT_SHARE_BAND[1])})")
    r.check("derivation recorded on every row",
            con.execute("SELECT count(*) FROM crosswalk "
                        "WHERE derivation IS NULL OR vintage IS NULL "
                        "OR legal_status IS NULL").fetchone()[0] == 0,
            "derivation, vintage and legal_status non-null")

    con.close()
    return r.write()


if __name__ == "__main__":
    sys.exit(main())
