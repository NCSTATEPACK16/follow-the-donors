"""Acceptance gate for the reconciliation, against the real gitignored data.

Not a unit test — it validates data, so it skips when data/fec.duckdb is
absent (CI, fresh clone). Thresholds and the outlier roster come from
reports/03_hygiene.md and the Phase 0 spike.

The outliers are asserted on MEMBERSHIP and RATIO, never on exact dollars.
FEC data is live and amended; pinning dollars would fail on every routine
amendment and train us to ignore the gate — the same reasoning that made the
gate three parts instead of a per-candidate tolerance.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import _hygiene
from _db import DB_PATH, GATE_CYCLES

pytestmark = pytest.mark.skipif(
    not os.path.exists(DB_PATH),
    reason="requires the local gitignored data/ tree (run scripts 01-03)")

CYCLE = GATE_CYCLES[0]

#: The ten largest unexplained gaps at the time of the Phase 0 spike,
#: reproduced exactly by stage 03. A NEW name displacing one of these on a
#: CLOSED cycle can only mean our logic changed, which is the regression this
#: roster exists to catch.
NAMED_OUTLIERS = {
    "H0LA01087",  # SCALISE, STEVE
    "S2PA00661",  # MCCORMICK, DAVE
    "P40010977",  # HALEY, NIKKI
    "H6CA22125",  # MCCARTHY, KEVIN
    "S4SC00240",  # SCOTT, TIMOTHY E.
    "S2TX00312",  # CRUZ, TED
    "P80000722",  # BIDEN, JOSEPH R JR
    "P00009423",  # HARRIS, KAMALA
    "S8AZ00197",  # SINEMA, KYRSTEN
    "S2NV00308",  # BROWN, SAM
}


@pytest.fixture(scope="module")
def con():
    duckdb = pytest.importorskip("duckdb")
    c = duckdb.connect(DB_PATH, read_only=True)
    if not c.execute("SELECT count(*) FROM duckdb_tables() "
                     "WHERE table_name = ?",
                     [f"reconciliation_{CYCLE}"]).fetchone()[0]:
        pytest.skip("run scripts/03_hygiene.py first")
    return c


def test_aggregate_reconciles_within_tolerance(con):
    """The national number is the one part of the gate that genuinely holds;
    everything published downstream rests on it."""
    _, _, diff = _hygiene.aggregate_diff(con, CYCLE)
    assert abs(diff) <= 0.015, f"aggregate difference {diff:+.2%}"


def test_coverage_floor_does_not_regress(con):
    """Ratcheted to the achieved 44.04%. Only ever revise upward."""
    within, comparable = _hygiene.coverage_within(con, CYCLE, 0.05)
    assert within / comparable >= 0.44


def test_named_outliers_still_dominate_the_gap(con):
    """Membership, not dollars. Every known outlier must still be among the
    largest gaps; one dropping out silently would mean a change we did not
    reason about."""
    top15 = {row[0] for row in _hygiene.top_outliers(con, CYCLE, 15)}
    assert NAMED_OUTLIERS <= top15, f"dropped out: {NAMED_OUTLIERS - top15}"


def test_no_unknown_candidate_enters_the_top_ten(con):
    """2024 is a closed cycle. A new name at the top of the gap list cannot be
    new money — it can only be our logic changing."""
    top10 = {row[0] for row in _hygiene.top_outliers(con, CYCLE, 10)}
    assert not (top10 - NAMED_OUTLIERS), f"unexpected: {top10 - NAMED_OUTLIERS}"


def test_scalise_gap_remains_unexplained(con):
    """Recorded, not resolved. His principal committee shows ~$2.03M of
    24K/24Z against weball's $187,000. If a future change makes this ratio
    normal, that is a result to understand and write down — not to let pass
    silently because the number finally looks nice."""
    row = con.execute(
        f"SELECT computed, reported FROM reconciliation_{CYCLE} "
        "WHERE cand_id = 'H0LA01087'").fetchone()
    assert row is not None
    computed, reported = float(row[0]), float(row[1])
    assert computed / reported > 5, (
        f"SCALISE ratio is now {computed / reported:.1f}x — if this was "
        "deliberately fixed, explain it here and update the test")


def test_no_independent_expenditure_reached_the_contribution_set(con):
    """The 8.7x error, asserted against real data rather than constants."""
    n = con.execute(
        f"SELECT count(*) FROM contributions_{CYCLE} WHERE transaction_tp IN "
        + _hygiene._types(_hygiene.INDEPENDENT_EXPENDITURE_TYPES)).fetchone()[0]
    assert n == 0


def test_bulk_file_still_supersedes_amendments(con):
    """The justification for NOT running a supersession filter. If SUB_ID ever
    stops being unique, that reasoning is void and the filter question reopens."""
    d = _hygiene.measure_amendment_filter_damage(con, CYCLE)
    assert d["rows"] == d["distinct_sub_id"]
    assert d["would_delete_rows"] > d["colliding_rows"] * 10
