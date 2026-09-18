"""Committee tiering and sector classification.

Testable half of 04_committees.py.

TIERING comes from `cm`, never from `ccl`. The handoff is emphatic and the
data agrees: `ccl` carries only 22 leadership-PAC (`D`) links for 2024, so
filtering there would silently merge leadership-PAC money into campaign
totals. `cm.CMTE_DSGN` is properly populated — 839 `D` and 1,298 `J` for the
same cycle — so the tier is read off the committee's own registration.

SECTOR is two fields, never one:

  `org_type` is FEC's own ORG_TP, verbatim, with zero judgment applied. It is
  defensible precisely because we did not invent it.

  `sector` is ours, and it exists because ORG_TP answers "what legal form of
  organisation is this" rather than "whose money is this" — and because it is
  simply absent for 27.5% of contribution dollars. Measured: ORG_TP covers
  72.5% of 24K/24Z dollars; the whole leadership-PAC, party, candidate-
  committee and JFC universe has no ORG_TP at all, because none of them is a
  connected organisation.

Resolution order, most specific first. Structural rules come before ORG_TP
because a leadership PAC sponsored by a corporation is leadership-PAC money
first — that is the distinction invariant 8 exists to preserve.
"""

import csv
import os

REFERENCE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reference")
SECTORS_CSV = os.path.join(REFERENCE, "sectors.csv")

UNCLASSIFIED = "Unclassified"

#: FEC committee types. https://www.fec.gov/campaign-finance-data/committee-type-code-descriptions/
CANDIDATE_TYPES = ("H", "S", "P")
PARTY_TYPES = ("X", "Y", "Z")
SUPER_PAC_TYPES = ("O", "U")          # independent-expenditure only
HYBRID_TYPES = ("V", "W")             # with a non-contribution account

#: FEC committee designations.
DSGN_AUTHORIZED = ("P", "A")
DSGN_LEADERSHIP = "D"
DSGN_JOINT_FUNDRAISING = "J"

#: ORG_TP -> sector. FEC's six values are legal forms, so the mapping is
#: mechanical and adds no judgment; `org_type` still carries the raw letter.
ORG_TP_SECTOR = {
    "C": "Corporate",
    "L": "Labor",
    "M": "Membership",
    "T": "Trade Association",
    "V": "Cooperative",
    "W": "Corporate",          # corporation without capital stock
}

#: Tier. Leadership PACs and JFCs are a SEPARATE TIER and are never merged
#: into a campaign total — both a double-count hazard (JFC transfers) and a
#: misstatement of what the money may legally do.
def tier_case_sql(alias="c"):
    return f"""
        CASE
            WHEN {alias}.CMTE_DSGN = '{DSGN_LEADERSHIP}'        THEN 'leadership_pac'
            WHEN {alias}.CMTE_DSGN = '{DSGN_JOINT_FUNDRAISING}' THEN 'joint_fundraising'
            WHEN {alias}.CMTE_TP IN {_t(SUPER_PAC_TYPES)}       THEN 'super_pac'
            WHEN {alias}.CMTE_TP IN {_t(HYBRID_TYPES)}          THEN 'hybrid_pac'
            WHEN {alias}.CMTE_TP IN {_t(PARTY_TYPES)}           THEN 'party'
            WHEN {alias}.CMTE_DSGN IN {_t(DSGN_AUTHORIZED)}
                 AND {alias}.CMTE_TP IN {_t(CANDIDATE_TYPES)}   THEN 'authorized'
            ELSE 'pac'
        END"""


def sector_case_sql(alias="c", override="o"):
    """Sector, most specific rule first.

    The curated override wins outright: it is the only place a human decision
    is recorded, and a rule that could silently outrank it would make the file
    untrustworthy.
    """
    whens = " ".join(
        f"WHEN {alias}.ORG_TP = '{k}' THEN '{v}'" for k, v in ORG_TP_SECTOR.items())
    return f"""
        CASE
            WHEN {override}.sector IS NOT NULL              THEN {override}.sector
            WHEN {alias}.CMTE_DSGN = '{DSGN_LEADERSHIP}'    THEN 'Leadership PAC'
            WHEN {alias}.CMTE_DSGN = '{DSGN_JOINT_FUNDRAISING}'
                                                            THEN 'Joint Fundraising'
            WHEN {alias}.CMTE_TP IN {_t(PARTY_TYPES)}       THEN 'Party'
            WHEN {alias}.CMTE_TP IN {_t(CANDIDATE_TYPES)}
                 AND {alias}.CMTE_DSGN IN {_t(DSGN_AUTHORIZED)}
                                                            THEN 'Candidate Committee'
            {whens}
            ELSE '{UNCLASSIFIED}'
        END"""


def _t(seq):
    return "(" + ", ".join(f"'{s}'" for s in seq) + ")"


def load_overrides(path=SECTORS_CSV):
    """reference/sectors.csv -> {CMTE_ID: sector}. Committed, reviewable.

    Lives in reference/ rather than data/ on purpose: data/ is gitignored and
    reproducible from a manifest, while this file is the one artifact in the
    pipeline that encodes human judgment and therefore has to be diffable.
    """
    if not os.path.exists(path):
        return {}
    out = {}
    with open(path, newline="") as fh:
        # Leading `#` lines carry the curation rules themselves, which belong
        # next to the data they govern. csv.DictReader would otherwise take the
        # first comment line as the header and silently yield nothing.
        rows = (line for line in fh if not line.lstrip().startswith("#"))
        for row in csv.DictReader(rows):
            cid = (row.get("cmte_id") or "").strip()
            sector = (row.get("sector") or "").strip()
            if cid and sector:
                out[cid] = sector
    return out
