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
