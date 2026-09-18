"""Stage 02 — load the bulk files under an explicit schema contract.

Mirrors follow-the-ppp's 02_normalize.py, which gates against SBA's published
data dictionary and raises on any symmetric difference. FEC makes that harder
in a way worth stating plainly:

    **The bulk .txt files carry NO header row.** The column names live in a
    separate CSV that has to be joined in positionally. So a name-level
    symmetric difference is impossible for them: if FEC reorders two columns
    without changing the count, no comparison of name lists can see it.

What that leaves is a two-part gate, applied uniformly:

  1. ARITY — the data's pipe-delimited field count must equal the length of
     the declared layout. Catches a column added or removed, which is the
     common upstream change.

  2. SENTINELS — the column we *believe* is CMTE_ID must actually contain
     things shaped like `C########`; the one we believe is CAND_ID must look
     like `[HSP]#…`; amounts must cast; dates must parse. This is what turns a
     positional assumption into a tested one, and it is the only thing that
     catches a reordering.

Where the declared layout comes from differs by file, and that difference is
the reason weball is handled separately:

  * cn, cm, ccl, pas2, oth, indiv, oppexp — FEC publishes a header CSV.
  * weball, webk, webl — FEC publishes nothing; those 404 (re-verified: they
    302 to FEC's S3 bucket and return NoSuchKey). The layout is transcribed in
    fec_layouts.py. **A transcription cannot gate itself**, so weball is gated
    against the DATA via arity and sentinels only. There was once a hand-
    written weball_header_file.csv sitting in headers/ next to the real
    downloads; comparing WEBALL against that would have passed tautologically.
    01_fetch.py now fails if any unmanifested file appears there.
  * independent_expenditure_*.csv — the one file with its own header row, and
    therefore the one file that gets a real name-level symmetric difference.

TYPING. Every file is read as all-VARCHAR first, which is lossless and exactly
as filed, and the typed table is then built with explicit TRY_CASTs. Letting
DuckDB sniff types is precisely how a ZIP with a leading zero becomes an int —
so it never gets the chance. Money is DECIMAL, never DOUBLE. TRANSACTION_DT is
kept as filed AND parsed into a DATE beside it; rows whose date will not parse
are COUNTED, never dropped, because an unparseable date still carries money and
dropping it would move the reconciliation number in 03.

NOT LOADED: oth (19-20M rows, Super PAC funding chains — Phase 4 display work),
indiv, oppexp, and the IE CSV. Their contracts are asserted here so that adding
them later is a data change rather than schema archaeology.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _db import (CYCLES, FEC, connect, raw_path, read_header_columns)
from _report import Report, fmt_int, fmt_pct
from fec_layouts import INDEPENDENT_EXPENDITURE, WEBALL

#: (table, header_name, filename_template). Loaded into the database.
LOADED = [
    ("cn",    "cn",    "cn.txt"),
    ("cm",    "cm",    "cm.txt"),
    ("ccl",   "ccl",   "ccl.txt"),
    ("pas2",  "pas2",  "itpas2.txt"),
]

#: Contract asserted, table not created. `oth` is checked against real data
#: streamed from its zip; indiv and oppexp have no local data file, so only
#: their published header is checked for shape.
CONTRACT_ONLY_WITH_DATA = [("oth", "oth", "oth{yy}.zip", "itoth.txt")]
CONTRACT_ONLY_HEADER_ONLY = ["indiv", "oppexp"]

#: Columns cast out of VARCHAR. Everything not named here stays exactly as
#: filed. Money is DECIMAL because summing 703K float dollars introduces drift
#: that has no business anywhere near a reconciliation gate.
MONEY = {"TRANSACTION_AMT": "DECIMAL(14,2)"}
WEBALL_MONEY = "DECIMAL(18,2)"

#: Sentinels: (table, column, SQL predicate, why it matters). Applied to
#: non-null values; SENTINEL_MIN_SHARE of them must satisfy the predicate.
SENTINELS = [
    ("cn", "CAND_ID", "regexp_matches(CAND_ID, '^[HSP][0-9]')",
     "candidate IDs are office-prefixed"),
    ("cm", "CMTE_ID", "regexp_matches(CMTE_ID, '^C[0-9]{8}$')",
     "committee IDs are C plus 8 digits"),
    ("ccl", "CMTE_ID", "regexp_matches(CMTE_ID, '^C[0-9]{8}$')",
     "the linkage file's committee side"),
    ("ccl", "CAND_ID", "regexp_matches(CAND_ID, '^[HSP][0-9]')",
     "the linkage file's candidate side"),
    ("pas2", "CMTE_ID", "regexp_matches(CMTE_ID, '^C[0-9]{8}$')",
     "the donating committee"),
    ("pas2", "TRANSACTION_AMT", "amount IS NOT NULL",
     "amounts must cast to DECIMAL"),
    ("pas2", "TRANSACTION_TP", "regexp_matches(TRANSACTION_TP, '^2[0-9][A-Z]$')",
     "transaction types drive the 24K/24Z vs 24A/24E split in 03"),
    ("weball", "CAND_ID", "regexp_matches(CAND_ID, '^[HSP][0-9]')",
     "weball has no published header; this is what pins column 1"),
    ("weball", "CVG_END_DT", "cvg_end_date IS NOT NULL",
     "weball has no published header; this is what pins the last-but-two column"),
]
SENTINEL_MIN_SHARE = 0.99

#: An unparseable TRANSACTION_DT is counted, not dropped. Above this share,
#: something has changed about the date format and 03's period filters would
#: be silently wrong.
MAX_DATE_PARSE_FAILURE = 0.02


def varchar_types(cols):
    return "{" + ", ".join(f"'{c}': 'VARCHAR'" for c in cols) + "}"


def read_raw(con, table, path, cols):
    """Read a headerless pipe-delimited file as all-VARCHAR, exactly as filed.

    `quote=''` is load-bearing. FEC's pipe files are genuinely unquoted, and
    free-text fields (committee names, memo text) contain bare `"` — MERCK
    SHARP & DOHME's filings and any name with an inch mark will do it. With
    the default quote character DuckDB treats one of those as opening a
    quoted section and swallows delimiters until the next one, silently
    shifting every subsequent field on that row.
    """
    con.execute(f"""
        CREATE OR REPLACE TABLE {table} AS
        SELECT * FROM read_csv('{path}', delim='|', header=false,
                               names={list(cols)}, types={varchar_types(cols)},
                               ignore_errors=true, quote='', escape='')
    """)


def field_count(path, sample=200):
    """Modal pipe-delimited field count over the first `sample` lines.

    Modal, not first-line: a quoted field containing a newline would make one
    physical line short, and a single ragged row should not redefine arity.
    """
    counts = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for i, line in enumerate(fh):
            if i >= sample:
                break
            n = len(line.rstrip("\r\n").split("|"))
            counts[n] = counts.get(n, 0) + 1
    return max(counts, key=counts.get) if counts else 0


def main():
    con = connect()
    r = Report("02_normalize", "Stage 02 — schema contract and typed load")
    r.kv("Cycles", ", ".join(str(c) for c in CYCLES))

    arity_rows, load_rows = [], []

    # ---- load the four PAC-core dimension/fact files ----------------------
    for table, header_name, fname in LOADED:
        cols = read_header_columns(header_name)
        parts = []
        for cycle in CYCLES:
            path = raw_path(cycle, fname)
            if not os.path.exists(path):
                continue
            arity_rows.append((f"`{table}` {cycle}", fmt_int(len(cols)),
                               fmt_int(field_count(path)),
                               "published header CSV"))
            read_raw(con, f"_raw_{table}_{cycle}", path, cols)
            parts.append(f"SELECT '{cycle}' AS cycle, * FROM _raw_{table}_{cycle}")
        con.execute(f"CREATE OR REPLACE TABLE {table}_raw AS "
                    + " UNION ALL ".join(parts))

        # Typed projection. Everything stays VARCHAR unless named below.
        extra = ""
        if "TRANSACTION_AMT" in cols:
            # `amount`, not `transaction_amt`: DuckDB identifiers are
            # case-insensitive, so a lowercase twin of TRANSACTION_AMT is the
            # SAME column name and the table silently ends up with two.
            extra += (f", TRY_CAST(TRANSACTION_AMT AS {MONEY['TRANSACTION_AMT']})"
                      " AS amount")
        if "TRANSACTION_DT" in cols:
            # Kept as filed AND parsed. FEC writes MMDDYYYY.
            extra += (", TRY_CAST(strptime(TRANSACTION_DT, '%m%d%Y') AS DATE)"
                      " AS txn_date")
        con.execute(f"CREATE OR REPLACE TABLE {table} AS "
                    f"SELECT *{extra} FROM {table}_raw")
        n = con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        load_rows.append((f"`{table}`", fmt_int(len(cols)), fmt_int(n)))

    # ---- weball: no published header, gated against the data --------------
    parts = []
    for cycle in CYCLES:
        path = raw_path(cycle, f"weball{str(cycle)[2:]}.txt")
        if not os.path.exists(path):
            continue
        arity_rows.append((f"`weball` {cycle}", fmt_int(len(WEBALL)),
                           fmt_int(field_count(path)),
                           "**transcribed** (FEC publishes none)"))
        read_raw(con, f"_raw_weball_{cycle}", path, WEBALL)
        parts.append(f"SELECT '{cycle}' AS cycle, * FROM _raw_weball_{cycle}")
    con.execute("CREATE OR REPLACE TABLE weball_raw AS " + " UNION ALL ".join(parts))
    # Suffixed `_amt` for the same case-insensitivity reason as `amount`
    # above: TRY_CAST(TTL_RECEIPTS) AS ttl_receipts would be a duplicate name.
    money_cols = ", ".join(
        f"TRY_CAST({c} AS {WEBALL_MONEY}) AS {alias}"
        for c, alias in (("TTL_RECEIPTS", "receipts_amt"),
                         ("TTL_INDIV_CONTRIB", "indiv_contrib_amt"),
                         ("OTHER_POL_CMTE_CONTRIB", "pac_contrib_amt"),
                         ("POL_PTY_CONTRIB", "party_contrib_amt"),
                         ("TRANS_FROM_AUTH", "trans_from_auth_amt")))
    con.execute(f"""
        CREATE OR REPLACE TABLE weball AS
        SELECT *, {money_cols},
               TRY_CAST(strptime(CVG_END_DT, '%m/%d/%Y') AS DATE) AS cvg_end_date
        FROM weball_raw
    """)
    load_rows.append(("`weball`", fmt_int(len(WEBALL)),
                      fmt_int(con.execute("SELECT count(*) FROM weball").fetchone()[0])))

    # ---- contract-only ----------------------------------------------------
    contract_rows = []
    for name, header_name, zip_tmpl, member in CONTRACT_ONLY_WITH_DATA:
        cols = read_header_columns(header_name)
        import _fetch
        for cycle in CYCLES:
            zpath = raw_path(cycle, zip_tmpl.format(yy=str(cycle)[2:]))
            if not os.path.exists(zpath):
                continue
            first = next(_fetch.stream_member(zpath, member), "")
            got = len(first.rstrip("\r\n").split("|"))
            contract_rows.append((f"`{name}` {cycle}", fmt_int(len(cols)),
                                  fmt_int(got), "not loaded — Phase 4"))
    for name in CONTRACT_ONLY_HEADER_ONLY:
        cols = read_header_columns(name)
        contract_rows.append((f"`{name}`", fmt_int(len(cols)), "—",
                              "header only; no local data file"))

    # The IE CSV is the one file with its own header row, so it gets a real
    # name-level symmetric difference rather than an arity check.
    ie_diff = {}
    for cycle in CYCLES:
        path = raw_path(cycle, f"independent_expenditure_{cycle}.csv")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as fh:
            actual = [c.strip().strip('"') for c in fh.readline().strip().split(",")]
        missing = set(INDEPENDENT_EXPENDITURE) - set(actual)
        extra_c = set(actual) - set(INDEPENDENT_EXPENDITURE)
        ie_diff[cycle] = (missing, extra_c)
        contract_rows.append((f"`independent_expenditure` {cycle}",
                              fmt_int(len(INDEPENDENT_EXPENDITURE)),
                              fmt_int(len(actual)),
                              "**symmetric difference** — has its own header"))

    # ---- sentinels ---------------------------------------------------------
    sentinel_rows, sentinel_ok = [], True
    for table, col, predicate, why in SENTINELS:
        total, good = con.execute(f"""
            SELECT count(*), count(*) FILTER (WHERE {predicate})
            FROM {table} WHERE {col} IS NOT NULL AND {col} <> ''
        """).fetchone()
        share = good / total if total else 0
        ok = share >= SENTINEL_MIN_SHARE
        sentinel_ok &= ok
        sentinel_rows.append((f"`{table}.{col}`", why, fmt_pct(share),
                              "PASS" if ok else "**FAIL**"))

    # ---- date parsing ------------------------------------------------------
    dt_total, dt_bad = con.execute("""
        SELECT count(*), count(*) FILTER (WHERE txn_date IS NULL)
        FROM pas2 WHERE TRANSACTION_DT IS NOT NULL AND TRANSACTION_DT <> ''
    """).fetchone()
    dt_fail_share = dt_bad / dt_total if dt_total else 0

    # ---- invariant probes --------------------------------------------------
    # These assert the TYPE decision itself, not the data: if any of these
    # columns had been loaded as an integer the evidence would be gone.
    zip_leading_zero = con.execute("""
        SELECT count(*) FROM cm WHERE CMTE_ZIP LIKE '0%'
    """).fetchone()[0]
    subid_max_len = con.execute(
        "SELECT max(length(SUB_ID)) FROM pas2").fetchone()[0]
    subid_over_2_53 = con.execute("""
        SELECT count(*) FROM pas2
        WHERE TRY_CAST(SUB_ID AS DOUBLE) > 9007199254740992
    """).fetchone()[0]

    # ---- report ------------------------------------------------------------
    r.section("Arity — declared layout vs the data")
    r.para(
        "The bulk files ship with **no header row**, so the column names are "
        "joined in positionally from a separate CSV. A name-level comparison "
        "therefore cannot see a reordering; only the field count is checkable "
        "here, and sentinels below do the rest.")
    r.table(["file", "declared columns", "fields in data", "layout source"],
            arity_rows)

    r.section("Loaded")
    r.table(["table", "columns", "rows"], load_rows)
    r.para(
        "Read as all-VARCHAR first — lossless, exactly as filed — then "
        "projected with explicit `TRY_CAST`. Type sniffing is never allowed to "
        "run: that is how a ZIP with a leading zero becomes an int.")

    r.section("Contract declared, not loaded")
    r.table(["file", "declared columns", "fields in data", "status"],
            contract_rows)
    r.para(
        "`oth` is 19-20M rows serving Super PAC funding chains, which is Phase "
        "4 display work with no consumer yet. The IE bulk file is a "
        "**narrower universe** than OpenFEC's `schedule_e` endpoint — 73,449 "
        "rows against 156,863 for 2024 — and the two are not interchangeable. "
        "Their contracts are asserted now so adding them later is a data "
        "change, not schema archaeology.")

    r.section("Sentinels — what pins the positional assumption")
    r.table(["column", "why", "share matching", "result"], sentinel_rows)

    r.section("Dates")
    r.table(["measure", "value"], [
        ("`pas2` rows with a TRANSACTION_DT", fmt_int(dt_total)),
        ("failing to parse as MMDDYYYY", f"{fmt_int(dt_bad)} ({fmt_pct(dt_fail_share)})"),
    ])
    r.para(
        "`TRANSACTION_DT` is kept exactly as filed and a parsed "
        "`transaction_date` sits beside it. Unparseable rows are **counted, "
        "never dropped** — the row still carries money, and dropping it would "
        "move the reconciliation number in stage 03.")

    r.section("Type invariants, probed")
    r.table(["probe", "value", "what it proves"], [
        ("`cm.CMTE_ZIP` values starting '0'", fmt_int(zip_leading_zero),
         "leading zeros survived; the column is not an int"),
        ("max `length(pas2.SUB_ID)`", fmt_int(subid_max_len),
         "SUB_ID is wider than a float can address exactly"),
        ("`SUB_ID` values above 2^53", fmt_int(subid_over_2_53),
         "an int64→double round-trip would corrupt these"),
    ])

    for cycle, (missing, extra_c) in ie_diff.items():
        r.check(f"independent_expenditure {cycle} symmetric difference",
                not missing and not extra_c,
                "identical" if not (missing or extra_c)
                else f"missing={sorted(missing)} unexpected={sorted(extra_c)}")
    r.check("arity matches declared layout for every file",
            all(a[1] == a[2] for a in arity_rows + contract_rows if a[2] != "—"),
            f"{len(arity_rows) + len(contract_rows)} files checked")
    r.check("sentinels pin every positional assumption", sentinel_ok,
            f"{len(SENTINELS)} sentinels at ≥{fmt_pct(SENTINEL_MIN_SHARE)}")
    r.check("TRANSACTION_DT parse failures within tolerance",
            dt_fail_share <= MAX_DATE_PARSE_FAILURE,
            f"{fmt_pct(dt_fail_share)} (maximum {fmt_pct(MAX_DATE_PARSE_FAILURE)})")
    r.check("ZIPs retain leading zeros", zip_leading_zero > 0,
            f"{fmt_int(zip_leading_zero)} committee ZIPs begin with 0")
    r.check("SUB_ID exceeds 2^53 and survived as text", subid_over_2_53 > 0,
            f"{fmt_int(subid_over_2_53)} rows; max length {subid_max_len}")

    con.close()
    return r.write()


if __name__ == "__main__":
    sys.exit(main())
