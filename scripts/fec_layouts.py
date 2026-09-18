"""Column layouts for the three FEC summary files.

FEC publishes a header CSV for most bulk files at
    /files/bulk-downloads/data_dictionaries/<name>_header_file.csv
but **not** for weball, webk or webl — those 404. Their layouts are documented
only in prose on the file-description pages, so they are transcribed here and
carry their source URL. This module is code, not data, precisely so the
transcription is version-controlled and reviewable.

GEN_ELECTION_PRECENT is FEC's own spelling. It is kept verbatim: the published
layout is the schema contract, and silently "correcting" it would make the
gate in 02_normalize.py compare against something FEC never published.
"""

#: https://www.fec.gov/campaign-finance-data/all-candidates-file-description/
WEBALL = [
    "CAND_ID", "CAND_NAME", "CAND_ICI", "PTY_CD", "CAND_PTY_AFFILIATION",
    "TTL_RECEIPTS", "TRANS_FROM_AUTH", "TTL_DISB", "TRANS_TO_AUTH", "COH_BOP",
    "COH_COP", "CAND_CONTRIB", "CAND_LOANS", "OTHER_LOANS", "CAND_LOAN_REPAY",
    "OTHER_LOAN_REPAY", "DEBTS_OWED_BY", "TTL_INDIV_CONTRIB", "CAND_OFFICE_ST",
    "CAND_OFFICE_DISTRICT", "SPEC_ELECTION", "PRIM_ELECTION", "RUN_ELECTION",
    "GEN_ELECTION", "GEN_ELECTION_PRECENT", "OTHER_POL_CMTE_CONTRIB",
    "POL_PTY_CONTRIB", "CVG_END_DT", "INDIV_REFUNDS", "CMTE_REFUNDS",
]

#: The reconciliation target (see CLAUDE.md). What a candidate's own
#: committees reported receiving from political committees.
WEBALL_COMMITTEE_RECEIPTS = ("OTHER_POL_CMTE_CONTRIB", "POL_PTY_CONTRIB")

LAYOUTS = {"weball": WEBALL}


#: The independent-expenditure bulk CSV is the ONE FEC file that ships its own
#: header row, so it is the one file where a true name-level symmetric
#: difference is possible. Transcribed from the 2024 file so a column added,
#: removed or renamed upstream fails the gate rather than silently shifting
#: every field. Note the names are lowercase and abbreviated — nothing like the
#: uppercase pipe-file convention.
#: https://www.fec.gov/campaign-finance-data/independent-expenditure-file-description/
INDEPENDENT_EXPENDITURE = [
    "cand_id", "cand_name", "spe_id", "spe_nam", "ele_type",
    "can_office_state", "can_office_dis", "can_office", "cand_pty_aff",
    "exp_amo", "exp_date", "agg_amo", "sup_opp", "pur", "pay", "file_num",
    "amndt_ind", "tran_id", "image_num", "receipt_dat", "fec_election_yr",
    "prev_file_num", "dissem_dt",
]

#: Fields in itcont.txt that identify a natural person. Named here so that the
#: release-blocker test in Phase 4 can scan every published artifact for them
#: by importing this list rather than re-typing it. See CLAUDE.md invariant 1:
#: no individual is ever named, and the site carrying ads makes that statutory.
INDIVIDUAL_IDENTIFIERS = ["NAME", "CITY", "STATE", "ZIP_CODE", "EMPLOYER",
                          "OCCUPATION"]

LAYOUTS["independent_expenditure"] = INDEPENDENT_EXPENDITURE
