"""Rules for turning aggregate tables into published artifacts.

No database here, by design — see _totals's tests for the precedent. Every
function in _artifacts takes rows or values and returns data, so the rules
that make money, ring winding, breaks and the Senate correction correct are
checkable without the 514 MB warehouse.
"""

import decimal

import _artifacts as _a


# --- money -------------------------------------------------------------

def test_dollars_become_integer_cents():
    """JSON floats are not money. $328,788,436.00 must survive as an int."""
    assert _a.dollars_to_cents(decimal.Decimal("328788436.00")) == 32878843600
    assert isinstance(_a.dollars_to_cents(decimal.Decimal("328788436.00")), int)


def test_dollars_to_cents_handles_a_refund():
    """FEC amounts are genuinely negative sometimes — refunds."""
    assert _a.dollars_to_cents(decimal.Decimal("-12.34")) == -1234


def test_dollars_to_cents_of_none_is_zero():
    """A district with no PAC money at all reports $0, not null money."""
    assert _a.dollars_to_cents(None) == 0


def test_a_district_with_no_redraw_gets_the_not_applicable_sentinel():
    """05_districts.py correctly leaves legal_status NULL when a district's
    map was never redrawn — there is no litigation status to report. But no
    published feature may carry a null here, so NULL becomes an explicit
    sentinel rather than a silent gap. It must never be 'in_effect': that
    value means a challenge existed and the map survived it, which would
    misstate a district that was never contested."""
    feature = _a.district_feature(
        "3701", "NC", "01", "North Carolina's 1st", "cd119_current",
        "cd119 (119th Congress, Census 2025)", None,
        decimal.Decimal("100.00"), 1, 1, 1,
        decimal.Decimal("0"), decimal.Decimal("0"), decimal.Decimal("0"),
        {"type": "Polygon", "coordinates": []})
    assert feature["properties"]["legal_status"] == "not_applicable"


def test_a_redrawn_district_keeps_its_real_legal_status():
    feature = _a.district_feature(
        "4835", "TX", "35", "Texas's 35th", "cd119_contested",
        "2025 TX redraw", "in_litigation",
        decimal.Decimal("100.00"), 1, 1, 1,
        decimal.Decimal("0"), decimal.Decimal("0"), decimal.Decimal("0"),
        {"type": "Polygon", "coordinates": []})
    assert feature["properties"]["legal_status"] == "in_litigation"


# --- ring winding --------------------------------------------------------

def _polygon_feature(rings):
    return {"type": "Feature", "properties": {},
            "geometry": {"type": "Polygon", "coordinates": rings}}


def _multipolygon_feature(polys):
    return {"type": "Feature", "properties": {},
            "geometry": {"type": "MultiPolygon", "coordinates": polys}}


def test_ring_rewind_reverses_exterior_rings_only():
    """d3-geo winds opposite to RFC 7946. An un-rewound exterior ring makes
    d3.geoArea return ~12.57 sr — the whole sphere minus the district — and
    every fill becomes the clip rectangle while the outline still draws
    correctly. COMPARISON.md §6."""
    exterior = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]
    fc = {"features": [_polygon_feature([list(exterior)])]}

    n = _a.rewind_for_d3(fc)

    assert n == 1
    assert fc["features"][0]["geometry"]["coordinates"][0] == list(reversed(exterior))


def test_ring_rewind_reverses_holes_too_and_preserves_relative_winding():
    """A hole must reverse alongside its exterior — reversing only one would
    make the hole wind the SAME way as the exterior instead of the opposite
    way, which is what marks it as a hole to a spherical consumer."""
    exterior = [[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]]
    hole = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]
    fc = {"features": [_polygon_feature([list(exterior), list(hole)])]}

    n = _a.rewind_for_d3(fc)

    assert n == 2
    coords = fc["features"][0]["geometry"]["coordinates"]
    assert coords[0] == list(reversed(exterior))
    assert coords[1] == list(reversed(hole))


def test_ring_rewind_walks_every_polygon_of_a_multipolygon():
    exterior_a = [[0, 0], [0, 1], [1, 1], [0, 0]]
    exterior_b = [[10, 10], [10, 11], [11, 11], [10, 10]]
    fc = {"features": [_multipolygon_feature(
        [[list(exterior_a)], [list(exterior_b)]])]}

    n = _a.rewind_for_d3(fc)

    assert n == 2
    coords = fc["features"][0]["geometry"]["coordinates"]
    assert coords[0][0] == list(reversed(exterior_a))
    assert coords[1][0] == list(reversed(exterior_b))


# --- quantile breaks -----------------------------------------------------

def test_quantile_breaks_are_per_cycle():
    """2024's median district took $775,503 and 2026's $608,524. Running
    2026 through 2024's breaks bins it [74, 81, 128, 102, 41, 15] — the top
    two steps hold 56 districts between them and the ramp stops encoding at
    exactly the end that matters. All three figures re-verified 2026-09-19."""
    cheap = [decimal.Decimal(v) for v in range(100, 100_100, 1_000)]  # 100 districts, evenly spread
    pricey = [decimal.Decimal(v) for v in range(500_000, 600_000, 1_000)]  # a shifted, tighter cycle

    cheap_breaks = _a.quantile_breaks_cents(cheap)
    pricey_breaks = _a.quantile_breaks_cents(pricey)

    assert cheap_breaks != pricey_breaks

    def bin_counts(values, breaks):
        counts = [0] * (len(breaks) + 1)
        for v in values:
            cents = _a.dollars_to_cents(v)
            i = 0
            while i < len(breaks) and cents > breaks[i]:
                i += 1
            counts[i] += 1
        return counts

    # Each cycle's own breaks spread its own districts roughly evenly...
    own = bin_counts(pricey, pricey_breaks)
    assert max(own) - min(own) <= 2

    # ...but the OTHER cycle's breaks collapse it into (at most) one bin,
    # because "pricey" never crosses any of "cheap"'s much lower breaks.
    borrowed = bin_counts(pricey, cheap_breaks)
    assert max(borrowed) == len(pricey)


def test_break_labels_come_from_the_cycles_own_breaks():
    breaks = _a.quantile_breaks_cents(
        [decimal.Decimal(v) for v in range(100_000, 700_000, 1_000)])
    labels = _a.break_labels(breaks)
    assert len(labels) == 6
    assert labels[0].startswith("< ")
    assert labels[-1].startswith("> ")


# --- Senate correction ----------------------------------------------------

def test_senate_state_fix_is_recorded_not_silent():
    """The artifact must carry a corrections list naming the candidate, the
    from-state, the to-state, the cents and the reason."""
    rows = [
        ("S6MD03441", "DC", "2026", "DEM", decimal.Decimal("822.50"), 3, 2),
        ("S0OH00001", "OH", "2026", "REP", decimal.Decimal("100.00"), 1, 1),
    ]
    senate = _a.senate_rollup("2026", rows, sector_rows=[])

    assert senate["corrections"] == [{
        "cand_id": "S6MD03441", "from": "DC", "to": "MD",
        "cents": 82250, "why": _a.SENATE_ST_FIX["S6MD03441"][2],
    }]
    # The moved money lands in MD, never in a DC that has no Senate seats.
    assert "DC" not in senate["states"]
    assert senate["states"]["MD"]["total_cents"] == 82250
    assert senate["states"]["OH"]["total_cents"] == 10000
    assert senate["total_cents"] == 92250


def test_senate_fix_only_fires_when_the_bad_state_is_actually_seen():
    """A future cn refresh could simply fix the upstream row. If CAND_OFFICE_ST
    already reads MD, the correction must not fire a second, phantom move."""
    rows = [("S6MD03441", "MD", "2026", "DEM", decimal.Decimal("10.00"), 1, 1)]
    senate = _a.senate_rollup("2026", rows, sector_rows=[])
    assert senate["corrections"] == []
    assert senate["states"]["MD"]["total_cents"] == 1000


def test_senate_sector_mix_converts_dollars_and_follows_the_correction():
    rows = [("S6MD03441", "DC", "2026", "DEM", decimal.Decimal("822.50"), 3, 2)]
    sector_rows = [("DC", "Labor", decimal.Decimal("822.50"))]
    senate = _a.senate_rollup("2026", rows, sector_rows)
    assert "DC" not in senate["states"]
    assert senate["states"]["MD"]["sectors"] == [["Labor", 82250]]


def test_senate_seat_up_versus_banked_is_a_state_mark():
    """A state with no dollars FOR this cycle has no seat up; every dollar it
    holds is banked for a later one — and that split is independent of the
    per-dollar cycle_cents/later_cycle_cents split."""
    rows = [
        ("S0AA00001", "AA", "2026", "DEM", decimal.Decimal("50.00"), 1, 1),
        ("S0BB00001", "BB", "2032", "REP", decimal.Decimal("25.00"), 1, 1),
    ]
    senate = _a.senate_rollup("2026", rows, sector_rows=[])
    assert senate["states"]["AA"]["seat_up"] is True
    assert senate["states"]["BB"]["seat_up"] is False
    assert senate["seats_up"] == 1
    assert senate["banked_states"] == 1


# --- sector folding (stage 09) --------------------------------------------

def test_sectors_past_the_fifth_fold_into_other():
    """A 6th sector is never a page row of its own — its dollars still count,
    just not under its own name. SECTOR_ORDER is measured, not assumed."""
    rows = [
        ["Corporate", 500],
        ["Trade Association", 300],
        ["Leadership PAC", 200],
        ["Labor", 100],
        ["Membership", 50],
        ["Ideological/Single-Issue", 40],
        ["Health", 10],
    ]
    folded = _a.fold_sectors_to_top5(rows)
    assert folded == [
        ["Corporate", 500], ["Trade Association", 300],
        ["Leadership PAC", 200], ["Labor", 100], ["Membership", 50],
        ["Other", 50],
    ]


def test_folding_conserves_the_total():
    rows = [["Corporate", 500], ["Unclassified", 40], ["Health", 10]]
    folded = _a.fold_sectors_to_top5(rows)
    assert sum(cents for _, cents in folded) == sum(cents for _, cents in rows)


def test_folding_keeps_a_sector_that_nets_negative():
    """A refund can exceed receipts in one sector of one district (measured:
    district 5110, 2024, Unclassified nets -$17,620). Dropping it would break
    the page-total-equals-sum-of-sectors acceptance check, so it is kept
    rather than filtered out the way a purely-cosmetic display might."""
    rows = [["Corporate", 500], ["Unclassified", -100]]
    folded = _a.fold_sectors_to_top5(rows)
    assert folded == [["Corporate", 500], ["Other", -100]]
    assert sum(cents for _, cents in folded) == 400


def test_folding_drops_a_top5_sector_with_zero_dollars_but_keeps_other():
    """A district with fewer than five sectors should not print empty rows
    for the sectors it has no money in."""
    rows = [["Corporate", 100], ["Ideological/Single-Issue", 5]]
    folded = _a.fold_sectors_to_top5(rows)
    assert folded == [["Corporate", 100], ["Other", 5]]


# --- top committees (stage 09) --------------------------------------------

def test_top_committees_orders_by_dollars_ties_broken_by_cmte_id():
    rows = [
        ("C002", "Second Committee", "PAC", "Labor", decimal.Decimal("100.00")),
        ("C001", "First Committee", "PAC", "Corporate", decimal.Decimal("500.00")),
        ("C003", "Tied A", "PAC", "Labor", decimal.Decimal("100.00")),
    ]
    top = _a.top_committees(rows, limit=10)
    assert [c["cmte_id"] for c in top] == ["C001", "C002", "C003"]
    assert top[0]["cents"] == 50000
    assert top[0]["cmte_name"] == "First Committee"


def test_top_committees_is_limited():
    rows = [(f"C{i:03d}", f"Committee {i}", "PAC", "Labor",
              decimal.Decimal(str(i))) for i in range(20)]
    top = _a.top_committees(rows, limit=10)
    assert len(top) == 10
    assert top[0]["cmte_id"] == "C019"
