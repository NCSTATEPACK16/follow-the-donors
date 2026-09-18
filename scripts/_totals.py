"""Derivation rules for the itemized/unitemized split.

Separate from 01b_totals.py so these can be unit-tested. A stage file is named
`01b_totals.py` and therefore cannot be imported — `01b_totals` is not a legal
Python identifier — so anything that deserves a test lives here.

The rule itself is one subtraction, and the reason it needs a test is that
getting it wrong is silent: an unnoticed clamp-to-zero on negative values, or
an absolute rather than relative receipts tolerance, would both produce a
plausible-looking number that understates how much money is invisible.
"""

#: Relative tolerance when comparing the API's `receipts` against weball's
#: `TTL_RECEIPTS`. They are the same F3 line from the same filings; the floor
#: of $1 keeps a candidate who raised $12 from failing on rounding.
RECEIPTS_TOLERANCE = 0.005
RECEIPTS_FLOOR = 1


def derive_candidate_totals(con):
    """Join API itemized figures to weball and derive the unitemized residual.

    weball's TTL_INDIV_CONTRIB is itemized + unitemized by F3 construction
    (lines 11(a)(i) and 11(a)(ii)), so the residual IS the unitemized mass.
    Negative residuals are kept as negative — see count_negative_unitemized.
    """
    con.execute("""
        CREATE OR REPLACE TABLE candidate_totals AS
        SELECT a.cand_id, a.cycle, a.api_receipts, w.ttl_receipts,
               w.ttl_indiv, a.itemized,
               w.ttl_indiv - a.itemized AS unitemized,
               a.coverage_start, a.coverage_end
        FROM api_totals a JOIN weball w USING (cand_id, cycle)
    """)


def count_receipts_agreement(con):
    """(agreeing, comparable) candidates, by relative tolerance with a floor."""
    return con.execute(f"""
        SELECT
          count(*) FILTER (
            WHERE abs(ttl_receipts - api_receipts)
                  <= greatest(abs(ttl_receipts) * {RECEIPTS_TOLERANCE},
                              {RECEIPTS_FLOOR})),
          count(*)
        FROM candidate_totals
        WHERE ttl_receipts IS NOT NULL AND api_receipts IS NOT NULL
    """).fetchone()


def count_negative_unitemized(con):
    """How many candidates derive a negative unitemized mass.

    These are real — amendment timing between the bulk snapshot and the API —
    and they are counted rather than clamped to zero. Clamping would quietly
    inflate the unitemized total and make the invariant's own number a lie.
    """
    return con.execute(
        "SELECT count(*) FROM candidate_totals WHERE unitemized < 0"
    ).fetchone()[0]


def split_totals(con):
    """(itemized, unitemized, total_individual) over non-negative rows."""
    return con.execute("""
        SELECT sum(itemized), sum(unitemized), sum(ttl_indiv)
        FROM candidate_totals WHERE unitemized >= 0
    """).fetchone()
