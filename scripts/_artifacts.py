"""Pure derivation rules for the published artifacts.

Split out from the numbered stage for the same reason as _totals, _hygiene
and _districts: `07_artifacts` is not a legal module name, and every rule
here is cheap to get wrong and expensive to notice once it has shipped as
static JSON that nobody re-derives. No I/O happens in this module — every
function takes rows or values and returns data, so it is testable without a
database.
"""

import decimal
import json

#: Filing period text for each cycle, rendered on every published figure
#: (invariant 5). Shared between stage 07 and stage 09 so the two cannot
#: drift into describing the same cycle two different ways.
FILING_PERIOD = {
    "2024": "2023-01-01 through 2024-12-31 (FEC bulk pas2, as filed)",
    "2026": "2025-01-01 through the most recent FEC bulk pas2 refresh, as filed",
}

#: Sector order is MEASURED, not assumed: the top five by 2024 district
#: dollars ($142.9M Corporate, $75.6M Trade Association, $48.4M Leadership
#: PAC, $45.7M Labor, $39.9M Membership). Mirrored from the constant of the
#: same name in web/prototypes/shared/inks.js, which the frontend legend
#: reads directly — nothing currently enforces that the two stay in sync, so
#: a change here needs the same change there. A sector past the fifth folds
#: into OTHER_LABEL; a sixth sector is never a generated hue or a page row.
SECTOR_ORDER = [
    "Corporate",
    "Trade Association",
    "Leadership PAC",
    "Labor",
    "Membership",
]
OTHER_LABEL = "Other"

#: A one-element Python tuple repr's as ('REP',) and that trailing comma is a
#: syntax error in SQL, so callers building a SQL IN-list use sql_list()
#: rather than interpolating a repr.
REP_CODES = ("REP",)
#: DFL is the Democratic-Farmer-Labor Party — Minnesota's Democratic party,
#: under the name it actually uses there. Every DFL dollar in the 2026 file
#: is in MN and there is no DEM-coded House money in MN at all; leaving it
#: unfolded would paint Minnesota's districts as third-party.
DEM_CODES = ("DEM", "DFL")

#: One row in the Senate set is not a state. `attribution_2026` places money
#: in "DC" on the strength of the 2026 `cn` file, which records
#: CAND_OFFICE_ST='DC' for S6MD03441 — the sitting senator from MARYLAND. DC
#: has no Senate seats; the row is moved and the move is recorded, never
#: silently applied and never dropped. See export_cycle in the prototype
#: exporter this was ported from.
SENATE_ST_FIX = {
    "S6MD03441": ("DC", "MD",
                  "2026 cn records CAND_OFFICE_ST='DC'; 2024 cn, and the "
                  "CAND_ID itself, say MD. DC has no Senate seats."),
}

#: 05_districts.py leaves `legal_status` NULL for a district whose map was
#: never redrawn — correctly: there is no litigation status to report when
#: there was never a redraw to litigate. But invariant 6 ("every district
#: renders its map vintage") means no published feature may carry a null
#: here, so NULL becomes this explicit sentinel at the JSON boundary. It is
#: never "in_effect" — that value means a challenge existed and the map
#: survived it, which would misstate a district that was never contested at
#: all.
LEGAL_STATUS_NOT_APPLICABLE = "not_applicable"


def or_not_applicable(value):
    """NULL -> the explicit sentinel; any real value passes through unchanged."""
    return value if value is not None else LEGAL_STATUS_NOT_APPLICABLE


def sql_list(codes):
    """A SQL IN-list literal from a tuple of codes, safe for a 1-tuple."""
    return "(" + ", ".join(f"'{c}'" for c in codes) + ")"


# --------------------------------------------------------------------- #
#  Money — dollars in, integer cents out, always                         #
# --------------------------------------------------------------------- #

def dollars_to_cents(dollars):
    """Convert a DECIMAL(38,2) dollar amount to integer cents, exactly.

    JSON floats are not money: `328788436.00 * 100` in binary floating point
    is not guaranteed to land on 32878843600. Going through Decimal keeps the
    conversion exact for any value this pipeline produces.
    """
    if dollars is None:
        return 0
    return int((decimal.Decimal(dollars) * 100).to_integral_value())


# --------------------------------------------------------------------- #
#  Ring winding — d3-geo is spherical, RFC 7946 is not                   #
# --------------------------------------------------------------------- #

def rewind_for_d3(feature_collection):
    """Reverse every ring of every feature, in place. Returns the ring count.

    RFC 7946 says an exterior ring is counterclockwise, and mapshaper emits
    exactly that. d3-geo is SPHERICAL and reads a counterclockwise ring as
    the complement — the whole sphere minus the polygon. Measured on TX-21
    before this fix: d3.geoArea returned 12.5660 steradians against a whole
    sphere of 12.5664, and the centroid came back in the Indian Ocean. After
    reversing: 0.000404 sr, centroid in central Texas.

    The symptom is not subtle but it IS misleading: the stroked outlines
    still draw correctly, so the map looks nearly right while every fill is
    the clip rectangle. Reversing all rings — exterior and holes alike —
    preserves their relative orientation, which is what makes a single
    blanket reversal correct rather than a hole-aware special case.

    This matters only for d3-geo. Tippecanoe and MapLibre worked in planar
    tile coordinates and were indifferent to winding; nothing downstream of
    this pipeline is indifferent to it now.
    """
    n = 0
    for f in feature_collection["features"]:
        geom = f["geometry"]
        polys = ([geom["coordinates"]] if geom["type"] == "Polygon"
                 else geom["coordinates"])
        for poly in polys:
            for ring in poly:
                ring.reverse()
                n += 1
    return n


# --------------------------------------------------------------------- #
#  Quantile breaks — per cycle, never shared                             #
# --------------------------------------------------------------------- #

def quantile_cont(values, q):
    """Linear-interpolation quantile at fraction `q`, matching DuckDB's
    QUANTILE_CONT so the artifact's breaks agree with the figure a reader
    could reproduce straight from SQL."""
    s = sorted(decimal.Decimal(v) for v in values)
    n = len(s)
    if n == 0:
        return None
    if n == 1:
        return s[0]
    pos = q * (n - 1)
    lo = int(pos)
    hi = min(lo + 1, n - 1)
    frac = pos - lo
    return s[lo] + (s[hi] - s[lo]) * frac


def quantile_breaks_cents(pac_dollars):
    """Six-step quantile breaks, in cents, for one cycle's district dollars.

    Quantile breaks, not equal-interval: equal intervals put four fifths of
    the country in one step. They are computed PER CYCLE because the two
    distributions are not the same shape. Measured on the real data:
    2024's median district took $775,503 and 2026's has taken $608,524 so
    far; running 2026 through 2024's breaks bins the 441 districts
    [74, 81, 128, 102, 41, 15] — the top two steps of the ramp carry 56
    districts between them and the ramp stops encoding at exactly the end
    that matters. With the cycle's own breaks each step holds ~73. A
    cross-cycle comparison therefore CANNOT read the two maps' colours
    against each other, and the legend has to say so rather than letting the
    reader assume otherwise.
    """
    qs = [decimal.Decimal(i) / decimal.Decimal(6) for i in range(1, 6)]
    return [dollars_to_cents(quantile_cont(pac_dollars, q)) for q in qs]


def short_money(cents):
    """Compact label for a cents figure: $1.23M / $45K / $6."""
    d = abs(cents) / 100
    s = "−" if cents < 0 else ""
    if d >= 1e6:
        return f"{s}${d / 1e6:.2f}M"
    if d >= 1e3:
        return f"{s}${d / 1e3:.0f}K"
    return f"{s}${d:.0f}"


def break_labels(breaks_cents):
    """Human labels for the ramp's steps, from its own breaks."""
    return ([f"< {short_money(breaks_cents[0])}"]
            + [f"{short_money(breaks_cents[i])}–"
               f"{short_money(breaks_cents[i + 1])}"
               for i in range(len(breaks_cents) - 1)]
            + [f"> {short_money(breaks_cents[-1])}"])


# --------------------------------------------------------------------- #
#  Senate — statewide rollup, with the DC->MD correction recorded        #
# --------------------------------------------------------------------- #

def senate_rollup(cycle, rows, sector_rows, senate_st_fix=SENATE_ST_FIX):
    """The Senate artifact: per-state totals, sector mix, and any corrections.

    `rows` is (cand_id, office_st, election_yr, cand_party, amount,
    contributions, donor_committees) — one row per (candidate, state, year,
    party) group. `sector_rows` is (office_st, sector, dollars). Both are
    expected to already be grouped/summed in SQL; this function only ever
    reshapes and re-buckets what it is given, and converts dollars to cents
    exactly once, right here.

    A correction is never applied silently: every row this function moves
    from one state to another is also appended to `corrections`, naming the
    candidate, the states, the cents, and the reason, so the artifact itself
    carries the fact that a fix happened.
    """
    by_state = {}
    corrections = []
    gross_cents = 0

    for cand_id, st, yr, party, amt, n, donors in rows:
        cents = dollars_to_cents(amt)
        gross_cents += cents
        if cand_id in senate_st_fix:
            was, now, why = senate_st_fix[cand_id]
            if st == was:
                corrections.append({
                    "cand_id": cand_id, "from": was, "to": now,
                    "cents": cents, "why": why,
                })
                st = now
        s = by_state.setdefault(st, {
            "total_cents": 0, "up_cents": 0, "banked_cents": 0,
            "rep_cents": 0, "dem_cents": 0, "oth_cents": 0,
            "contributions": 0, "donor_committees": 0,
        })
        s["total_cents"] += cents
        s["up_cents" if yr == cycle else "banked_cents"] += cents
        key = ("rep_cents" if party in REP_CODES
               else "dem_cents" if party in DEM_CODES else "oth_cents")
        s[key] += cents
        s["contributions"] += int(n)
        s["donor_committees"] += int(donors)

    # Sector mix per state carries the same DC->MD correction, or the mix
    # would disagree with the total it is supposed to be a mix of. `dollars`
    # here is the raw SUM(amount), converted through the same dollars_to_cents
    # as everything else — one place money crosses the dollars/cents boundary.
    sen_by_state = {}
    for st, sector, dollars in sector_rows:
        for _cand, (was, now, _why) in senate_st_fix.items():
            if st == was:
                st = now
        sen_by_state.setdefault(st, []).append((sector, dollars_to_cents(dollars)))
    for st, sector_amts in sen_by_state.items():
        merged = {}
        for sector, cents in sector_amts:
            merged[sector] = merged.get(sector, 0) + cents
        ordered = sorted(merged.items(), key=lambda kv: -kv[1])
        if st in by_state:
            by_state[st]["sectors"] = [[k, v] for k, v in ordered]

    # A state with no dollars FOR this cycle has no seat up; every dollar it
    # has is banked for a later one. That is the "banked" mark, and it is
    # the SAME mark as a superseded boundary: both say the one thing worth
    # saying, that this figure is not what it appears to be.
    for s in by_state.values():
        s["seat_up"] = s["up_cents"] != 0

    net_cents = sum(s["total_cents"] for s in by_state.values())
    assert abs(net_cents - gross_cents) <= 1, (
        f"senate money not conserved: {net_cents} vs {gross_cents}")

    up_states = [s for s in by_state.values() if s["seat_up"]]
    banked_states = [s for s in by_state.values() if not s["seat_up"]]

    return {
        "cycle": cycle,
        "states": dict(sorted(by_state.items())),
        "corrections": corrections,
        "total_cents": net_cents,
        "cycle_cents": sum(s["up_cents"] for s in by_state.values()),
        "later_cycle_cents": sum(s["banked_cents"] for s in by_state.values()),
        "up_state_cents": sum(s["total_cents"] for s in up_states),
        "banked_state_cents": sum(s["total_cents"] for s in banked_states),
        "seats_up": len(up_states),
        "banked_states": len(banked_states),
        # State borders are not redistricted, so this layer carries none of
        # the district layer's vintage problem. Said out loud because the
        # ABSENCE of a caveat is itself information when the layer beside it
        # has more than a third of its money on a stale map.
        "boundary_note": "State borders are not redistricted. Unlike the "
                         "district layer, no Senate figure sits on a "
                         "superseded map.",
    }


# --------------------------------------------------------------------- #
#  District features                                                     #
# --------------------------------------------------------------------- #

#: Every value `incumbent_party` can take. The two ambiguous ones are real
#: values, not missing data — see the function.
INCUMBENT_VALUES = ("REP", "DEM", "OTH", "none", "several")


def incumbent_party(rows):
    """Which party holds this seat, from FEC's own CAND_ICI.

    `rows` is the filed incumbents for one district as (party,) tuples.

    Four cases, and the last two are NOT a default to one party. Measured
    2026-09-20: 414 of 441 districts have exactly one filed incumbent for
    2026 (416 for 2024); 7 have several, because redistricting puts sitting
    members in new seats, and 20 have none. Painting those 27 red or blue
    would state something false about 6% of the map, so they get their own
    values and the UI renders them as their own case.
    """
    parties = [r[0] for r in rows]
    if not parties:
        return "none"
    if len(parties) > 1:
        return "several"
    party = parties[0]
    return ("REP" if party in REP_CODES
            else "DEM" if party in DEM_CODES else "OTH")


def district_feature(geoid, state, cd, name, map_status, map_vintage,
                      legal_status, pac_dollars, contributions, candidates,
                      donor_committees, rep_dollars, dem_dollars,
                      oth_dollars, geometry, incumbent_party="none"):
    """One GeoJSON feature, money in integer cents, every ID a string."""
    return {
        "type": "Feature",
        "properties": {
            "geoid": str(geoid), "state": state, "cd": str(cd), "name": name,
            "map_status": map_status, "map_vintage": map_vintage,
            "legal_status": or_not_applicable(legal_status),
            "pac_cents": dollars_to_cents(pac_dollars),
            "contributions": int(contributions), "candidates": int(candidates),
            "donor_committees": int(donor_committees),
            "rep_cents": dollars_to_cents(rep_dollars),
            "dem_cents": dollars_to_cents(dem_dollars),
            "oth_cents": dollars_to_cents(oth_dollars),
            "incumbent_party": incumbent_party,
        },
        "geometry": geometry,
    }


def sector_breakdown(rows):
    """{geoid: [[sector, cents], ...]} from (geoid, sector, dollars) rows,
    already ordered by dollars descending. Zero-dollar rows are dropped —
    they carry no information and only inflate every district page."""
    by_district = {}
    for geoid, sector, dollars in rows:
        cents = dollars_to_cents(dollars)
        if cents <= 0:
            continue
        by_district.setdefault(str(geoid), []).append([sector, cents])
    return by_district


def fold_sectors_to_top5(sector_cents, sector_order=SECTOR_ORDER,
                          other_label=OTHER_LABEL):
    """[[sector, cents], ...] for one district, folded to SECTOR_ORDER.

    A sector past the fifth is never a page row of its own — its cents are
    summed into `other_label` instead of being dropped or listed unbounded.
    Rows come back in `sector_order`, then `other_label` last, omitting any
    sector that nets to exactly zero so a district with fewer than five
    sectors does not print empty rows. A sector that nets NEGATIVE (refunds
    exceeding receipts in that sector for that district — real, measured,
    e.g. district 5110's Unclassified sector in 2024) is kept rather than
    dropped: every cent must appear somewhere or the page total stops
    matching the sum of its own rows, which is a release-blocking check.
    """
    known = {sector: 0 for sector in sector_order}
    other = 0
    for sector, cents in sector_cents:
        if sector in known:
            known[sector] += cents
        else:
            other += cents
    out = [[sector, known[sector]] for sector in sector_order
           if known[sector] != 0]
    if other != 0:
        out.append([other_label, other])
    return out


def top_committees(rows, limit=10):
    """The top `limit` donor committees for a district, by dollars, ties
    broken by cmte_id so a rebuild is deterministic. `rows` is
    (cmte_id, cmte_name, tier, sector, dollars)."""
    ranked = sorted(rows, key=lambda r: (-float(r[4]), r[0]))
    return [
        {"cmte_id": cmte_id, "cmte_name": cmte_name, "tier": tier,
         "sector": sector, "cents": dollars_to_cents(dollars)}
        for cmte_id, cmte_name, tier, sector, dollars in ranked[:limit]
    ]


def load_geojson(path):
    with open(path) as fh:
        return json.load(fh)


def dump_geojson(feature_collection, path):
    """Compact separators: this is a build artifact, not something a human
    reads, and every byte here is served over the wire."""
    with open(path, "w") as fh:
        json.dump(feature_collection, fh, separators=(",", ":"))
