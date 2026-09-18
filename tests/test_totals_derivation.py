"""The itemized/unitemized derivation.

Invariant 2 — "itemized is never presented as total" — rests entirely on this
one subtraction, and every way of getting it wrong produces a plausible
number rather than an error. Hence tests.
"""

import decimal

import pytest

import _totals


@pytest.fixture
def con():
    duckdb = pytest.importorskip("duckdb")
    c = duckdb.connect()
    c.execute("""
        CREATE TABLE api_totals (cand_id VARCHAR, cycle VARCHAR,
            api_receipts DECIMAL(18,2), itemized DECIMAL(18,2),
            coverage_start VARCHAR, coverage_end VARCHAR)
    """)
    c.execute("""
        CREATE TABLE weball (cand_id VARCHAR, cycle VARCHAR,
            ttl_receipts DECIMAL(18,2), ttl_indiv DECIMAL(18,2))
    """)
    return c


def add(con, cand_id, api_receipts, itemized, ttl_receipts, ttl_indiv,
        cycle="2024"):
    con.execute("INSERT INTO api_totals VALUES (?,?,?,?,'2023-01-01','2024-12-31')",
                [cand_id, cycle, api_receipts, itemized])
    con.execute("INSERT INTO weball VALUES (?,?,?,?)",
                [cand_id, cycle, ttl_receipts, ttl_indiv])


def test_unitemized_is_the_residual_of_total_individual(con):
    """The real numbers for H0AL01055, the candidate this was spot-verified
    against: $1,063,039.38 individual, $757,652.83 itemized. The 28.7%
    remainder is the money no itemized-only chart can see."""
    add(con, "H0AL01055", 2246839.19, 757652.83, 2246839.19, 1063039.38)
    _totals.derive_candidate_totals(con)
    itemized, unitemized, total = _totals.split_totals(con)
    assert unitemized == decimal.Decimal("305386.55")
    assert itemized + unitemized == total
    assert unitemized / total > decimal.Decimal("0.28")


def test_negative_unitemized_is_counted_not_clamped(con):
    """Amendment timing between the bulk snapshot and the API can make
    itemized exceed the reported individual total. Clamping to zero would
    quietly inflate the unitemized mass and make invariant 2's own headline
    number a lie, so these are counted and reported instead."""
    add(con, "H0000001", 100.0, 500.0, 100.0, 300.0)   # itemized > ttl_indiv
    _totals.derive_candidate_totals(con)
    assert _totals.count_negative_unitemized(con) == 1
    row = con.execute("SELECT unitemized FROM candidate_totals").fetchone()
    assert row[0] == decimal.Decimal("-200.00")


def test_negative_rows_are_excluded_from_the_published_split(con):
    """A negative residual is a data-quality signal, not a negative quantity
    of small donors. It must not drag the national total down."""
    add(con, "H0000001", 100.0, 500.0, 100.0, 300.0)
    add(con, "H0000002", 1000.0, 400.0, 1000.0, 1000.0)
    _totals.derive_candidate_totals(con)
    itemized, unitemized, total = _totals.split_totals(con)
    assert itemized == decimal.Decimal("400.00")
    assert unitemized == decimal.Decimal("600.00")


def test_receipts_agreement_is_relative_not_absolute(con):
    """A $10M candidate off by $1,000 agrees; a $2,000 candidate off by
    $1,000 does not. An absolute tolerance would invert that."""
    add(con, "BIG", 10_001_000.0, 1.0, 10_000_000.0, 1.0)
    add(con, "SMALL", 3_000.0, 1.0, 2_000.0, 1.0)
    _totals.derive_candidate_totals(con)
    agree, comparable = _totals.count_receipts_agreement(con)
    assert (agree, comparable) == (1, 2)


def test_receipts_floor_spares_trivially_small_candidates(con):
    """0.5% of $12 is six cents. Without the absolute floor a candidate who
    raised almost nothing fails the universe check on rounding alone."""
    add(con, "TINY", 12.50, 1.0, 12.00, 1.0)
    _totals.derive_candidate_totals(con)
    assert _totals.count_receipts_agreement(con) == (1, 1)


def test_candidates_absent_from_weball_are_dropped_not_zero_filled(con):
    """The API returns 5,322 candidates for 2024 against weball's 3,856. A
    candidate with no weball row has no known individual total, and inventing
    one as zero would report all their money as itemized."""
    con.execute("INSERT INTO api_totals VALUES "
                "('H0NOTINWEBALL','2024',500.0,500.0,'a','b')")
    _totals.derive_candidate_totals(con)
    assert con.execute("SELECT count(*) FROM candidate_totals").fetchone()[0] == 0
