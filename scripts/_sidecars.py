"""Pure derivation rules for stage 10's sidecars.

Separate from 10_sidecars.py for the same reason as _artifacts, _totals and
_districts: `10_sidecars` is not a legal module name, and the rule that a
ZIP resolving both ways must keep both answers is exactly the kind of thing
that is silent to get wrong — a dict keyed only by zip5 would let a zip3
answer quietly overwrite, or be overwritten by, an exact one.
"""


def build_search_index(district_rows, candidate_rows):
    """[{geoid, state, cd, district_name, candidates: [...]}], one entry per
    district. `district_rows` is (geoid, state, cd, district_name);
    `candidate_rows` is (geoid, cand_id, cand_name, cand_party) — these are
    FILED PUBLIC CANDIDATES from candidate_totals, never itcont.txt
    contributors, so the individual-name invariant does not apply to them.
    """
    candidates_by_geoid = {}
    for geoid, cand_id, cand_name, cand_party in candidate_rows:
        candidates_by_geoid.setdefault(str(geoid), []).append({
            "cand_id": cand_id, "cand_name": cand_name, "cand_party": cand_party,
        })
    return [
        {
            "geoid": str(geoid), "state": state, "cd": str(cd),
            "district_name": district_name,
            "candidates": sorted(
                candidates_by_geoid.get(str(geoid), []),
                key=lambda c: c["cand_id"]),
        }
        for geoid, state, cd, district_name in district_rows
    ]


def build_zip_crosswalk(exact_rows, prefix_rows):
    """{"by_zip5": {...}, "by_zip3": {...}} — two separate namespaces so an
    exact and a prefix answer can never be equated by a consumer that only
    looked at one dict. Every entry carries `resolution` explicitly, even
    though which dict it lives in already says so, because a row handed to
    a renderer in isolation must still be able to say what kind of answer it
    is.

    `exact_rows` is (zip5, district_geoid, overlap_share, is_primary,
    resolution); `prefix_rows` is (zip3, district_geoid, supporting_zips,
    resolution). A ZIP present in both keeps both — the whole point of the
    two-namespace shape.
    """
    by_zip5 = {}
    for zip5, geoid, overlap_share, is_primary, resolution in exact_rows:
        by_zip5.setdefault(zip5, []).append({
            "district_geoid": str(geoid),
            "resolution": resolution,
            "overlap_share": float(overlap_share) if overlap_share is not None else None,
            "is_primary": bool(is_primary),
        })
    by_zip3 = {}
    for zip3, geoid, supporting_zips, resolution in prefix_rows:
        by_zip3.setdefault(zip3, []).append({
            "district_geoid": str(geoid),
            "resolution": resolution,
            "supporting_zips": int(supporting_zips),
        })
    return {"by_zip5": by_zip5, "by_zip3": by_zip3}
