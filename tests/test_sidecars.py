"""Rules for the search index and the ZIP crosswalk sidecars.

No database here, by design — see _artifacts's tests for the precedent.
"""

import _districts as D
import _sidecars as S


# --- search index ----------------------------------------------------------

def test_search_index_has_one_entry_per_district_with_its_candidates():
    district_rows = [
        ("0101", "AL", "01", "Alabama's 1st"),
        ("0102", "AL", "02", "Alabama's 2nd"),
    ]
    candidate_rows = [
        ("0101", "H0AL01055", "DOE, JANE", "REP"),
        ("0101", "H0AL01063", "SMITH, JOHN", "DEM"),
    ]
    index = S.build_search_index(district_rows, candidate_rows)
    assert len(index) == 2
    by_geoid = {row["geoid"]: row for row in index}
    assert len(by_geoid["0101"]["candidates"]) == 2
    assert by_geoid["0102"]["candidates"] == []


def test_search_index_candidates_are_ordered_deterministically():
    district_rows = [("0101", "AL", "01", "Alabama's 1st")]
    candidate_rows = [
        ("0101", "H0AL01063", "SMITH, JOHN", "DEM"),
        ("0101", "H0AL01055", "DOE, JANE", "REP"),
    ]
    index = S.build_search_index(district_rows, candidate_rows)
    assert [c["cand_id"] for c in index[0]["candidates"]] == \
        ["H0AL01055", "H0AL01063"]


# --- ZIP crosswalk -----------------------------------------------------

def test_a_zip_that_resolves_both_ways_keeps_both_rows_and_both_resolutions():
    """85.12% of committee ZIPs resolve exactly; the ZIP3 fallback lifts
    coverage to 99.76% and is deliberately wider than the truth. A ZIP with
    both an exact ZCTA answer and a prefix answer must keep BOTH — an exact
    and a prefix answer are never equated (invariant 7)."""
    exact_rows = [("08062", "3401", 1.0, True, D.RESOLVED_ZCTA),
                  ("08062", "3402", 0.3, False, D.RESOLVED_ZCTA)]
    prefix_rows = [("080", "3401", 50, D.RESOLVED_ZIP3),
                   ("080", "3402", 50, D.RESOLVED_ZIP3),
                   ("080", "3403", 50, D.RESOLVED_ZIP3)]

    crosswalk = S.build_zip_crosswalk(exact_rows, prefix_rows)

    exact = crosswalk["by_zip5"]["08062"]
    prefix = crosswalk["by_zip3"]["080"]
    assert {r["district_geoid"] for r in exact} == {"3401", "3402"}
    assert {r["district_geoid"] for r in prefix} == {"3401", "3402", "3403"}
    assert all(r["resolution"] == D.RESOLVED_ZCTA for r in exact)
    assert all(r["resolution"] == D.RESOLVED_ZIP3 for r in prefix)
    # The prefix answer is wider than the exact one for the SAME ZIP's
    # neighbourhood — that is the fallback's whole point, not a bug.
    assert len(prefix) > len(exact)


def test_a_zip_with_no_exact_answer_still_gets_a_prefix_answer():
    crosswalk = S.build_zip_crosswalk([], [("999", "0000", 1, D.RESOLVED_ZIP3)])
    assert "999" not in crosswalk["by_zip5"]
    assert crosswalk["by_zip3"]["999"][0]["resolution"] == D.RESOLVED_ZIP3


def test_every_zip5_row_carries_is_primary_and_overlap_share():
    crosswalk = S.build_zip_crosswalk(
        [("00636", "7298", 1.0, True, D.RESOLVED_ZCTA)], [])
    row = crosswalk["by_zip5"]["00636"][0]
    assert row["is_primary"] is True
    assert row["overlap_share"] == 1.0
