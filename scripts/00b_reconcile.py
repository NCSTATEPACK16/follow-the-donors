"""Phase 0, part 2 — THROWAWAY. Supersession test + the reconciliation gate."""
import os, duckdb

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
con = duckdb.connect(os.path.join(REPO, "data", "spike.duckdb"))
con.execute("SET preserve_insertion_order=false")

out = []
def say(l=""):
    print(l); out.append(l)

AMT = "COALESCE(TRY_CAST(TRANSACTION_AMT AS DOUBLE), 0)"

say("## Q3b — Does the bulk file retain superseded originals?")
say()
say("The research doc asserts bulk files keep both the original (N) and the")
say("amended (A) record, and prescribes grouping by committee+report+year to")
say("supersede. Testing that directly: does the same economic transaction")
say("(same donor committee, recipient candidate, date, amount, type) appear")
say("under BOTH an N and an A indicator?")
say()
dup = con.execute(f"""
    SELECT count(*) AS colliding_groups, SUM(n_rows) AS rows_involved
    FROM (
      SELECT CMTE_ID, CAND_ID, TRANSACTION_DT, TRANSACTION_AMT, TRANSACTION_TP,
             count(*) AS n_rows,
             count(DISTINCT AMNDT_IND) AS n_inds
      FROM pas2
      WHERE CAND_ID IS NOT NULL
      GROUP BY 1,2,3,4,5
      HAVING count(DISTINCT AMNDT_IND) > 1
    )""").fetchone()
say(f"- transaction groups appearing under more than one AMNDT_IND: **{dup[0]:,}**")
say(f"- rows involved: **{dup[1] or 0:,}**")
say()

# How much would the doc's prescribed supersession delete?
say("## What the doc's prescribed amendment filter would do")
say()
naive = con.execute(f"""
    WITH amended AS (
      SELECT DISTINCT CMTE_ID, RPT_TP FROM pas2 WHERE AMNDT_IND = 'A'
    )
    SELECT count(*), sum({AMT})
    FROM pas2 p
    WHERE p.AMNDT_IND = 'N'
      AND EXISTS (SELECT 1 FROM amended a
                  WHERE a.CMTE_ID = p.CMTE_ID AND a.RPT_TP = p.RPT_TP)
""").fetchone()
say(f"Dropping N-records whose (committee, report type) has any A-record would")
say(f"delete **{naive[0]:,} rows / ${naive[1] or 0:,.0f}**.")
say()

say("## The reconciliation gate")
say()
say("Only 24K (contribution to non-affiliated committee) and 24Z (in-kind) are")
say("contributions TO a candidate. 24A/24E are independent expenditures —")
say("money spent about a candidate, never received by them. 24C is a")
say("coordinated party expenditure and 24F a communication cost; neither is a")
say("candidate receipt either.")
say()
say("Target: weball's OTHER_POL_CMTE_CONTRIB + POL_PTY_CONTRIB, which is what")
say("the candidate's own committees reported receiving from committees.")
say()

rec = con.execute(f"""
WITH contrib AS (
  SELECT CAND_ID, sum({AMT}) AS computed
  FROM pas2
  WHERE TRANSACTION_TP IN ('24K','24Z')
    AND (MEMO_CD IS NULL OR MEMO_CD <> 'X')
    AND CAND_ID IS NOT NULL
  GROUP BY 1
),
target AS (
  SELECT CAND_ID,
         COALESCE(TRY_CAST(OTHER_POL_CMTE_CONTRIB AS DOUBLE),0)
       + COALESCE(TRY_CAST(POL_PTY_CONTRIB AS DOUBLE),0) AS reported
  FROM weball
)
SELECT
  sum(c.computed)  AS total_computed,
  sum(t.reported)  AS total_reported,
  count(*)         AS matched_candidates
FROM contrib c JOIN target t USING (CAND_ID)
""").fetchone()

computed, reported, matched = rec
diff = computed - reported
say(f"- candidates matched on CAND_ID: **{matched:,}**")
say(f"- computed from pas2 (24K+24Z, memo-filtered): **${computed:,.0f}**")
say(f"- reported by candidates in weball: **${reported:,.0f}**")
say(f"- difference: **${diff:,.0f}** ({100*diff/reported:+.2f}%)")
say()

# Per-candidate agreement distribution
dist = con.execute(f"""
WITH contrib AS (
  SELECT CAND_ID, sum({AMT}) AS computed FROM pas2
  WHERE TRANSACTION_TP IN ('24K','24Z')
    AND (MEMO_CD IS NULL OR MEMO_CD <> 'X') AND CAND_ID IS NOT NULL
  GROUP BY 1),
target AS (
  SELECT CAND_ID, COALESCE(TRY_CAST(OTHER_POL_CMTE_CONTRIB AS DOUBLE),0)
                + COALESCE(TRY_CAST(POL_PTY_CONTRIB AS DOUBLE),0) AS reported
  FROM weball),
j AS (
  SELECT c.CAND_ID, c.computed, t.reported,
         CASE WHEN t.reported = 0 THEN NULL
              ELSE abs(c.computed - t.reported)/t.reported END AS rel
  FROM contrib c JOIN target t USING (CAND_ID)
  WHERE t.reported > 0)
SELECT
  count(*) AS n,
  sum(CASE WHEN rel <= 0.01 THEN 1 ELSE 0 END) AS within_1pct,
  sum(CASE WHEN rel <= 0.05 THEN 1 ELSE 0 END) AS within_5pct,
  sum(CASE WHEN rel <= 0.20 THEN 1 ELSE 0 END) AS within_20pct,
  median(rel) AS median_rel
FROM j
""").fetchone()
n, w1, w5, w20, med = dist
say(f"Per-candidate agreement (candidates with reported > 0, n={n:,}):")
say()
say("| band | candidates | share |")
say("|---|---|---|")
say(f"| within 1% | {w1:,} | {100*w1/n:.1f}% |")
say(f"| within 5% | {w5:,} | {100*w5/n:.1f}% |")
say(f"| within 20% | {w20:,} | {100*w20/n:.1f}% |")
say(f"| median relative error | | {100*med:.2f}% |")
say()

with open(os.path.join(REPO, "reports", "00_feasibility.md"), "a") as fh:
    fh.write("\n" + "\n".join(out) + "\n")
print("\nappended to reports/00_feasibility.md")
