"""District map vintage and ZIP resolution rules.

Two invariants meet in this file. Invariant 3 — every district geometry
carries its map vintage — and the spike 00c finding that only 85.12% of real
FEC ZIPs resolve against ZCTAs, which `reports/00c_district_spike.md` says
"must not render as 'no data'".
"""

import pytest

import _districts as D


# --- the override registry is committed data, so a typo must fail loudly ---

def write_registry(tmp_path, body):
    p = tmp_path / "district_overrides.csv"
    p.write_text(body)
    return str(p)


HEADER = ("state,vintage,enacted_date,legal_status,provenance_url,"
          "geometry_source,provenance_kind,notes\n")
HEADER2 = HEADER


def test_a_state_with_no_entry_is_simply_absent(tmp_path):
    path = write_registry(tmp_path, HEADER)
    assert D.load_overrides(path) == {}


def test_comment_lines_are_not_read_as_data(tmp_path):
    """reference/sectors.csv carries its curation rules as leading `#` lines
    and this registry does the same. csv.DictReader would otherwise take the
    first comment as the header and silently yield nothing."""
    path = write_registry(
        tmp_path,
        "# why these states are here\n" + HEADER +
        "TX,2025 mid-decade,2025-08-29,in_effect,https://example.gov/tx,\n")
    assert set(D.load_overrides(path)) == {"TX"}


def test_an_unknown_legal_status_raises(tmp_path):
    """legal_status drives what the UI tells a visitor about a district's
    map. A value outside the enum would render as an unexplained string."""
    path = write_registry(
        tmp_path, HEADER +
        "TX,2025 mid-decade,2025-08-29,probably_fine,https://example.gov/tx,\n")
    with pytest.raises(ValueError, match="legal_status"):
        D.load_overrides(path)


def test_a_non_iso_enacted_date_raises(tmp_path):
    path = write_registry(
        tmp_path, HEADER +
        "TX,2025 mid-decade,08/29/2025,in_effect,https://example.gov/tx,\n")
    with pytest.raises(ValueError, match="enacted_date"):
        D.load_overrides(path)


def test_an_override_without_provenance_raises(tmp_path):
    """Invariant 3 makes provenance a first-class field. An override we
    cannot cite is an assertion, not a source."""
    path = write_registry(
        tmp_path, HEADER + "TX,2025 mid-decade,2025-08-29,in_effect,,\n")
    with pytest.raises(ValueError, match="provenance_url"):
        D.load_overrides(path)


# --- what we tell the visitor about the map they are looking at ------------

def test_a_state_with_no_redraw_is_current():
    assert D.map_status("WY", {}) == D.MAP_CURRENT


def test_an_in_effect_redraw_we_lack_geometry_for_is_superseded():
    """The whole point of the registry. TX enacted a new map in 2025 and
    Census cd119 does not reflect it, so the districts we draw for Texas are
    out of date. Reporting that as `cd119_base` — the label for a state that
    never redrew — would state something false."""
    ov = {"TX": D.Override("TX", "2025 mid-decade", "2025-08-29", "in_effect",
                           "https://example.gov/tx", "")}
    assert D.map_status("TX", ov) == D.MAP_SUPERSEDED


def test_an_in_effect_redraw_with_sourced_geometry_is_applied():
    ov = {"TX": D.Override("TX", "2025 mid-decade", "2025-08-29", "in_effect",
                           "https://example.gov/tx", "tx_2025.zip")}
    assert D.map_status("TX", ov) == D.MAP_OVERRIDE_APPLIED


def test_a_blocked_redraw_leaves_cd119_operative_but_contested():
    """A blocked map is not the law, so cd119 is correct to draw — but a
    visitor asking why MO looks the way it does deserves the answer."""
    ov = {"MO": D.Override("MO", "2025 mid-decade", "2025-09-12", "blocked",
                           "https://example.gov/mo", "")}
    assert D.map_status("MO", ov) == D.MAP_CONTESTED


def test_litigation_is_contested_not_superseded():
    """A hypothetical state, deliberately: `in_litigation` means the new map
    is not yet operative. Every real 2026 map that is under challenge —
    Texas, Tennessee, Louisiana — is nonetheless *in effect*, which is why
    legal_status answers 'which map governs' and never 'is anyone suing'."""
    ov = {"ZZ": D.Override("ZZ", "hypothetical", "2026-01-01",
                           "in_litigation", "https://example.gov/zz", "")}
    assert D.map_status("ZZ", ov) == D.MAP_CONTESTED


def test_geometry_is_ignored_for_a_map_that_is_not_in_effect():
    """Having a blocked map's shapefile on disk must not cause us to draw
    it. Legal status decides what is operative, not what we happen to hold."""
    ov = {"MO": D.Override("MO", "2025 mid-decade", "2025-09-12", "blocked",
                           "https://example.gov/mo", "mo_2025.zip")}
    assert D.map_status("MO", ov) == D.MAP_CONTESTED


# --- answering for a ZIP that has no ZCTA ----------------------------------

EXACT = {"27601": ["3713"], "27603": ["3702", "3713"]}
PREFIX = {"276": ["3702", "3713"], "900": ["0634"]}


def test_a_zip_with_a_zcta_resolves_exactly():
    assert D.resolve_zip("27601", EXACT, PREFIX) == (["3713"], D.RESOLVED_ZCTA)


def test_a_po_box_zip_falls_back_to_its_three_digit_prefix():
    """15% of real FEC ZIPs are PO-box-only or point ZIPs with no ZCTA, and
    committees use PO boxes heavily. The prefix is coarser but it is an
    answer, which spike 00c requires instead of 'no data'."""
    districts, how = D.resolve_zip("27699", EXACT, PREFIX)
    assert districts == ["3702", "3713"]
    assert how == D.RESOLVED_ZIP3


def test_an_exact_hit_never_degrades_to_the_prefix():
    """A resolvable ZIP must not be widened to its prefix's district set —
    that would silently turn one district into several."""
    districts, how = D.resolve_zip("27603", EXACT, PREFIX)
    assert how == D.RESOLVED_ZCTA
    assert districts == ["3702", "3713"]


def test_an_unknown_zip_is_unresolved_not_empty():
    """The caller must be able to tell 'we have no answer' apart from 'this
    ZIP genuinely touches no district', which never happens."""
    assert D.resolve_zip("99999", EXACT, PREFIX) == ([], D.RESOLVED_NONE)


def test_a_leading_zero_zip_is_not_treated_as_a_number():
    """Invariant: all ZIPs are VARCHAR. Int coercion turns 01001 into 1001,
    which is a different ZIP in a different state."""
    exact = {"01001": ["2501"]}
    assert D.resolve_zip("01001", exact, {}) == (["2501"], D.RESOLVED_ZCTA)
    assert D.resolve_zip("1001", exact, {}) == ([], D.RESOLVED_NONE)


def test_zip3_of_keeps_the_leading_zero():
    assert D.zip3_of("01001") == "010"


# --- provenance is tiered, because ours is not yet authoritative -----------

def test_provenance_kind_must_be_known(tmp_path):
    path = write_registry(
        tmp_path, HEADER2 +
        "TX,2025 mid-decade,2025-08-29,in_effect,https://example.gov/tx,,"
        "some_guy_told_me,\n")
    with pytest.raises(ValueError, match="provenance_kind"):
        D.load_overrides(path)


def test_documentary_provenance_is_allowed_but_recorded(tmp_path):
    """A secondary source is enough to know a state redrew — it is not enough
    to draw the new districts from. Admitting the row while recording the tier
    is what keeps the gap visible instead of comfortable."""
    path = write_registry(
        tmp_path, HEADER2 +
        "TN,2026 mid-decade,2026-05-07,in_effect,https://en.wikipedia.org/wiki/X,,"
        "documentary,challenge pending\n")
    ov = D.load_overrides(path)["TN"]
    assert ov.provenance_kind == D.PROVENANCE_DOCUMENTARY
    assert ov.notes == "challenge pending"


def test_a_state_needing_geometry_is_reported_as_a_gap():
    """An in-effect redraw we cannot draw is the gap that actually changes
    what a visitor sees, so it must be enumerable rather than discovered."""
    ov = {"TN": D.Override("TN", "2026", "2026-05-07", "in_effect",
                           "https://example.gov/tn", "", "enacting_authority", "")}
    gaps = D.sourcing_gaps(ov)
    assert gaps["geometry"] == ["TN"]


def test_a_blocked_state_does_not_need_geometry():
    """cd119 is the operative map there, so there is nothing to draw."""
    ov = {"MO": D.Override("MO", "2025", "2025-09-28", "blocked",
                           "https://example.gov/mo", "", "enacting_authority", "")}
    assert D.sourcing_gaps(ov)["geometry"] == []


def test_documentary_only_states_are_reported_as_a_provenance_gap():
    ov = {"TN": D.Override("TN", "2026", "2026-05-07", "in_effect",
                           "https://en.wikipedia.org/wiki/X", "",
                           "documentary", "")}
    assert D.sourcing_gaps(ov)["provenance"] == ["TN"]


# --- STATEFP is how the shapefile names a state; the registry uses USPS -----

def test_state_fips_maps_to_its_usps_code():
    assert D.usps_of("01") == "AL"
    assert D.usps_of("48") == "TX"


def test_an_unpadded_fips_does_not_resolve():
    """Invariant: FIPS is VARCHAR. '6' is what an int round-trip leaves
    behind, and silently accepting it would let California's districts join
    to a registry row by luck rather than by key."""
    assert D.usps_of("6") is None


def test_the_district_of_columbia_and_territories_are_covered():
    """cb_2025_us_cd119 carries DC and the territories alongside the 435
    voting districts. A missing entry would drop them from every join."""
    for fips in ("11", "72", "78", "66", "69", "60"):
        assert D.usps_of(fips) is not None, fips


# --- an override may carry geometry, and only a map that is law is drawn ----
#
# v1.2 Task 1. Until then map_status() said override_applied as soon as
# geometry_source was filled in, while stage 05 drew cd119 regardless: one
# CSV cell away from telling a visitor we drew a map we had not.

def test_documentary_provenance_cannot_carry_geometry(tmp_path):
    """Documentary is good enough to SAY a state redrew, not to DRAW it."""
    path = write_registry(
        tmp_path, HEADER.replace("notes\n", "notes,district_field\n") +
        "UT,2025 remedial,2025-11-10,in_effect,https://example.gov/ut,"
        "https://example.gov/ut.zip,documentary,,DISTRICT\n")
    with pytest.raises(ValueError, match="enacting_authority"):
        D.load_overrides(path)


def test_geometry_without_a_district_field_raises(tmp_path):
    """Which attribute holds the district number is read off the enacted
    file by a person, never guessed from whatever column looks numeric."""
    path = write_registry(
        tmp_path, HEADER +
        "UT,2025 remedial,2025-11-10,in_effect,https://example.gov/ut,"
        "https://example.gov/ut.zip,enacting_authority,\n")
    with pytest.raises(ValueError, match="district_field"):
        D.load_overrides(path)


def test_an_enacting_authority_override_with_its_field_loads(tmp_path):
    path = write_registry(
        tmp_path, HEADER.replace("notes\n", "notes,district_field\n") +
        "UT,2025 remedial,2025-11-10,in_effect,https://example.gov/ut,"
        "https://example.gov/ut.zip,enacting_authority,,DISTRICT\n")
    ov = D.load_overrides(path)["UT"]
    assert ov.district_field == "DISTRICT"


@pytest.mark.parametrize("raw, want", [
    ("1", "01"), ("01", "01"), (1, "01"), ("12", "12"), (" 7 ", "07"),
    ("District 12", "12"), ("district 3", "03"), ("CD 4", "04"),
    ("0", "00"), ("00", "00"), ("AL", "00"), ("At-Large", "00"),
])
def test_normalise_cd(raw, want):
    assert D.normalise_cd(raw) == want


@pytest.mark.parametrize("raw", [
    "", None, "1A", "District", "123", "-1", "1.0", "one", 1.0, True,
])
def test_normalise_cd_refuses_to_guess(raw):
    """A legislature types what it likes. Anything this cannot read with
    certainty stops the build rather than landing money on the wrong seat."""
    with pytest.raises(ValueError):
        D.normalise_cd(raw)


def _applied(state="UT", status="in_effect"):
    return {state: D.Override(state, "2025 remedial", "2025-11-10", status,
                              "https://example.gov/ut", "ut.zip",
                              "enacting_authority", "", "DISTRICT")}


def test_an_applied_override_is_drawn_for_2026_only():
    """2024 was contested on cd119, so it is drawn on cd119 — and a state
    whose map has since moved says so, exactly as it did before overrides
    could carry geometry."""
    ov = _applied()
    assert D.map_status("UT", ov, 2026) == D.MAP_OVERRIDE_APPLIED
    assert D.map_status("UT", ov, 2024) == D.MAP_SUPERSEDED
    assert D.draws_override("UT", ov, 2026)
    assert not D.draws_override("UT", ov, 2024)


def test_a_blocked_map_on_disk_is_drawn_in_no_cycle():
    """The MO/VA guard, per cycle."""
    for status in ("blocked", "in_litigation"):
        ov = _applied("MO", status)
        for cycle in (2024, 2026):
            assert D.map_status("MO", ov, cycle) == D.MAP_CONTESTED
            assert not D.draws_override("MO", ov, cycle)


def test_map_status_without_a_cycle_is_the_governing_one():
    assert D.map_status("UT", _applied()) == D.MAP_OVERRIDE_APPLIED


# --- the geometry swap itself, on a DuckDB fixture --------------------------

@pytest.fixture
def spatial_con():
    duckdb = pytest.importorskip("duckdb")
    con = duckdb.connect()
    try:
        con.execute("INSTALL spatial; LOAD spatial;")
    except Exception as e:  # no network for the extension: CI runs this
        pytest.skip(f"duckdb spatial unavailable: {e}")
    yield con
    con.close()


def _square(x, y, s=1.0):
    return {"type": "Polygon", "coordinates": [[
        [x, y], [x, y + s], [x + s, y + s], [x + s, y], [x, y]]]}


def _write_fc(path, feats):
    import json
    path.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": p, "geometry": g}
                     for p, g in feats]}))
    return str(path)


@pytest.fixture
def ut_files(tmp_path):
    """UT (FIPS 49) with two cd119 districts, and an enacted map with two
    DIFFERENT districts whose numbers are typed the way a legislature
    types them."""
    cd = _write_fc(tmp_path / "cd119.geojson", [
        ({"STATEFP": "49", "CD119FP": f"0{i}", "GEOID": f"490{i}",
          "NAMELSAD": f"Congressional District {i}", "CDSESSN": "119"},
         _square(i, 0))
        for i in (1, 2)])
    enacted = _write_fc(tmp_path / "ut_2025.geojson", [
        ({"DISTRICT": f"District {i}"}, _square(10 + i, 10))
        for i in (1, 2)])
    return cd, enacted


def _geoids_x(con, table):
    return con.execute(f"""
        SELECT district_geoid, round(ST_XMin(geom)) FROM {table}
        ORDER BY 1""").fetchall()


def test_the_enacted_map_is_drawn_for_2026_and_cd119_for_2024(spatial_con, ut_files):
    cd, enacted = ut_files
    D.build_districts(spatial_con, cd, _applied(), (2024, 2026), {"UT": enacted})
    assert _geoids_x(spatial_con, "districts_raw_2026") == [("4901", 11), ("4902", 12)]
    assert _geoids_x(spatial_con, "districts_raw_2024") == [("4901", 1), ("4902", 2)]
    status = dict(spatial_con.execute(
        "SELECT '2026', any_value(map_status) FROM districts_2026 UNION ALL "
        "SELECT '2024', any_value(map_status) FROM districts_2024").fetchall())
    assert status == {"2026": D.MAP_OVERRIDE_APPLIED, "2024": D.MAP_SUPERSEDED}
    # The unsuffixed names answer for the map that governs now.
    assert _geoids_x(spatial_con, "districts_raw") == [("4901", 11), ("4902", 12)]


def test_a_blocked_map_on_disk_changes_no_pixel(spatial_con, ut_files):
    cd, enacted = ut_files
    D.build_districts(spatial_con, cd, _applied(status="blocked"), (2024, 2026),
                      {"UT": enacted})
    for cycle in (2024, 2026):
        assert _geoids_x(spatial_con, f"districts_raw_{cycle}") == [("4901", 1), ("4902", 2)]
        assert {s for (s,) in spatial_con.execute(
            f"SELECT DISTINCT map_status FROM districts_{cycle}").fetchall()} \
            == {D.MAP_CONTESTED}


def test_an_enacted_map_with_the_wrong_seat_count_raises(spatial_con, ut_files, tmp_path):
    """Apportionment is fixed until 2032: a count mismatch is the wrong
    file, not a new map."""
    cd, _ = ut_files
    three = _write_fc(tmp_path / "ut_three.geojson", [
        ({"DISTRICT": str(i)}, _square(10 + i, 10)) for i in (1, 2, 3)])
    with pytest.raises(ValueError, match="districts"):
        D.build_districts(spatial_con, cd, _applied(), (2024, 2026), {"UT": three})


def test_an_enacted_map_numbering_a_seat_twice_raises(spatial_con, ut_files, tmp_path):
    cd, _ = ut_files
    dup = _write_fc(tmp_path / "ut_dup.geojson", [
        ({"DISTRICT": "1"}, _square(11, 10)), ({"DISTRICT": "01"}, _square(12, 10))])
    with pytest.raises(ValueError, match="twice"):
        D.build_districts(spatial_con, cd, _applied(), (2024, 2026), {"UT": dup})


def test_an_applied_override_with_no_file_raises(spatial_con, ut_files):
    """Never label a state override_applied and fall back to drawing cd119."""
    cd, _ = ut_files
    with pytest.raises(ValueError, match="UT"):
        D.build_districts(spatial_con, cd, _applied(), (2024, 2026), {})
