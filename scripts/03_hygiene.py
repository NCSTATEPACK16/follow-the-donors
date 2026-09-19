"""Stage 03 — hygiene filters and the reconciliation gate.

This is the stage that makes the pipeline's correctness CHECKABLE rather than
asserted. Everything downstream is built on the claim that our PAC totals
match what candidates themselves told the FEC they received; this is where
that claim either holds or the build stops.

THE GATE IS THREE PARTS, AND THAT IS A FINDING, NOT A STYLE CHOICE.
Aggregate agreement is ~0.6%. Per-candidate agreement is not: the median
relative error is around 7% and p90 exceeds 100%. The errors net out
nationally and are large individually. A strict per-candidate tolerance would
therefore fail on every single run and teach us to ignore the gate, so it is:

    1. aggregate tolerance          — the national number must hold
    2. coverage floor, ratcheted    — the share of candidates within 5% must
                                      not regress
    3. named outliers as regression cases (tests/test_reconciliation_*.py)

ONLY 2024 HARD-GATES. weball26 is a mid-cycle snapshot: partial filing
periods, small denominators, percentage tolerances that behave badly. 2026
computes the identical numbers into this report and never fails the build,
until its own thresholds have been measured and ratcheted. See _db.GATE_CYCLES.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _hygiene
from _db import CYCLES, GATE_CYCLES, connect
from _report import Report, fmt_int, fmt_money, fmt_pct

#: |computed - reported| / reported. Achieved -0.61% for 2024.
AGG_TOLERANCE = 0.015

#: Share of candidates whose computed total is within 5% of reported.
#:
#: Ratcheted 2026-09-18 to 44.4%, the value THIS pipeline achieves after
#: the ccl fan-out fix (44.47%, up from 44.04% — removing the duplicate
#: rows moved candidates INTO agreement). Was 44.0% — not the
#: 45.2% carried in CLAUDE.md and docs/HANDOFF.md. That figure comes from the
#: Phase 0 spike's "rejected alternatives" table, and it could not be
#: reproduced here. What did reproduce, essentially exactly, is every
#: AGGREGATE in that table: the adopted ccl join lands at -0.61% against its
#: -0.64%, and the principal-committee variant at -0.87% against its -0.89%.
#: The spike's own first reconciliation section also reproduces exactly
#: (40.9% within 5%, median 7.83%, on the donor-CAND_ID join). So the join is
#: right and the aggregate is right; the spike's distribution row was computed
#: over a different candidate set than its aggregate row — an internal
#: inconsistency in a script that was explicitly throwaway and is not in the
#: repo. Ratcheting DOWN to a number we cannot reproduce would be worse than
#: useless, so this is set to the measured value and the discrepancy is
#: recorded rather than normalised away.
MIN_COVERAGE_WITHIN_5PCT = 0.444


def main():
    con = connect()
    r = Report("03_hygiene", "Stage 03 — hygiene and the reconciliation gate")
    r.kv("Cycles computed", ", ".join(str(c) for c in CYCLES))
    r.kv("Cycles gated", ", ".join(str(c) for c in GATE_CYCLES)
         + " (others report only)")

    for cycle in CYCLES:
        _hygiene.build_contributions(con, cycle)
        _hygiene.build_reconciliation(con, cycle)

    # ---- transaction types: the 8.7x evidence, recomputed every run -------
    r.section("Transaction types — why the split is not optional")
    for cycle in CYCLES:
        rows = _hygiene.type_totals(con, cycle)
        contrib = sum(d or 0 for t, _, d in rows
                      if t in _hygiene.CONTRIBUTION_TYPES)
        ie = sum(d or 0 for t, _, d in rows
                 if t in _hygiene.INDEPENDENT_EXPENDITURE_TYPES)
        r.section(f"{cycle}", level=3)
        r.table(["type", "rows", "dollars", "treatment"],
                [(f"`{t}`", fmt_int(n), fmt_money(d),
                  "**contribution**" if t in _hygiene.CONTRIBUTION_TYPES
                  else "independent expenditure"
                  if t in _hygiene.INDEPENDENT_EXPENDITURE_TYPES
                  else "not a candidate receipt")
                 for t, n, d in rows])
        if contrib:
            r.para(
                f"Independent expenditures are **{ie / contrib:.1f}x** the "
                f"contributions in {cycle}. Summing pas2 without splitting by "
                "transaction type would overstate money given to candidates by "
                "that factor. An independent expenditure may not legally be "
                "coordinated with the candidate and never enters their "
                "account: a category error, not a duplication.")

    # ---- the amendment filter we deliberately do not implement ------------
    r.section("The amendment filter that is NOT applied")
    dmg_rows = []
    for cycle in CYCLES:
        d = _hygiene.measure_amendment_filter_damage(con, cycle)
        dmg_rows.append((
            cycle, fmt_int(d["rows"]), fmt_int(d["distinct_sub_id"]),
            fmt_int(d["colliding_rows"]),
            f"{fmt_int(d['would_delete_rows'])} / {fmt_money(d['would_delete_dollars'])}"))
    r.table(["cycle", "pas2 rows", "distinct SUB_ID", "rows genuinely colliding",
             "the prescribed filter would delete"], dmg_rows)
    r.para(
        "`SUB_ID` is unique across every row, so the bulk file **already "
        "supersedes**. The widely repeated prescription — drop `N` records "
        "where an `A` exists for the same committee and report type — deletes "
        "orders of magnitude more than actually collides. It is a "
        "data-destroying filter and it is not implemented. This measurement "
        "runs every time rather than living in a comment, so that if FEC ever "
        "changes how bulk files handle amendments, the number moves and this "
        "report says so.")

    # ---- reconciliation ---------------------------------------------------
    r.section("Reconciliation")
    r.para(
        "Computed = 24K + 24Z from pas2, memo-filtered, with the candidate "
        "resolved through the recipient committee (`pas2.OTHER_ID` → "
        "`ccl.CMTE_ID` → `CAND_ID`) rather than through pas2's own "
        "donor-reported `CAND_ID`, which reconciles at -6.79%. Reported = "
        "`weball.OTHER_POL_CMTE_CONTRIB + POL_PTY_CONTRIB`. "
        "`TRANS_FROM_AUTH` is never added: it takes agreement to -73.8%.")

    recon_rows, results = [], {}
    for cycle in CYCLES:
        computed, reported, diff = _hygiene.aggregate_diff(con, cycle)
        within, comparable = _hygiene.coverage_within(con, cycle, 0.05)
        cov = within / comparable if comparable else 0
        results[cycle] = (diff, cov)
        recon_rows.append((
            cycle, fmt_money(computed), fmt_money(reported),
            f"{diff * 100:+.2f}%" if diff is not None else "—",
            f"{fmt_int(within)} / {fmt_int(comparable)} ({fmt_pct(cov)})",
            "**gated**" if cycle in GATE_CYCLES else "report only"))
    r.table(["cycle", "computed", "reported", "aggregate difference",
             "within 5%", "role"], recon_rows)

    r.section("Named outliers")
    r.para(
        "Carried as regression cases, asserted on membership and ratio rather "
        "than exact dollars so routine FEC amendments do not trip them. "
        "SCALISE remains **unexplained** and is recorded rather than "
        "normalised away — an unexplained 10x gap on a House leader is exactly "
        "what must not be quietly smoothed.")
    for cycle in GATE_CYCLES:
        r.table(["candidate", "computed", "reported", "gap"],
                [(f"{name} (`{cid}`)", fmt_money(c), fmt_money(rep), fmt_money(g))
                 for cid, name, c, rep, g in _hygiene.top_outliers(con, cycle, 10)])

    # ---- structural checks -------------------------------------------------
    # These assert the CODE's rules, not the data's shape: they would catch a
    # future edit that quietly folded IEs into the contribution sum.
    ie_leak = sum(
        con.execute(
            f"SELECT count(*) FROM contributions_{c} WHERE transaction_tp IN "
            + _hygiene._types(_hygiene.INDEPENDENT_EXPENDITURE_TYPES)
        ).fetchone()[0] for c in CYCLES)
    non_receipt_leak = sum(
        con.execute(
            f"SELECT count(*) FROM contributions_{c} WHERE transaction_tp IN "
            + _hygiene._types(_hygiene.OTHER_NON_RECEIPT_TYPES)
        ).fetchone()[0] for c in CYCLES)

    r.check("no independent expenditure in the contribution set", ie_leak == 0,
            f"{fmt_int(ie_leak)} rows of {_hygiene.INDEPENDENT_EXPENDITURE_TYPES}")
    r.check("no coordinated/communication cost in the contribution set",
            non_receipt_leak == 0,
            f"{fmt_int(non_receipt_leak)} rows of {_hygiene.OTHER_NON_RECEIPT_TYPES}")
    for cycle in GATE_CYCLES:
        diff, cov = results[cycle]
        r.check(f"{cycle} aggregate tolerance",
                diff is not None and abs(diff) <= AGG_TOLERANCE,
                f"{diff * 100:+.2f}% (tolerance ±{AGG_TOLERANCE * 100:.1f}%)")
        r.check(f"{cycle} coverage floor", cov >= MIN_COVERAGE_WITHIN_5PCT,
                f"{fmt_pct(cov)} (floor {fmt_pct(MIN_COVERAGE_WITHIN_5PCT)})")

    con.close()
    return r.write()


if __name__ == "__main__":
    sys.exit(main())
