"""Hygiene and reconciliation rules.

Separate from 03_hygiene.py so every rule here is unit-testable — a module
named `03_hygiene` cannot be imported. These rules are the correctness story
of the whole project, and each one is here because a measurement said so.
"""

#: Money a candidate actually RECEIVED. 24K is a contribution to a
#: non-affiliated committee; 24Z is an in-kind.
CONTRIBUTION_TYPES = ("24K", "24Z")

#: Money spent ABOUT a candidate, which by law may not be coordinated with
#: them and never enters their account. In pas2 2024 these total
#: $4,497,565,949 against $514,269,264 of actual contributions — summing pas2
#: without splitting by transaction type overstates money given to a candidate
#: by 8.7x. This is a category error, not a duplication, and it is the largest
#: correctness risk in the dataset. NEVER add these to CONTRIBUTION_TYPES.
INDEPENDENT_EXPENDITURE_TYPES = ("24A", "24E")

#: Also not candidate receipts: 24C is a coordinated party expenditure and
#: 24F a communication cost. Named so nobody has to rediscover why they are
#: missing from the sum.
OTHER_NON_RECEIPT_TYPES = ("24C", "24F")

#: Itemized sub-transactions that restate money already counted in a parent
#: line. Removes $4,053,118 from 24K/24Z in 2024.
MEMO_EXCLUDED = "X"


#: A candidate's own committees — principal (P) and other authorized (A).
#: Only these resolve a contribution to a candidate. A joint fundraising
#: committee links to every candidate it raises for (C00493783 links to 16 in
#: 2024), and a leadership PAC to its sponsor; attributing a JFC's receipts to
#: all of them multiplies the money, and to one of them invents a recipient.
#: Both tiers are kept separate by invariant 8 anyway, and measured, no 24K or
#: 24Z in pas2 is received by a committee outside P/A — so this costs nothing
#: and closes the hole structurally.
AUTHORIZED_DESIGNATIONS = ("P", "A")


def _types(seq):
    return "(" + ", ".join(f"'{t}'" for t in seq) + ")"


def candidate_link_sql(cycle):
    """ccl reduced to exactly one candidate per recipient committee.

    ccl is not unique on CMTE_ID: 190 committees in 2024 (262 in 2026) link to
    more than one CAND_ID, so joining on CMTE_ID alone turned 9,972 pas2 rows
    into two contributions each and double-counted $2,545,768 — manufacturing
    SUB_ID collisions the bulk file does not have.

    164 of those 190 are one person with two registrations (GRAYSON ran for
    Senate in 2016 and again in 2024 on the same committee), so the most
    recent registration is the candidacy receiving the money. FEC_ELECTION_YR
    orders them and LINKAGE_ID breaks ties, because an arbitrary tiebreak
    would move money between candidates from one rebuild to the next.
    """
    return f"""
        SELECT CMTE_ID, CAND_ID FROM ccl
        WHERE cycle = '{cycle}'
          AND CMTE_DSGN IN {_types(AUTHORIZED_DESIGNATIONS)}
        QUALIFY row_number() OVER (
            PARTITION BY CMTE_ID
            ORDER BY FEC_ELECTION_YR DESC, LINKAGE_ID DESC) = 1
    """


def build_contributions(con, cycle):
    """Cleaned contributions for one cycle, with the candidate resolved.

    Two rules are load-bearing here:

    RESOLVE THROUGH THE RECIPIENT, NOT THE DONOR'S CLAIM. pas2 carries its own
    CAND_ID column, and it is not trustworthy: summing on it reconciles at
    -6.79%, while resolving pas2.OTHER_ID -> ccl.CMTE_ID -> CAND_ID reconciles
    at -0.61%. The donor reports who they think they paid; the recipient
    committee's registration is the fact.

    NO AMENDMENT SUPERSESSION. The widely repeated prescription — drop N
    records where an A exists for the same committee and report type — would
    delete 16,098 rows / $36.8M, against only 600 rows that genuinely collide
    across AMNDT_IND. SUB_ID is unique across all 703,597 rows: the bulk file
    already supersedes. Implementing that filter destroys data. See
    measure_amendment_filter_damage(), which keeps the number live rather than
    letting it rot into folklore.
    """
    con.execute(f"""
        CREATE OR REPLACE TABLE contributions_{cycle} AS
        SELECT c.CAND_ID       AS cand_id,
               p.OTHER_ID      AS recipient_cmte_id,
               p.CMTE_ID       AS donor_cmte_id,
               p.TRANSACTION_TP AS transaction_tp,
               p.amount        AS amount,
               p.txn_date      AS txn_date,
               p.SUB_ID        AS sub_id
        FROM pas2 p
        JOIN ({candidate_link_sql(cycle)}) c
          ON c.CMTE_ID = p.OTHER_ID
        WHERE p.cycle = '{cycle}'
          AND p.TRANSACTION_TP IN {_types(CONTRIBUTION_TYPES)}
          AND (p.MEMO_CD IS NULL OR p.MEMO_CD <> '{MEMO_EXCLUDED}')
    """)


def build_reconciliation(con, cycle):
    """Per-candidate computed vs what the candidate's own committees reported.

    Target is weball's OTHER_POL_CMTE_CONTRIB + POL_PTY_CONTRIB. Never add
    TRANS_FROM_AUTH: those are mostly a candidate's own inter-committee
    movements, they never appear in pas2, and including them takes agreement
    from -0.6% to -73.8%.
    """
    con.execute(f"""
        CREATE OR REPLACE TABLE reconciliation_{cycle} AS
        WITH computed AS (
            SELECT cand_id, sum(amount) AS computed
            FROM contributions_{cycle} GROUP BY 1
        ), reported AS (
            SELECT CAND_ID AS cand_id, CAND_NAME AS cand_name,
                   COALESCE(pac_contrib_amt, 0)
                 + COALESCE(party_contrib_amt, 0) AS reported
            FROM weball WHERE cycle = '{cycle}'
        )
        SELECT r.cand_id, r.cand_name, c.computed, r.reported,
               c.computed - r.reported AS gap,
               CASE WHEN r.reported > 0
                    THEN abs(c.computed - r.reported) / r.reported END AS rel
        FROM computed c JOIN reported r USING (cand_id)
    """)


def aggregate_diff(con, cycle):
    """(computed, reported, relative_difference) over every matched candidate."""
    computed, reported = con.execute(
        f"SELECT sum(computed), sum(reported) FROM reconciliation_{cycle}"
    ).fetchone()
    if not reported:
        return computed, reported, None
    return computed, reported, float(computed - reported) / float(reported)


def coverage_within(con, cycle, pct=0.05):
    """(within, comparable) candidates whose computed is within `pct`.

    Comparable means reported > 0. A candidate reporting zero PAC money has no
    meaningful relative error, and including them would let the coverage
    number be inflated by candidates nobody gave to.
    """
    return con.execute(f"""
        SELECT count(*) FILTER (WHERE rel <= {pct}), count(*)
        FROM reconciliation_{cycle} WHERE rel IS NOT NULL
    """).fetchone()


def top_outliers(con, cycle, n=15):
    """Candidates whose computed and reported disagree most, by absolute gap."""
    return con.execute(f"""
        SELECT cand_id, cand_name, computed, reported, gap
        FROM reconciliation_{cycle}
        ORDER BY abs(gap) DESC LIMIT {n}
    """).fetchall()


def type_totals(con, cycle):
    """Rows and dollars per transaction type — the 8.7x evidence, kept live."""
    return con.execute(f"""
        SELECT TRANSACTION_TP, count(*), sum(amount)
        FROM pas2 WHERE cycle = '{cycle}'
        GROUP BY 1 ORDER BY 3 DESC NULLS LAST
    """).fetchall()


def measure_amendment_filter_damage(con, cycle):
    """What the prescribed supersession filter WOULD delete, vs what collides.

    Kept as a live measurement rather than a comment so the rule stays
    falsifiable: if FEC ever changes how bulk files handle amendments, this
    number moves and the report says so.
    """
    would_delete = con.execute(f"""
        WITH amended AS (
            SELECT DISTINCT CMTE_ID, RPT_TP FROM pas2
            WHERE cycle = '{cycle}' AND AMNDT_IND = 'A'
        )
        SELECT count(*), sum(amount) FROM pas2 p
        WHERE p.cycle = '{cycle}' AND p.AMNDT_IND = 'N'
          AND EXISTS (SELECT 1 FROM amended a
                      WHERE a.CMTE_ID = p.CMTE_ID AND a.RPT_TP = p.RPT_TP)
    """).fetchone()
    genuine = con.execute(f"""
        SELECT count(*), COALESCE(sum(n_rows), 0) FROM (
            SELECT count(*) AS n_rows FROM pas2 WHERE cycle = '{cycle}'
            GROUP BY CMTE_ID, CAND_ID, TRANSACTION_DT, TRANSACTION_AMT,
                     TRANSACTION_TP
            HAVING count(DISTINCT AMNDT_IND) > 1)
    """).fetchone()
    total, distinct_sub = con.execute(f"""
        SELECT count(*), count(DISTINCT SUB_ID) FROM pas2 WHERE cycle = '{cycle}'
    """).fetchone()
    return {"would_delete_rows": would_delete[0],
            "would_delete_dollars": would_delete[1],
            "colliding_groups": genuine[0], "colliding_rows": genuine[1],
            "rows": total, "distinct_sub_id": distinct_sub}
