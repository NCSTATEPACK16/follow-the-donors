"""Export the shared prototype dataset.

The riso prototypes are evaluated against REAL districts, REAL money and REAL
map_status — an aesthetic judged on lorem-ipsum geometry is a judgement about
lorem ipsum. Output is WGS84 GeoJSON; projection happens in the browser so all
prototypes share one file and differ only in ink.

Round 2 adds three things round 1 did not need:

  * a 2026 path, because round 2 is a 2026 build (see MID_CYCLE below — the
    caveat that comes with it is structural, not a footnote);
  * a party split per district, for prototype E;
  * state geometry and a Senate artifact, for the Senate layer.

Run:  .venv/bin/python web/prototypes/export_data.py         # both cycles
      .venv/bin/python web/prototypes/export_data.py 2026    # just one
"""

import json
import os
import subprocess
import sys

import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "web", "prototypes", "data")
CYCLES = ("2024", "2026")

FILING_PERIOD = {
    "2024": "2023-01-01 through 2024-12-31 (FEC bulk pas2, as filed)",
    "2026": "2025-01-01 through the most recent FEC bulk pas2 refresh, as filed",
}

# Only 2024 hard-gates. 2026 is a mid-cycle snapshot with partial filing
# periods and small denominators; CLAUDE.md is categorical that every
# published figure names the filing period it covers, so the reconciliation
# number is MEASURED here and shipped with the data rather than written into
# the page as a constant that quietly goes stale. (reports/03_hygiene.md read
# +5.16% on 2026-09-19; the round-2 plan, written days earlier, said +5.08%.
# Neither is wrong — FEC data amends continuously. That is exactly why this
# is computed and not typed.)
GATED = {"2024"}

# Northern Mariana Islands is a real delegation with a real $0. It is not a
# hole in the data and must not be filtered as one.
KNOWN_ZERO = {"6998"}


def rewind_for_d3(path):
    """Reverse every ring, because d3-geo winds the opposite way to GeoJSON.

    RFC 7946 says an exterior ring is counterclockwise, and mapshaper emits
    exactly that. d3-geo is SPHERICAL and reads a counterclockwise ring as the
    complement — the whole sphere minus the polygon. Measured on TX-21 before
    the fix: d3.geoArea returned 12.5660 steradians against a whole sphere of
    12.5664, and the centroid came back at (81.1E, 30.0S), in the Indian Ocean.
    After reversing: 0.000404 sr, centroid (98.9W, 30.0N), central Texas.

    The symptom is not subtle but it IS misleading: the stroked outlines still
    draw correctly, so the map looks nearly right while every fill is the
    clip rectangle. Reversing all rings flips exteriors and holes together,
    which preserves their relative orientation.

    This matters only for d3-geo. Tippecanoe and MapLibre work in planar tile
    coordinates and are indifferent to winding, so stage 07 will not need it.
    """
    with open(path) as fh:
        gj = json.load(fh)
    n = 0
    for f in gj["features"]:
        geom = f["geometry"]
        polys = ([geom["coordinates"]] if geom["type"] == "Polygon"
                 else geom["coordinates"])
        for poly in polys:
            for ring in poly:
                ring.reverse()
                n += 1
    with open(path, "w") as fh:
        json.dump(gj, fh, separators=(",", ":"))
    print(f"  rewind {n} rings reversed for d3-geo")


def mapshaper(*args):
    subprocess.run(["npx", "--yes", "mapshaper@0.6.102", *args],
                   check=True, cwd=ROOT)


# ------------------------------------------------------------------ #
#  Party                                                              #
# ------------------------------------------------------------------ #

# DFL is the Democratic-Farmer-Labor Party — Minnesota's Democratic party,
# under the name it actually uses there. Measured: every DFL dollar in the
# 2026 file is in MN and there are no DEM-coded House dollars in MN at all.
# Leaving it unfolded would paint all eight Minnesota districts as
# third-party on prototype E's diverging ramp, i.e. it would place a whole
# state at a neutral midpoint that means "no major-party money" when the
# truth is "entirely one major party". The fold is a correction, not a
# convenience.
DEM_CODES = ("DEM", "DFL")
REP_CODES = ("REP",)

# A one-element Python tuple repr's as ('REP',) and that trailing comma is a
# syntax error in SQL. Build the list explicitly rather than interpolating a
# repr that happens to be valid only for len >= 2.
def sql_list(codes):
    return "(" + ", ".join(f"'{c}'" for c in codes) + ")"


# ------------------------------------------------------------------ #
#  Senate                                                             #
# ------------------------------------------------------------------ #

# ONE row in the 2026 Senate set is not a state.
#
# `attribution_2026` places $82,250 in "DC" on the strength of the 2026 `cn`
# file, which records CAND_OFFICE_ST='DC' for S6MD03441 — Chris Van Hollen,
# the sitting senator from MARYLAND, whose seat is next up in 2028. The 2024
# `cn` file records the same candidate, the same ID and the same election
# year as 'MD'. The CAND_ID itself embeds MD (characters 3-4). It is a defect
# in one cycle of one bulk file.
#
# The District of Columbia has no Senate representation. Rendering a DC
# Senate plate would state something false — and politically loaded — about
# the map, and dropping the row would lose real money. So the row is moved
# to Maryland and the move is RECORDED in the artifact, because a silent
# correction is the thing this project does not do.
#
# Measured after the move: 50 states, $80,871,118 conserved to the dollar;
# 35 states with a seat up ($74,285,909) and 15 with every dollar banked for
# a later cycle ($6,585,209, Maryland now $551,429 of it).
SENATE_ST_FIX = {
    "S6MD03441": ("DC", "MD",
                  "2026 cn records CAND_OFFICE_ST='DC'; 2024 cn, and the "
                  "CAND_ID itself, say MD. DC has no Senate seats."),
}


def export_cycle(con, cycle):
    print(f"\n=== {cycle} ===")

    # ---------------------------------------------------------------- #
    #  Districts                                                        #
    # ---------------------------------------------------------------- #
    # Money is integer cents for the same reason the tiles carry cents:
    # floats round differently between encoders.
    #
    # The party split rides along on the district feature rather than in its
    # own file — prototype E needs it on every hover, and a second fetch to
    # colour a polygon that is already loaded is a round trip for nothing.
    rows = con.execute(f"""
        WITH party AS (
            SELECT district_geoid,
                   SUM(CASE WHEN cand_party IN {sql_list(REP_CODES)} THEN amount ELSE 0 END) AS rep,
                   SUM(CASE WHEN cand_party IN {sql_list(DEM_CODES)} THEN amount ELSE 0 END) AS dem,
                   SUM(amount) AS tot
            FROM attribution_{cycle}
            WHERE bucket = 'district'
            GROUP BY 1
        )
        SELECT d.district_geoid,
               t.state_usps, t.cd, t.district_name,
               t.map_status, t.map_vintage, t.legal_status,
               CAST(t.pac_dollars * 100 AS BIGINT)            AS pac_cents,
               t.contributions, t.candidates, t.donor_committees,
               CAST(COALESCE(p.rep, 0) * 100 AS BIGINT)       AS rep_cents,
               CAST(COALESCE(p.dem, 0) * 100 AS BIGINT)       AS dem_cents,
               CAST(COALESCE(p.tot - p.rep - p.dem, 0) * 100 AS BIGINT) AS oth_cents,
               ST_AsGeoJSON(d.geom)                           AS gj
        FROM districts_raw d
        JOIN district_totals_{cycle} t USING (district_geoid)
        LEFT JOIN party p USING (district_geoid)
        ORDER BY d.district_geoid
    """).fetchall()

    features = []
    for (geoid, st, cd, name, status, vintage, legal, cents,
         contribs, cands, donors, rep, dem, oth, gj) in rows:
        features.append({
            "type": "Feature",
            "properties": {
                "geoid": geoid, "state": st, "cd": cd, "name": name,
                "map_status": status, "map_vintage": vintage,
                "legal_status": legal, "pac_cents": int(cents),
                "contributions": int(contribs), "candidates": int(cands),
                "donor_committees": int(donors),
                "rep_cents": int(rep), "dem_cents": int(dem),
                "oth_cents": int(oth),
            },
            "geometry": json.loads(gj),
        })

    raw = os.path.join(OUT, f"_districts.raw.{cycle}.geojson")
    with open(raw, "w") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh)
    print(f"  raw  {len(features)} features  {os.path.getsize(raw)/1e6:.1f} MB")

    # Shared-boundary simplification. Per-geometry ST_Simplify opens slivers
    # between neighbouring districts; mapshaper simplifies the shared arc once,
    # so contiguous borders stay contiguous. That matters here specifically:
    # a gap between two districts would read as misregistration, which in this
    # design system MEANS something.
    dist = os.path.join(OUT, f"districts-{cycle}.geojson")
    mapshaper(raw,
              "-simplify", "visvalingam", "weighted", "10%", "keep-shapes",
              "-clean",
              "-o", "precision=0.0001", "format=geojson", dist)
    print(f"  simp {os.path.getsize(dist)/1e6:.2f} MB")

    # ---------------------------------------------------------------- #
    #  States — dissolved from the SIMPLIFIED districts, deliberately   #
    # ---------------------------------------------------------------- #
    # Dissolving the already-simplified file rather than simplifying a
    # separately-sourced state file guarantees the state outline is exactly
    # the union of its districts' outlines. In this design system a gap
    # between two inked shapes reads as misregistration and misregistration
    # MEANS something, so a state border that missed its own districts by a
    # third of a pixel would be saying something false about the data.
    #
    # It is also why a state outline is safe to draw at all: redistricting
    # moves the lines INSIDE a state and never the state's own border, so
    # the Senate layer carries no map_status caveat. That is a real
    # difference between the two layers and the legend says so.
    states = os.path.join(OUT, f"states-{cycle}.geojson")
    mapshaper(raw,
              "-simplify", "visvalingam", "weighted", "10%", "keep-shapes",
              "-clean",
              "-dissolve", "state", "sum-fields=pac_cents,contributions",
              "-o", "precision=0.0001", "format=geojson", states)
    print(f"  states {os.path.getsize(states)/1e6:.2f} MB")

    os.remove(raw)
    rewind_for_d3(dist)
    rewind_for_d3(states)

    # ---------------------------------------------------------------- #
    #  Sector breakdown                                                 #
    # ---------------------------------------------------------------- #
    sect = con.execute(f"""
        SELECT district_geoid, sector, CAST(pac_dollars * 100 AS BIGINT)
        FROM district_sector_{cycle}
        WHERE pac_dollars > 0
        ORDER BY district_geoid, pac_dollars DESC
    """).fetchall()
    by_district = {}
    for geoid, sector, cents in sect:
        by_district.setdefault(geoid, []).append([sector, int(cents)])
    with open(os.path.join(OUT, f"sectors-{cycle}.json"), "w") as fh:
        json.dump(by_district, fh)
    print(f"  sect {len(by_district)} districts")

    # ---------------------------------------------------------------- #
    #  Senate                                                           #
    # ---------------------------------------------------------------- #
    # Election year comes from `cn`, de-duplicated to distinct
    # (CAND_ID, CAND_ELECTION_YR) FIRST. `cn` is not unique on CAND_ID —
    # joining it raw fans every contribution out across the candidate's
    # duplicate registrations and doubles the money. Same class of defect as
    # the ccl fan-out that CLAUDE.md records, so it gets the same treatment.
    sen = con.execute(f"""
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

    by_state, corrections, gross = {}, [], 0.0
    for cand_id, st, yr, party, amt, n, donors in sen:
        gross += float(amt)
        if cand_id in SENATE_ST_FIX:
            was, now, why = SENATE_ST_FIX[cand_id]
            if st == was:
                corrections.append({
                    "cand_id": cand_id, "from": was, "to": now,
                    "cents": int(round(float(amt) * 100)), "why": why,
                })
                st = now
        s = by_state.setdefault(st, {
            "total_cents": 0, "up_cents": 0, "banked_cents": 0,
            "rep_cents": 0, "dem_cents": 0, "oth_cents": 0,
            "contributions": 0, "donor_committees": 0,
        })
        cents = int(round(float(amt) * 100))
        s["total_cents"] += cents
        s["up_cents" if yr == cycle else "banked_cents"] += cents
        key = ("rep_cents" if party in REP_CODES
               else "dem_cents" if party in DEM_CODES else "oth_cents")
        s[key] += cents
        s["contributions"] += int(n)
        s["donor_committees"] += int(donors)

    # Sector mix per state, so the Senate layer is not a special case for
    # prototype F. `committees` is unique on cmte_id within a cycle —
    # checked, 20,694 rows and 20,694 distinct ids — so this join cannot fan
    # out the way a raw `ccl` join does. Measured: it conserves the Senate
    # total to the dollar.
    sen_sect = con.execute(f"""
        SELECT a.office_st,
               COALESCE(c.sector, 'Unclassified') AS sector,
               CAST(SUM(a.amount) * 100 AS BIGINT) AS cents
        FROM attribution_{cycle} a
        LEFT JOIN (SELECT DISTINCT cmte_id, sector
                   FROM committees WHERE cycle = '{cycle}') c
          ON c.cmte_id = a.donor_cmte_id
        WHERE a.bucket = 'statewide' AND a.office = 'S'
        GROUP BY 1, 2
        ORDER BY 1, 3 DESC
    """).fetchall()
    sen_by_state = {}
    for st, sector, cents in sen_sect:
        # The same DC -> MD correction, applied to the sector rows too, or
        # the mix would disagree with the total it is a mix of.
        for cand, (was, now, _why) in SENATE_ST_FIX.items():
            if st == was:
                st = now
        sen_by_state.setdefault(st, []).append([sector, int(cents)])
    for st, rows_ in sen_by_state.items():
        merged = {}
        for sector, cents in rows_:
            merged[sector] = merged.get(sector, 0) + cents
        sen_by_state[st] = sorted(merged.items(), key=lambda kv: -kv[1])
        if st in by_state:
            by_state[st]["sectors"] = [[k, v] for k, v in sen_by_state[st]]

    # A state with no 2026 dollars at all has no seat up this cycle; every
    # dollar it has is banked for a later one. That is the "banked" mark —
    # and it is the SAME mark as a superseded boundary, because both say the
    # one thing worth saying: this figure is not what it appears to be.
    for st, s in by_state.items():
        s["seat_up"] = s["up_cents"] != 0

    net = sum(s["total_cents"] for s in by_state.values()) / 100
    assert abs(net - gross) < 0.005, f"senate money not conserved: {net} vs {gross}"

    # TWO different splits live here and conflating them puts a wrong number
    # on the page. Measured on 2026:
    #
    #   by DOLLAR   — which election each dollar is FOR.  $65,585,065 is for
    #                 a 2026 election, $15,286,053 for a later one. The later
    #                 money is spread across ALL 50 states, including the 35
    #                 with a seat up: a senator up in 2026 can still bank
    #                 money for 2032.
    #   by STATE    — whether the state has a seat up at all.  35 states do
    #                 and hold $74,285,909 between them; 15 do not and hold
    #                 $6,585,209, every dollar of it for a later cycle.
    #
    # The "banked" mark is a STATE mark, so it is the second split it must
    # agree with. Naming them apart is the whole point.
    up_states = [s for s in by_state.values() if s["seat_up"]]
    banked_states = [s for s in by_state.values() if not s["seat_up"]]
    senate = {
        "cycle": cycle,
        "states": dict(sorted(by_state.items())),
        "corrections": corrections,
        "total_cents": sum(s["total_cents"] for s in by_state.values()),
        "cycle_cents": sum(s["up_cents"] for s in by_state.values()),
        "later_cycle_cents": sum(s["banked_cents"] for s in by_state.values()),
        "up_state_cents": sum(s["total_cents"] for s in up_states),
        "banked_state_cents": sum(s["total_cents"] for s in banked_states),
        "seats_up": len(up_states),
        "banked_states": len(banked_states),
        # State borders are not redistricted, so this layer carries none of
        # the district layer's vintage problem. Said out loud because the
        # ABSENCE of a caveat is itself information when the layer beside it
        # has 37% of its money on a stale map.
        "boundary_note": "State borders are not redistricted. Unlike the "
                         "district layer, no Senate figure sits on a "
                         "superseded map.",
    }
    with open(os.path.join(OUT, f"senate-{cycle}.json"), "w") as fh:
        json.dump(senate, fh, indent=2)
    print(f"  sen  {len(by_state)} states · ${senate['total_cents']/100:,.0f} · "
          f"{senate['seats_up']} up / {senate['banked_states']} banked · "
          f"{len(corrections)} correction(s)")

    # ---------------------------------------------------------------- #
    #  Meta                                                             #
    # ---------------------------------------------------------------- #
    tot, stale = con.execute(f"""
        SELECT SUM(pac_dollars),
               SUM(CASE WHEN map_status = 'cd119_superseded'
                        THEN pac_dollars ELSE 0 END)
        FROM district_totals_{cycle}
    """).fetchone()

    # Measured, never typed. See GATED above.
    computed, reported = con.execute(f"""
        SELECT SUM(computed), SUM(reported) FROM reconciliation_{cycle}
    """).fetchone()
    rel = (float(computed) - float(reported)) / float(reported)

    # ---------------------------------------------------------------- #
    #  Density breaks — per cycle, measured                             #
    # ---------------------------------------------------------------- #
    # Quantile breaks, not equal-interval: equal intervals put four fifths of
    # the country in one step. They are computed PER CYCLE because the two
    # distributions are not the same shape — 2024's median district took
    # $775,503 and 2026's has taken $608,524 so far, and 2026 is still
    # filling. Measured: running 2026 through 2024's breaks bins the 441
    # districts [74, 81, 128, 102, 41, 15], i.e. the top two steps of the
    # ramp carry 56 districts between them and the ramp stops encoding at
    # exactly the end that matters. With the cycle's own breaks each step
    # holds ~73.
    #
    # A cross-cycle comparison therefore CANNOT read the two maps' colours
    # against each other, and the legend says so rather than letting the
    # reader assume otherwise.
    breaks = [int(round(float(x) * 100)) for x in con.execute(f"""
        SELECT QUANTILE_CONT(pac_dollars, [1/6, 2/6, 3/6, 4/6, 5/6])
        FROM district_totals_{cycle}
    """).fetchone()[0]]

    def short(c):
        d = abs(c) / 100
        s = "−" if c < 0 else ""
        if d >= 1e6:
            return f"{s}${d / 1e6:.2f}M"
        if d >= 1e3:
            return f"{s}${d / 1e3:.0f}K"
        return f"{s}${d:.0f}"

    labels = ([f"< {short(breaks[0])}"]
              + [f"{short(breaks[i])}–{short(breaks[i + 1])}"
                 for i in range(len(breaks) - 1)]
              + [f"> {short(breaks[-1])}"])

    meta = {
        "cycle": cycle,
        "gated": cycle in GATED,
        "filing_period": FILING_PERIOD[cycle],
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
            SELECT map_status, COUNT(*) FROM district_totals_{cycle} GROUP BY 1
        """).fetchall()),
        "party": {
            "rep_cents": sum(f["properties"]["rep_cents"] for f in features),
            "dem_cents": sum(f["properties"]["dem_cents"] for f in features),
            "oth_cents": sum(f["properties"]["oth_cents"] for f in features),
        },
    }
    if cycle not in GATED:
        meta["mid_cycle"] = (
            f"The {cycle} cycle is still in progress. These are contributions "
            f"as filed, not final: filing periods are partial, amendments are "
            f"continuous, and the totals here run {rel:+.2%} against the FEC's "
            f"own published candidate summaries. The {cycle} figures are "
            f"reported, never gated."
        )
    with open(os.path.join(OUT, f"meta-{cycle}.json"), "w") as fh:
        json.dump(meta, fh, indent=2)
    print(f"  meta {meta['superseded_share']:.2%} on a superseded map · "
          f"reconciliation {rel:+.2%}")


def main(argv):
    cycles = argv[1:] or list(CYCLES)
    for c in cycles:
        if c not in CYCLES:
            print(f"unknown cycle {c!r}; known: {CYCLES}", file=sys.stderr)
            return 2
    os.makedirs(OUT, exist_ok=True)
    con = duckdb.connect(os.path.join(ROOT, "data", "fec.duckdb"), read_only=True)
    con.execute("INSTALL spatial; LOAD spatial;")
    for c in cycles:
        export_cycle(con, c)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
