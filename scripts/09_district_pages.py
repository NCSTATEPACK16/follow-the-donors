"""Stage 09 — one JSON page per congressional district.

Each page is what the district sheet reads when a visitor taps a district:
its totals, its sector mix folded to the measured SECTOR_ORDER, its top donor
committees by name (permitted — see invariant 1's FEC carve-out quote), and
its map vintage with provenance. Nothing here is sourced from `itcont.txt`;
committee names are political-committee data, never individual-contributor
data, and the acceptance checks assert that explicitly rather than by
omission.

Depends on stage 07 (data/artifacts/districts-{cycle}-v1.geojson) only to
cross-check the total; it does not read stage 07's files, it re-derives from
the same tables so the two are two independent paths to one number.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _artifacts as A
from _db import CYCLES, DATA, connect, table_exists
from _report import Report, fmt_int, fmt_money

ARTIFACTS = os.path.join(DATA, "artifacts")
DISTRICTS_DIR = os.path.join(ARTIFACTS, "districts")

#: Individual-contributor fields from itcont.txt that must never appear in a
#: published page. Checked by KEY, not by absence of a specific value, so the
#: check is real: a page that happened not to mention "name" today but has
#: the key present tomorrow still fails.
FORBIDDEN_KEYS = {"name", "employer", "occupation", "city", "individual_name",
                   "donor_name", "contributor_name"}

EXPECTED_DISTRICTS = 441
TOP_COMMITTEES_LIMIT = 10


def build_page(con, cycle, geoid):
    total = con.execute(f"""
        SELECT state_usps, cd, district_name, map_status, map_vintage,
               pac_dollars, contributions, candidates, donor_committees
        FROM district_totals_{cycle}
        WHERE district_geoid = ?
    """, [geoid]).fetchone()
    (state, cd, name, map_status, map_vintage, pac_dollars, contributions,
     candidates, donor_committees) = total

    # legal_status and provenance_url live on district_vintage, not
    # district_totals — 06_aggregate.py never pulled provenance_url through,
    # and it is cycle-independent (redistricting vintage does not change
    # cycle to cycle) so joining the registry table directly is correct
    # rather than a workaround.
    vintage = con.execute("""
        SELECT legal_status, provenance_url
        FROM district_vintage WHERE district_geoid = ?
    """, [geoid]).fetchone()
    legal_status, provenance_url = vintage

    sector_rows = con.execute(f"""
        SELECT sector, pac_dollars
        FROM district_sector_{cycle}
        WHERE district_geoid = ?
        ORDER BY pac_dollars DESC
    """, [geoid]).fetchall()
    # No `pac_dollars > 0` filter here, unlike stage 07's cosmetic sectors
    # file: a sector that nets negative (refunds exceeding receipts) is real
    # money and dropping it would break the page-total-equals-sum-of-sectors
    # check below. See district 5110, 2024's Unclassified sector: -$17,620.
    sector_cents = [[sector, A.dollars_to_cents(dollars)]
                     for sector, dollars in sector_rows]
    sectors = A.fold_sectors_to_top5(sector_cents)

    committee_rows = con.execute(f"""
        SELECT co.cmte_id, co.cmte_name, co.tier, co.sector,
               SUM(a.amount) AS dollars
        FROM attribution_{cycle} a
        JOIN committees co
          ON co.cmte_id = a.donor_cmte_id AND co.cycle = '{cycle}'
        WHERE a.bucket = 'district' AND a.district_geoid = ?
        GROUP BY 1, 2, 3, 4
    """, [geoid]).fetchall()
    top_pacs = A.top_committees(committee_rows, limit=TOP_COMMITTEES_LIMIT)

    cycle_s = str(cycle)
    return {
        "geoid": str(geoid),
        "cycle": cycle_s,
        "state": state,
        "cd": str(cd),
        # "district_name", never the bare "name" — that key is one this
        # module's own itcont.txt guard treats as individual-shaped, and the
        # collision is deliberate: it forces this field to be unambiguously
        # about the district, not a person.
        "district_name": name,
        "map_status": map_status,
        "map_vintage": map_vintage,
        "legal_status": A.or_not_applicable(legal_status),
        "provenance_url": A.or_not_applicable(provenance_url),
        "filing_period": A.FILING_PERIOD[cycle_s],
        "pac_cents": A.dollars_to_cents(pac_dollars),
        "contributions": int(contributions),
        "candidates": int(candidates),
        "donor_committees": int(donor_committees),
        "sectors": sectors,
        "top_committees": top_pacs,
    }


def no_forbidden_keys(obj):
    """Walk a page looking for any itcont.txt-shaped key. Returns the first
    offending key path found, or None."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str) and k.lower() in FORBIDDEN_KEYS:
                return k
            found = no_forbidden_keys(v)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = no_forbidden_keys(item)
            if found:
                return found
    return None


def main():
    t0 = time.time()
    os.makedirs(DISTRICTS_DIR, exist_ok=True)
    con = connect(read_only=True)

    if not table_exists(con, "district_totals_2024"):
        print("district_totals_2024 missing — run scripts/06_aggregate.py first")
        return 1

    r = Report("09_district_pages", "Stage 09 — district pages")
    r.kv("Cycles", ", ".join(str(c) for c in CYCLES))

    for cycle in CYCLES:
        cycle_s = str(cycle)
        if not table_exists(con, f"district_totals_{cycle}"):
            continue

        print(f"  {cycle}…")
        geoids = [row[0] for row in con.execute(
            f"SELECT district_geoid FROM district_totals_{cycle} "
            "ORDER BY district_geoid").fetchall()]

        pages = {}
        for geoid in geoids:
            page = build_page(con, cycle, geoid)
            pages[geoid] = page
            path = os.path.join(DISTRICTS_DIR, f"{geoid}-{cycle}-v1.json")
            with open(path, "w") as fh:
                json.dump(page, fh, separators=(",", ":"))

        # Only this cycle's files, not the other cycle's, and no leftovers
        # from a stale geoid a previous rebuild produced but this one didn't.
        expected_files = {f"{g}-{cycle}-v1.json" for g in geoids}
        on_disk = {f for f in os.listdir(DISTRICTS_DIR) if f.endswith(f"-{cycle}-v1.json")}
        extras = on_disk - expected_files

        db_total_cents = A.dollars_to_cents(con.execute(
            f"SELECT SUM(pac_dollars) FROM district_totals_{cycle}"
        ).fetchone()[0])
        page_total_cents = sum(p["pac_cents"] for p in pages.values())

        sector_mismatches = sum(
            1 for p in pages.values()
            if sum(c for _, c in p["sectors"]) != p["pac_cents"]
        )

        forbidden_hits = [
            (geoid, key) for geoid, p in pages.items()
            if (key := no_forbidden_keys(p)) is not None
        ]

        missing_vintage = [
            geoid for geoid, p in pages.items()
            if p["map_status"] is None or p["map_vintage"] is None
            or p["legal_status"] is None or p["provenance_url"] is None
            or p["filing_period"] is None
        ]

        r.section(f"{cycle_s}")
        r.para(
            f"{fmt_int(len(pages))} pages · {fmt_money(page_total_cents/100)} "
            "across them.")
        top_by_money = sorted(pages.values(), key=lambda p: -p["pac_cents"])[:5]
        r.table(["district", "PAC dollars", "top committee"], [
            (f"{p['state']}-{p['cd']}", fmt_money(p["pac_cents"] / 100),
             p["top_committees"][0]["cmte_name"] if p["top_committees"] else "—")
            for p in top_by_money
        ])

        r.check(f"{cycle_s} exactly {EXPECTED_DISTRICTS} pages, one per "
                "district_geoid, no extras",
                len(pages) == EXPECTED_DISTRICTS and not extras,
                f"{len(pages)} pages, {len(extras)} extra file(s)")

        r.check(f"{cycle_s} every page's sector dollars sum to its total, "
                "to the cent",
                sector_mismatches == 0,
                f"{sector_mismatches} page(s) where sectors != total")

        r.check(f"{cycle_s} pages sum to stage 07's district total, to the "
                "cent",
                page_total_cents == db_total_cents,
                f"{page_total_cents} vs {db_total_cents}")

        r.check(f"{cycle_s} no page contains an itcont.txt-shaped key",
                len(forbidden_hits) == 0,
                f"{len(forbidden_hits)} offending key(s): "
                f"{forbidden_hits[:3]}" if forbidden_hits else "none found")

        r.check(f"{cycle_s} every page carries map_status, map_vintage, "
                "legal_status, provenance_url, filing_period",
                len(missing_vintage) == 0,
                f"{len(missing_vintage)} page(s) missing a field")

    r.kv("Elapsed", f"{time.time() - t0:.1f}s")
    con.close()
    return r.write()


if __name__ == "__main__":
    sys.exit(main())
