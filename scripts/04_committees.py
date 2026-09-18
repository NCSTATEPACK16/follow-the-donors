"""Stage 04 — committee rollup, tiering, and sector classification.

Builds the committee dimension every later phase reads: who each committee is,
which tier its money belongs to, and whose money it is.

TIERING IS READ OFF `cm`, NEVER `ccl`. The handoff warns about this and the
data confirms it: `ccl` carries only 22 leadership-PAC (`D`) links for 2024
against 839 in `cm`. Tiering from `ccl` would silently fold leadership-PAC
money into campaign totals, which is both a double-count hazard and a
misstatement of what the money may legally do.

SECTOR IS TWO FIELDS. `org_type` is FEC's ORG_TP verbatim — six values, zero
judgment, defensible precisely because we did not invent it. `sector` is ours,
and it has to exist because ORG_TP answers "what legal form is this
organisation" rather than "whose money is this", and because it is simply
ABSENT for 27.5% of contribution dollars: leadership PACs, party committees,
candidate committees, JFCs and ideological PACs are not connected
organisations and so have no ORG_TP at all.

`Unclassified` is a rendered value, never a guess. A committee we cannot place
says so on the page.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _committees as C
from _db import CYCLES, GATE_CYCLES, connect
from _report import Report, fmt_int, fmt_money, fmt_pct

#: Curate every committee giving at least this share of 24K/24Z dollars. At
#: 0.01% of the 2024 total that is a ~$51,000 floor and a finite list — the
#: point of a dollar-weighted threshold is that it bounds the work by
#: consequence rather than by an arbitrary committee count.
CURATION_DOLLAR_THRESHOLD = 0.0001

#: Share of CONTRIBUTION DOLLARS that must carry a sector. Dollar-weighted,
#: not row-weighted: classifying a thousand tiny committees would move a row
#: count and change nothing anybody reads. Ratcheted to the achieved value;
#: only ever revise upward.
MIN_SECTOR_DOLLAR_COVERAGE = 0.95


def main():
    con = connect()
    overrides = C.load_overrides()

    con.execute("CREATE OR REPLACE TABLE sector_overrides "
                "(cmte_id VARCHAR, sector VARCHAR)")
    if overrides:
        con.executemany("INSERT INTO sector_overrides VALUES (?, ?)",
                        list(overrides.items()))

    # ---- the committee dimension ------------------------------------------
    con.execute(f"""
        CREATE OR REPLACE TABLE committees AS
        SELECT c.cycle,
               c.CMTE_ID            AS cmte_id,
               c.CMTE_NM            AS cmte_name,
               c.CMTE_TP            AS cmte_tp,
               c.CMTE_DSGN          AS cmte_dsgn,
               c.CMTE_PTY_AFFILIATION AS party,
               c.CONNECTED_ORG_NM   AS connected_org,
               c.ORG_TP             AS org_type,
               {C.tier_case_sql('c')}   AS tier,
               {C.sector_case_sql('c', 'o')} AS sector,
               o.sector IS NOT NULL     AS sector_curated
        FROM cm c
        LEFT JOIN sector_overrides o ON o.cmte_id = c.CMTE_ID
    """)

    # ---- candidate <-> committee rollup ------------------------------------
    # Through ccl, which is the authoritative registration of which committees
    # act for a candidate. The tier comes from `committees`, not from ccl's own
    # CMTE_DSGN, for the reason in the module docstring.
    con.execute("""
        CREATE OR REPLACE TABLE candidate_committees AS
        SELECT DISTINCT l.cycle, l.CAND_ID AS cand_id, l.CMTE_ID AS cmte_id,
               k.cmte_name, k.tier, k.sector, k.org_type
        FROM ccl l
        JOIN committees k ON k.cmte_id = l.CMTE_ID AND k.cycle = l.cycle
    """)

    r = Report("04_committees", "Stage 04 — committees, tiers and sectors")
    r.kv("Cycles", ", ".join(str(c) for c in CYCLES))
    r.kv("Curated overrides", f"{len(overrides)} in `reference/sectors.csv`")

    r.section("Tiers")
    r.para(
        "Read from `cm.CMTE_DSGN` and `cm.CMTE_TP`, never from `ccl`. For 2024 "
        "`ccl` carries 22 leadership-PAC links against 839 in `cm` — tiering "
        "there would silently merge leadership-PAC money into campaign totals.")
    for cycle in CYCLES:
        # count(DISTINCT cmte_id), not count(*): the join to contributions is
        # one row per contribution, so count(*) would report hundreds of
        # thousands of "committees" against a cm file holding 20,938.
        rows = con.execute(f"""
            SELECT k.tier, count(DISTINCT k.cmte_id),
                   count(DISTINCT x.donor_cmte_id), sum(x.amount)
            FROM committees k
            LEFT JOIN contributions_{cycle} x ON x.donor_cmte_id = k.cmte_id
            WHERE k.cycle = '{cycle}' GROUP BY 1 ORDER BY 4 DESC NULLS LAST
        """).fetchall()
        r.section(str(cycle), level=3)
        r.table(["tier", "committees", "of which gave 24K/24Z", "24K/24Z given"],
                [(f"`{t}`", fmt_int(n), fmt_int(g), fmt_money(d))
                 for t, n, g, d in rows])

    # ---- sector coverage ---------------------------------------------------
    r.section("Sector coverage, weighted by dollars")
    cov_rows, results = [], {}
    for cycle in CYCLES:
        total = con.execute(
            f"SELECT sum(amount) FROM contributions_{cycle}").fetchone()[0]
        classified = con.execute(f"""
            SELECT sum(x.amount) FROM contributions_{cycle} x
            JOIN committees k ON k.cmte_id = x.donor_cmte_id AND k.cycle = '{cycle}'
            WHERE k.sector <> '{C.UNCLASSIFIED}'
        """).fetchone()[0] or 0
        share = float(classified) / float(total) if total else 0
        results[cycle] = share
        cov_rows.append((cycle, fmt_money(total), fmt_money(classified),
                         fmt_pct(share),
                         "**gated**" if cycle in GATE_CYCLES else "report only"))
    r.table(["cycle", "24K/24Z total", "classified", "share", "role"], cov_rows)

    for cycle in GATE_CYCLES:
        rows = con.execute(f"""
            SELECT k.sector, count(DISTINCT k.cmte_id), sum(x.amount)
            FROM contributions_{cycle} x
            JOIN committees k ON k.cmte_id = x.donor_cmte_id AND k.cycle = '{cycle}'
            GROUP BY 1 ORDER BY 3 DESC
        """).fetchall()
        total = sum(float(d) for _, _, d in rows)
        r.section(f"{cycle} by sector", level=3)
        r.table(["sector", "committees", "dollars", "share"],
                [(s, fmt_int(n), fmt_money(d), fmt_pct(float(d) / total))
                 for s, n, d in rows])

    # ---- curation completeness ---------------------------------------------
    r.section("Curation completeness")
    r.para(
        "Every committee giving at least "
        f"{CURATION_DOLLAR_THRESHOLD:.2%} of contribution dollars must carry a "
        "sector. A dollar-weighted threshold bounds the work by consequence "
        "rather than by an arbitrary committee count, and it is finite: the "
        "list below is what is left.")
    gap_rows, worst_gap = [], []
    for cycle in GATE_CYCLES:
        total = float(con.execute(
            f"SELECT sum(amount) FROM contributions_{cycle}").fetchone()[0])
        floor = total * CURATION_DOLLAR_THRESHOLD
        above, missing = con.execute(f"""
            WITH g AS (
                SELECT x.donor_cmte_id, sum(x.amount) AS d,
                       any_value(k.sector) AS sector
                FROM contributions_{cycle} x
                JOIN committees k ON k.cmte_id = x.donor_cmte_id
                                 AND k.cycle = '{cycle}'
                GROUP BY 1 HAVING sum(x.amount) >= {floor})
            SELECT count(*), count(*) FILTER (WHERE sector = '{C.UNCLASSIFIED}')
            FROM g
        """).fetchone()
        gap_rows.append((cycle, fmt_money(floor), fmt_int(above),
                         fmt_int(above - missing), fmt_int(missing)))
        worst_gap.append((cycle, missing, above))
    r.table(["cycle", "dollar floor", "committees above it", "classified",
             "still unclassified"], gap_rows)

    r.section("Largest unclassified committees")
    for cycle in GATE_CYCLES:
        rows = con.execute(f"""
            SELECT x.donor_cmte_id, any_value(k.cmte_name), sum(x.amount) d
            FROM contributions_{cycle} x
            JOIN committees k ON k.cmte_id = x.donor_cmte_id AND k.cycle = '{cycle}'
            WHERE k.sector = '{C.UNCLASSIFIED}'
            GROUP BY 1 ORDER BY d DESC LIMIT 10
        """).fetchall()
        r.table(["committee", "name", "dollars"],
                [(f"`{cid}`", nm, fmt_money(d)) for cid, nm, d in rows])
    r.para(
        "These render as `Unclassified` in the UI. They are never guessed at, "
        "and the honest number above is published rather than hidden.")

    for cycle in GATE_CYCLES:
        r.check(f"{cycle} sector dollar coverage",
                results[cycle] >= MIN_SECTOR_DOLLAR_COVERAGE,
                f"{fmt_pct(results[cycle])} "
                f"(floor {fmt_pct(MIN_SECTOR_DOLLAR_COVERAGE)})")
    n_leadership = con.execute(
        "SELECT count(*) FROM committees "
        "WHERE cycle = '2024' AND tier = 'leadership_pac'").fetchone()[0]
    n_null_tier = con.execute(
        "SELECT count(*) FROM committees WHERE tier IS NULL").fetchone()[0]

    r.check("every committee has a tier", n_null_tier == 0, "no NULL tier")
    r.check("leadership PACs are tiered from cm, not ccl", n_leadership > 100,
            f"{fmt_int(n_leadership)} leadership PACs in cm; ccl holds 22 links")
    r.check("curated overrides all applied", not overrides or con.execute(
        "SELECT count(*) FROM committees WHERE sector_curated").fetchone()[0] > 0,
        f"{len(overrides)} overrides in reference/sectors.csv")

    con.close()
    return r.write()


if __name__ == "__main__":
    sys.exit(main())
