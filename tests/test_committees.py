"""Tiering and sector classification rules."""

import pytest

import _committees as C


@pytest.fixture
def con():
    duckdb = pytest.importorskip("duckdb")
    c = duckdb.connect()
    c.execute("""CREATE TABLE cm (CMTE_ID VARCHAR, CMTE_TP VARCHAR,
                 CMTE_DSGN VARCHAR, ORG_TP VARCHAR)""")
    c.execute("CREATE TABLE ov (cmte_id VARCHAR, sector VARCHAR)")
    return c


def classify(con, cmte_id, tp, dsgn, org_tp, override=None):
    con.execute("DELETE FROM cm"); con.execute("DELETE FROM ov")
    con.execute("INSERT INTO cm VALUES (?,?,?,?)", [cmte_id, tp, dsgn, org_tp])
    if override:
        con.execute("INSERT INTO ov VALUES (?,?)", [cmte_id, override])
    return con.execute(f"""
        SELECT {C.tier_case_sql('c')}, {C.sector_case_sql('c','o')}
        FROM cm c LEFT JOIN ov o ON o.cmte_id = c.CMTE_ID""").fetchone()


def test_leadership_pac_is_its_own_tier(con):
    """Invariant 8: leadership PAC money is never merged into a campaign
    total. It is both a double-count hazard and a misstatement of what the
    money may legally do."""
    tier, sector = classify(con, "C1", "Q", "D", None)
    assert tier == "leadership_pac"
    assert sector == "Leadership PAC"


def test_leadership_designation_outranks_a_corporate_sponsor(con):
    """A leadership PAC sponsored by a corporation is leadership-PAC money
    first. If ORG_TP won here the separation invariant 8 requires would
    quietly stop existing."""
    tier, sector = classify(con, "C1", "Q", "D", "C")
    assert (tier, sector) == ("leadership_pac", "Leadership PAC")


def test_joint_fundraising_is_separated_too(con):
    tier, _ = classify(con, "C1", "N", "J", None)
    assert tier == "joint_fundraising"


def test_super_pac_is_not_an_authorized_committee(con):
    tier, _ = classify(con, "C1", "O", "U", None)
    assert tier == "super_pac"


def test_principal_campaign_committee_is_authorized(con):
    tier, sector = classify(con, "C1", "H", "P", None)
    assert tier == "authorized"
    assert sector == "Candidate Committee"


def test_org_tp_maps_to_sector_without_judgment(con):
    """FEC's six ORG_TP values are legal forms and the mapping is mechanical.
    org_type still carries the raw letter alongside."""
    assert classify(con, "C1", "Q", "U", "L")[1] == "Labor"
    assert classify(con, "C1", "Q", "U", "T")[1] == "Trade Association"
    assert classify(con, "C1", "Q", "U", "C")[1] == "Corporate"
    assert classify(con, "C1", "Q", "U", "W")[1] == "Corporate"


def test_unknown_committee_is_unclassified_not_guessed(con):
    """27.5% of contribution dollars come from committees with no ORG_TP.
    Whatever we cannot place says so on the page rather than being assigned a
    plausible-looking sector."""
    assert classify(con, "C1", "Q", "U", None)[1] == C.UNCLASSIFIED


def test_curated_override_beats_every_structural_rule(con):
    """reference/sectors.csv is the only place a human decision is recorded.
    A structural rule that could silently outrank it would make the file
    untrustworthy."""
    assert classify(con, "C1", "Q", "U", "C", override="Health")[1] == "Health"
    assert classify(con, "C1", "X", "U", None, override="Energy")[1] == "Energy"


def test_override_file_skips_its_own_comment_block(tmp_path):
    """The curation rules live in `#` lines at the top of the file, next to
    the data they govern. csv.DictReader would otherwise read the first
    comment as the header and silently yield nothing at all."""
    p = tmp_path / "sectors.csv"
    p.write_text("# why this file exists\n# more prose\n"
                 "cmte_id,sector,note\nC00000001,Health,AMA\n")
    assert C.load_overrides(str(p)) == {"C00000001": "Health"}


def test_missing_override_file_is_not_an_error(tmp_path):
    assert C.load_overrides(str(tmp_path / "absent.csv")) == {}
