"""Rules for attributing PAC money to a congressional district.

The base map is "PAC dollars flowing IN to each district's representative",
so every dollar has to be assigned to exactly one district or to none at all.
Both of the ways that goes wrong are cheap to get wrong and expensive to
notice, which is why they are pinned here.
"""

import _aggregate as A


# --- only House money is district money ------------------------------------

def test_a_house_candidate_maps_to_their_district():
    assert A.district_key("H", "NC", "03") == ("37", "03")


def test_a_senate_candidate_maps_to_no_district():
    """A Senate seat is statewide. FEC stores its district as '00' — the same
    value an at-large House seat uses — so an aggregation that forgot to
    filter on office would silently pour every Senate dollar in Wyoming into
    Wyoming's single House district."""
    assert A.district_key("S", "WY", "00") is None


def test_a_presidential_candidate_maps_to_no_district():
    assert A.district_key("P", "US", "00") is None


# --- the two encodings that do not line up ---------------------------------

def test_an_at_large_state_keeps_district_zero():
    """Wyoming really does have one district, numbered 00 in both FEC's file
    and Census's."""
    assert A.district_key("H", "WY", "00") == ("56", "00")


def test_a_territory_delegate_maps_to_district_98():
    """FEC numbers delegate seats 00; Census numbers them 98. Measured on the
    2024 cycle, leaving this unmapped stranded $761,890 of the $954,234 that
    failed to join — most of the total miss, in six jurisdictions."""
    assert A.district_key("H", "DC", "00") == ("11", "98")
    assert A.district_key("H", "PR", "00") == ("72", "98")
    assert A.district_key("H", "VI", "00") == ("78", "98")


def test_a_territory_is_not_rewritten_when_it_names_a_real_district():
    """MP has appeared with district 01. Only the 00 placeholder is the
    delegate encoding; rewriting anything else would invent a seat."""
    assert A.district_key("H", "MP", "01") == ("69", "01")


# --- refusing to guess ------------------------------------------------------

def test_a_missing_district_maps_to_none():
    assert A.district_key("H", "NC", None) is None
    assert A.district_key("H", "NC", "") is None


def test_an_unknown_state_maps_to_none():
    assert A.district_key("H", "ZZ", "01") is None


def test_the_district_geoid_keeps_its_leading_zeros():
    """STATEFP and CD are both VARCHAR and both can lead with a zero.
    '0603' is California 3; int arithmetic anywhere here yields 603."""
    assert A.district_geoid("H", "CA", "03") == "0603"
    assert A.district_geoid("H", "AL", "01") == "0101"


def test_the_geoid_of_an_unassignable_candidate_is_none():
    assert A.district_geoid("S", "CA", "00") is None


# --- comparing a district across cycles ------------------------------------

import _districts as D


def test_a_superseded_district_is_not_comparable_across_cycles():
    """Invariant 3, in the form the comparison mode needs it: a 2024
    contribution to TX-35 and a 2026 one are not the same place, because the
    boundaries moved between them. Charting the two side by side as a trend
    would be a false statement drawn as a line."""
    assert A.comparable_across_cycles(D.MAP_SUPERSEDED) is False


def test_a_district_whose_map_never_moved_is_comparable():
    assert A.comparable_across_cycles(D.MAP_CURRENT) is True


def test_a_contested_map_is_still_comparable():
    """A blocked redraw means cd119 governed both cycles, so the district is
    the same place in each."""
    assert A.comparable_across_cycles(D.MAP_CONTESTED) is True
