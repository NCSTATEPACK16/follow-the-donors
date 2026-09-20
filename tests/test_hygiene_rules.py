"""Unit tests for the hygiene rules. No data required."""

import _hygiene


def test_independent_expenditures_are_not_contributions():
    """The single largest correctness risk in the dataset. In pas2 2024 the
    IE types total $4.5bn against $514M of actual contributions — folding them
    together overstates money given to candidates by 8.7x. These two sets must
    never intersect."""
    assert not (set(_hygiene.CONTRIBUTION_TYPES)
                & set(_hygiene.INDEPENDENT_EXPENDITURE_TYPES))


def test_coordinated_and_communication_costs_are_not_contributions():
    """24C is a coordinated party expenditure and 24F a communication cost.
    Neither is money the candidate received either."""
    assert not (set(_hygiene.CONTRIBUTION_TYPES)
                & set(_hygiene.OTHER_NON_RECEIPT_TYPES))


def test_contribution_types_are_exactly_24k_and_24z():
    """Pinned deliberately. Widening this set is the single easiest way to
    silently inflate every figure on the site, so it should require editing a
    test that says so."""
    assert set(_hygiene.CONTRIBUTION_TYPES) == {"24K", "24Z"}


def test_type_list_renders_as_sql_tuple():
    assert _hygiene._types(("24K", "24Z")) == "('24K', '24Z')"


# --- resolving the candidate through the recipient committee ---------------
#
# Measured on the 2024 cycle: joining ccl on CMTE_ID alone turned 9,972 pas2
# rows into two contributions each, double-counting $2,545,768. The bulk file
# guarantees SUB_ID is unique; the pipeline was manufacturing collisions the
# source data never had.

import pytest


@pytest.fixture
def con():
    duckdb = pytest.importorskip("duckdb")
    c = duckdb.connect()
    c.execute("""CREATE TABLE ccl (cycle VARCHAR, CAND_ID VARCHAR,
                 CAND_ELECTION_YR VARCHAR, FEC_ELECTION_YR VARCHAR,
                 CMTE_ID VARCHAR, CMTE_TP VARCHAR, CMTE_DSGN VARCHAR,
                 LINKAGE_ID VARCHAR)""")
    return c


def resolve(con, cmte_id):
    """The candidate the link subquery assigns to a recipient committee."""
    rows = con.execute(
        f"SELECT CAND_ID FROM ({_hygiene.candidate_link_sql('2024')}) "
        f"WHERE CMTE_ID = ?", [cmte_id]).fetchall()
    assert len(rows) <= 1, f"{cmte_id} resolved to {len(rows)} candidates"
    return rows[0][0] if rows else None


def link(con, cand_id, cmte_id, dsgn="P", fec_yr="2024", linkage="1"):
    con.execute("INSERT INTO ccl VALUES ('2024',?,?,?,?,'H',?,?)",
                [cand_id, fec_yr, fec_yr, cmte_id, dsgn, linkage])


def test_a_committee_with_one_candidate_resolves_to_them(con):
    link(con, "H1AA00001", "C001")
    assert resolve(con, "C001") == "H1AA00001"


def test_one_committee_never_resolves_to_two_candidates(con):
    """The defect itself. C00870139 was the principal committee of two
    candidate registrations, so every contribution to it became two."""
    link(con, "S2WI00268", "C001", fec_yr="2018", linkage="258510")
    link(con, "S4WI00256", "C001", fec_yr="2024", linkage="256804")
    assert resolve(con, "C001") == "S4WI00256"


def test_the_most_recent_registration_wins(con):
    """164 of the 190 multi-linked committees in 2024 are one person with two
    registrations — GRAYSON ran for Senate in 2016 and again in 2024 on the
    same committee. The current candidacy is the one receiving the money."""
    link(con, "S6FL00376", "C001", fec_yr="2016", linkage="246389")
    link(con, "S2FL00581", "C001", fec_yr="2024", linkage="246387")
    assert resolve(con, "C001") == "S2FL00581"


def test_a_tie_on_election_year_is_broken_deterministically(con):
    """Two registrations in the same year still has to pick one, and pick the
    same one on every run — otherwise a rebuild silently moves money."""
    link(con, "H2FL13139", "C001", fec_yr="2024", linkage="246411")
    link(con, "H4FL16161", "C001", fec_yr="2024", linkage="253514")
    assert resolve(con, "C001") == "H4FL16161"


def test_a_joint_fundraising_committee_resolves_to_no_candidate(con):
    """C00493783 links to 16 different candidates. Attributing its receipts
    to all 16 multiplies the money by 16; attributing it to one invents a
    recipient. Money to a JFC is JFC money — invariant 8 already keeps that
    tier separate, and this is the same rule at the resolution step."""
    for i in range(3):
        link(con, f"H0ZZ0{i}000", "C001", dsgn="J", linkage=str(i))
    assert resolve(con, "C001") is None


def test_a_leadership_pac_resolves_to_no_candidate(con):
    """Leadership PAC money is a separate tier, never a campaign total."""
    link(con, "H0AL02087", "C001", dsgn="D")
    assert resolve(con, "C001") is None


def test_authorized_committees_are_exactly_principal_and_authorized():
    assert set(_hygiene.AUTHORIZED_DESIGNATIONS) == {"P", "A"}
