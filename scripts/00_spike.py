"""Phase 0 feasibility spike — THROWAWAY.

Kept as history the way follow-the-ppp keeps scripts/phase0.py. Nothing here
is imported by the real pipeline; its only outputs are measurements in
reports/00_feasibility.md and a go/no-go.

It answers four questions the plan depends on:

  1. Does the pas2 (committee -> candidate) file reconcile against the FEC's
     own published candidate summary totals? If it does, the de-duplication
     is checkable rather than merely asserted, and that check becomes the
     pipeline's central acceptance gate.
  2. What does each hygiene filter actually remove, in dollars, separately?
  3. Is amendment supersession already applied in the bulk files, or must we
     do it ourselves? Everyone repeats that SUB_ID is unique; measure it.
  4. How big is the published artifact set against the R2 budget?
"""

import os
import sys

import duckdb

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEC = os.path.join(REPO, "data", "raw", "fec")
RAW = os.path.join(FEC, "2024")
HEADERS = os.path.join(FEC, "headers")
CYCLE = 2024

#: Columns that must be VARCHAR no matter what the sniffer infers. Leading
#: zeros are meaningful in every ID and ZIP here, and SUB_ID exceeds 2^53 so
#: any numeric path silently corrupts it.
FORCE_VARCHAR_SUFFIXES = ("_ID", "_CD", "ZIP", "ZIP_CODE", "DISTRICT", "_ST", "_TP")


def header_columns(name):
    """The published header file is the schema contract for its data file."""
    path = os.path.join(HEADERS, f"{name}_header_file.csv")
    with open(path) as fh:
        return fh.readline().strip().split(",")


def load(con, table, txt, header_name):
    cols = header_columns(header_name)
    # Everything lands as VARCHAR; casts are explicit and downstream. Letting
    # the sniffer choose types is how leading zeros and SUB_ID get destroyed.
    colspec = ", ".join(f"'{c}': 'VARCHAR'" for c in cols)
    con.execute(
        f"""CREATE OR REPLACE TABLE {table} AS
            SELECT * FROM read_csv('{txt}', delim='|', header=false,
                                   columns={{{colspec}}},
                                   quote='', escape='',
                                   ignore_errors=true, null_padding=true)"""
    )
    n = con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    return cols, n


def money(col):
    return f"COALESCE(TRY_CAST({col} AS DOUBLE), 0)"


def main():
    con = duckdb.connect(os.path.join(REPO, "data", "spike.duckdb"))
    con.execute("PRAGMA temp_directory='data/tmp'")
    con.execute("SET preserve_insertion_order=false")
    con.execute("SET memory_limit='8GB'")

    out = []

    def say(line=""):
        print(line)
        out.append(line)

    say(f"# Phase 0 feasibility spike — cycle {CYCLE}")
    say()

    # ---- load -------------------------------------------------------------
    say("## Load")
    say()
    say("| table | source | rows |")
    say("|---|---|---|")
    for table, txt, hdr in [
        ("cn", "cn.txt", "cn"),
        ("cm", "cm.txt", "cm"),
        ("ccl", "ccl.txt", "ccl"),
        ("weball", "weball24.txt", "weball"),
        ("pas2", "itpas2.txt", "pas2"),
    ]:
        path = os.path.join(RAW, txt)
        if not os.path.exists(path):
            say(f"| {table} | {txt} | **MISSING** |")
            continue
        _, n = load(con, table, path, hdr)
        say(f"| {table} | {txt} | {n:,} |")
    say()

    # ---- Q3: is supersession already applied? -----------------------------
    say("## Q3 — Is amendment supersession already applied in the bulk file?")
    say()
    total, distinct_sub = con.execute(
        "SELECT count(*), count(DISTINCT SUB_ID) FROM pas2"
    ).fetchone()
    say(f"- pas2 rows: **{total:,}**")
    say(f"- distinct SUB_ID: **{distinct_sub:,}**")
    say(f"- duplicate SUB_IDs: **{total - distinct_sub:,}**")
    say()
    amnd = con.execute(
        """SELECT AMNDT_IND, count(*) n, sum(%s) amt
           FROM pas2 GROUP BY 1 ORDER BY n DESC""" % money("TRANSACTION_AMT")
    ).fetchall()
    say("| AMNDT_IND | rows | dollars |")
    say("|---|---|---|")
    for ind, n, amt in amnd:
        say(f"| {ind or '(null)'} | {n:,} | ${amt:,.0f} |")
    say()

    # ---- transaction type mix --------------------------------------------
    say("## Transaction type mix (pas2)")
    say()
    tt = con.execute(
        """SELECT TRANSACTION_TP, count(*) n, sum(%s) amt
           FROM pas2 GROUP BY 1 ORDER BY amt DESC NULLS LAST""" % money("TRANSACTION_AMT")
    ).fetchall()
    say("| TRANSACTION_TP | rows | dollars |")
    say("|---|---|---|")
    for t, n, amt in tt:
        say(f"| {t or '(null)'} | {n:,} | ${amt or 0:,.0f} |")
    say()

    # ---- memo code mix ----------------------------------------------------
    say("## MEMO_CD mix (pas2)")
    say()
    mc = con.execute(
        """SELECT MEMO_CD, count(*) n, sum(%s) amt
           FROM pas2 GROUP BY 1 ORDER BY n DESC""" % money("TRANSACTION_AMT")
    ).fetchall()
    say("| MEMO_CD | rows | dollars |")
    say("|---|---|---|")
    for m, n, amt in mc:
        say(f"| {m or '(null)'} | {n:,} | ${amt or 0:,.0f} |")
    say()

    with open(os.path.join(REPO, "reports", "00_feasibility.md"), "w") as fh:
        fh.write("\n".join(out) + "\n")
    print("\nwrote reports/00_feasibility.md")


if __name__ == "__main__":
    sys.exit(main())
