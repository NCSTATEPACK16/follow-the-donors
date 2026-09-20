"""Stage 06 — PAC money aggregated onto congressional districts.

The base map: PAC dollars flowing IN to each district's representative,
broken down by the donor's tier and sector, carrying the district's map
vintage on every row.

THE SPINE OF THIS STAGE IS A PARTITION, NOT A FILTER. Every contribution
dollar lands in exactly one of five buckets — district, statewide (Senate),
national (President), unassignable (a candidate whose district no longer
exists), or unresolved (no candidate at all) — and the five are asserted to
sum back to the hygiene total to the cent. That is what makes "PAC money in
this district" checkable rather than asserted, the same role the
reconciliation gate plays in 03_hygiene. A join that fanned out, a filter
that dropped rows, a Senate race leaking into an at-large district: all of
them break the sum, which is the point.

Senate and presidential money is deliberately NOT district money. FEC stores
a Senate candidate's district as '00', the same code an at-large House seat
uses, so this is one bad join away from pouring every Senate dollar in
Wyoming into Wyoming's only House district. See scripts/_aggregate.py.

Cross-cycle comparison is gated on the map vintage. A district whose state
redrew is drawn on cd119 while its voters use different lines, so its 2024
and 2026 totals describe different places; `comparable_across_cycles` says so
per row rather than leaving Phase 5 to work it out.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _aggregate as A
import _districts as D
from _db import CYCLES, DATA, GATE_CYCLES, connect, table_exists
from _report import Report, fmt_int, fmt_money, fmt_pct

INTERIM = os.path.join(DATA, "interim")

#: Share of a cycle's contribution dollars allowed to reach no district for a
#: reason other than office. Measured 0.046% for 2024 — candidates carrying a
#: district from a map that no longer exists (CA-53, PA-18, MT-00 before
#: Montana regained its second seat), still registered in cn.txt. Ratcheted
#: with headroom, since an amendment can add one at any time.
MAX_UNASSIGNABLE_SHARE = 0.005

#: The partition must close exactly. A cent of tolerance is for DECIMAL
#: display only — any real leak is orders of magnitude larger than this.
RECONCILE_TOLERANCE = 0.01


def build_attribution(con, cycle):
    """One row per contribution, carrying the bucket it belongs to.

    cn is joined 1:1 — CAND_ID is unique within a cycle, verified — so this
    cannot fan out, which is what makes the partition below trustworthy.
    """
    con.execute(f"""
        CREATE OR REPLACE TABLE attribution_{cycle} AS
        SELECT x.sub_id, x.amount, x.cand_id, x.donor_cmte_id,
               n.CAND_OFFICE AS office, n.CAND_OFFICE_ST AS office_st,
               n.CAND_OFFICE_DISTRICT AS office_cd, n.CAND_NAME AS cand_name,
               n.CAND_PTY_AFFILIATION AS cand_party,
               CASE
                 WHEN x.cand_id IS NULL OR n.CAND_ID IS NULL THEN 'unresolved'
                 WHEN n.CAND_OFFICE = 'S' THEN 'statewide'
                 WHEN n.CAND_OFFICE = 'P' THEN 'national'
                 WHEN d.district_geoid IS NOT NULL THEN 'district'
                 ELSE 'unassignable'
               END AS bucket,
               d.district_geoid
        FROM contributions_{cycle} x
        LEFT JOIN cn n ON n.CAND_ID = x.cand_id AND n.cycle = '{cycle}'
        LEFT JOIN districts d
          ON n.CAND_OFFICE = '{A.HOUSE}'
         AND d.state_usps = n.CAND_OFFICE_ST
         AND d.cd = CASE
                      WHEN n.CAND_OFFICE_ST IN {tuple(sorted(A.DELEGATIONS))}
                       AND n.CAND_OFFICE_DISTRICT = '00'
                      THEN '{A.DELEGATE_CD}'
                      ELSE n.CAND_OFFICE_DISTRICT
                    END
    """)


def build_outputs(con, cycle):
    """District totals, district x sector, and per-candidate totals."""
    con.execute(f"""
        CREATE OR REPLACE TABLE district_totals_{cycle} AS
        SELECT d.district_geoid, d.state_usps, d.cd, d.district_name,
               '{cycle}' AS cycle,
               d.map_status, d.map_vintage, d.legal_status, d.notes,
               coalesce(sum(a.amount), 0) AS pac_dollars,
               count(a.sub_id) AS contributions,
               count(DISTINCT a.cand_id) AS candidates,
               count(DISTINCT a.donor_cmte_id) AS donor_committees
        FROM districts d
        LEFT JOIN attribution_{cycle} a
               ON a.district_geoid = d.district_geoid AND a.bucket = 'district'
        GROUP BY ALL
    """)
    # Sector and tier come from the DONOR committee — whose money it is, not
    # whose committee received it.
    con.execute(f"""
        CREATE OR REPLACE TABLE district_sector_{cycle} AS
        SELECT a.district_geoid, '{cycle}' AS cycle,
               co.tier, co.sector,
               sum(a.amount) AS pac_dollars,
               count(*) AS contributions
        FROM attribution_{cycle} a
        JOIN committees co
          ON co.cmte_id = a.donor_cmte_id AND co.cycle = '{cycle}'
        WHERE a.bucket = 'district'
        GROUP BY ALL
    """)
    con.execute(f"""
        CREATE OR REPLACE TABLE candidate_totals_{cycle} AS
        SELECT a.cand_id, any_value(a.cand_name) AS cand_name,
               any_value(a.cand_party) AS cand_party,
               any_value(a.office) AS office, '{cycle}' AS cycle,
               a.bucket, a.district_geoid,
               sum(a.amount) AS pac_dollars,
               count(*) AS contributions,
               count(DISTINCT a.donor_cmte_id) AS donor_committees
        FROM attribution_{cycle} a
        WHERE a.cand_id IS NOT NULL
        GROUP BY a.cand_id, a.bucket, a.district_geoid
    """)


def partition(con, cycle):
    """(bucket -> dollars, total) for the cycle. The five must sum to total."""
    rows = con.execute(f"""
        SELECT bucket, sum(amount), count(*) FROM attribution_{cycle}
        GROUP BY 1 ORDER BY 2 DESC
    """).fetchall()
    total = con.execute(
        f"SELECT sum(amount) FROM contributions_{cycle}").fetchone()[0]
    return rows, total


def main():
    t0 = time.time()
    os.makedirs(INTERIM, exist_ok=True)
    con = connect()

    if not table_exists(con, "districts"):
        print("districts table missing — run scripts/05_districts.py first")
        return 1

    r = Report("06_aggregate", "Stage 06 — PAC money by congressional district")
    r.kv("Cycles", ", ".join(str(c) for c in CYCLES))
    r.kv("Gated", ", ".join(str(c) for c in GATE_CYCLES))

    for cycle in CYCLES:
        if not table_exists(con, f"contributions_{cycle}"):
            continue
        print(f"  {cycle}…")
        build_attribution(con, cycle)
        build_outputs(con, cycle)
        rows, total = partition(con, cycle)
        by = {b: (amt, n) for b, amt, n in rows}
        summed = sum(amt for amt, _ in by.values())
        district = by.get("district", (0, 0))[0]
        unassignable = by.get("unassignable", (0, 0))[0]

        r.section(f"{cycle}")
        r.para(
            "Every contribution dollar lands in exactly one bucket. The five "
            "are asserted to sum back to the hygiene total, which is what "
            "makes the district figure checkable rather than asserted.")
        r.table(["bucket", "contributions", "dollars", "share"], [
            (f"`{b}`", fmt_int(n), fmt_money(amt),
             fmt_pct(float(amt) / float(total)))
            for b, amt, n in rows])
        r.table(["", ""], [
            ("sum of buckets", fmt_money(summed)),
            ("hygiene total", fmt_money(total)),
            ("difference", fmt_money(summed - total)),
        ])

        drawn = con.execute(f"""
            SELECT count(*), count(*) FILTER (WHERE pac_dollars > 0)
            FROM district_totals_{cycle}""").fetchone()
        stale = con.execute(f"""
            SELECT coalesce(sum(pac_dollars), 0) FROM district_totals_{cycle}
            WHERE map_status = ?""", [D.MAP_SUPERSEDED]).fetchone()[0]
        r.para(
            f"{fmt_int(drawn[1])} of {fmt_int(drawn[0])} districts received "
            f"PAC money. **{fmt_money(stale)} of it "
            f"({fmt_pct(float(stale) / float(district) if district else 0)}) "
            "sits in districts drawn from a map that is no longer the law** — "
            "the dollar-weighted version of the 39.23% of districts stage 05 "
            "measured. Those rows carry `map_status` and are not comparable "
            "across cycles.")

        top = con.execute(f"""
            SELECT state_usps, cd, pac_dollars, map_status
            FROM district_totals_{cycle}
            ORDER BY pac_dollars DESC LIMIT 5""").fetchall()
        r.table(["district", "PAC dollars", "map_status"],
                [(f"{s}-{cd}", fmt_money(amt), f"`{ms}`")
                 for s, cd, amt, ms in top])

        if cycle in GATE_CYCLES:
            r.check(f"{cycle} partition sums to the hygiene total",
                    abs(float(summed) - float(total)) <= RECONCILE_TOLERANCE,
                    f"{fmt_money(summed)} vs {fmt_money(total)}")
            share = float(unassignable) / float(total) if total else 0
            r.check(f"{cycle} unassignable share within tolerance",
                    share <= MAX_UNASSIGNABLE_SHARE,
                    f"{fmt_pct(share)} (maximum "
                    f"{fmt_pct(MAX_UNASSIGNABLE_SHARE)})")
            r.check(f"{cycle} no statewide or national money reached a district",
                    con.execute(f"""
                        SELECT count(*) FROM attribution_{cycle}
                        WHERE bucket IN ('statewide', 'national')
                          AND district_geoid IS NOT NULL""").fetchone()[0] == 0,
                    "Senate and presidential dollars carry no district")
            r.check(f"{cycle} every district row carries its map vintage",
                    con.execute(f"""
                        SELECT count(*) FROM district_totals_{cycle}
                        WHERE map_status IS NULL OR map_vintage IS NULL
                    """).fetchone()[0] == 0,
                    "map_status and map_vintage non-null")
            dup = con.execute(f"""
                SELECT count(*), coalesce(sum(amount), 0) FROM (
                    SELECT amount, row_number() OVER (
                        PARTITION BY sub_id ORDER BY cand_id) AS rk
                    FROM contributions_{cycle}) WHERE rk > 1""").fetchone()
            r.check(f"{cycle} no contribution is counted twice",
                    dup[0] == 0,
                    f"{fmt_int(dup[0])} duplicated rows, {fmt_money(dup[1])} "
                    "double-counted — one pas2 row reaching two candidates "
                    "through ccl")

            r.check(f"{cycle} district x sector reconciles to district totals",
                    abs(float(con.execute(
                        f"SELECT coalesce(sum(pac_dollars), 0) "
                        f"FROM district_sector_{cycle}").fetchone()[0])
                        - float(district)) <= RECONCILE_TOLERANCE,
                    "every district dollar carries a donor tier and sector")

        for table, name in (
                (f"district_totals_{cycle}", f"district_totals_{cycle}"),
                (f"district_sector_{cycle}", f"district_sector_{cycle}"),
                (f"candidate_totals_{cycle}", f"candidate_totals_{cycle}")):
            out = os.path.join(INTERIM, name + ".parquet")
            con.execute(f"COPY {table} TO '{out}' (FORMAT parquet)")

    r.kv("Elapsed", f"{time.time() - t0:.1f}s")
    con.close()
    return r.write()


if __name__ == "__main__":
    sys.exit(main())
