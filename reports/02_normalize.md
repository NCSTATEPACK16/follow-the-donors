# Stage 02 — schema contract and typed load

Cycles: 2024, 2026


## Arity — declared layout vs the data

The bulk files ship with **no header row**, so the column names are joined in positionally from a separate CSV. A name-level comparison therefore cannot see a reordering; only the field count is checkable here, and sentinels below do the rest.

| file | declared columns | fields in data | layout source |
|---|---|---|---|
| `cn` 2024 | 15 | 15 | published header CSV |
| `cn` 2026 | 15 | 15 | published header CSV |
| `cm` 2024 | 15 | 15 | published header CSV |
| `cm` 2026 | 15 | 15 | published header CSV |
| `ccl` 2024 | 7 | 7 | published header CSV |
| `ccl` 2026 | 7 | 7 | published header CSV |
| `pas2` 2024 | 22 | 22 | published header CSV |
| `pas2` 2026 | 22 | 22 | published header CSV |
| `weball` 2024 | 30 | 30 | **transcribed** (FEC publishes none) |
| `weball` 2026 | 30 | 30 | **transcribed** (FEC publishes none) |


## Loaded

| table | columns | rows |
|---|---|---|
| `cn` | 15 | 18,396 |
| `cm` | 15 | 41,632 |
| `ccl` | 7 | 16,717 |
| `pas2` | 22 | 913,245 |
| `weball` | 30 | 8,150 |

Read as all-VARCHAR first — lossless, exactly as filed — then projected with explicit `TRY_CAST`. Type sniffing is never allowed to run: that is how a ZIP with a leading zero becomes an int.


## Contract declared, not loaded

| file | declared columns | fields in data | status |
|---|---|---|---|
| `oth` 2024 | 21 | 21 | not loaded — Phase 4 |
| `oth` 2026 | 21 | 21 | not loaded — Phase 4 |
| `indiv` | 21 | — | header only; no local data file |
| `oppexp` | 25 | — | header only; no local data file |
| `independent_expenditure` 2024 | 23 | 23 | **symmetric difference** — has its own header |
| `independent_expenditure` 2026 | 23 | 23 | **symmetric difference** — has its own header |

`oth` is 19-20M rows serving Super PAC funding chains, which is Phase 4 display work with no consumer yet. The IE bulk file is a **narrower universe** than OpenFEC's `schedule_e` endpoint — 73,449 rows against 156,863 for 2024 — and the two are not interchangeable. Their contracts are asserted now so adding them later is a data change, not schema archaeology.


## Sentinels — what pins the positional assumption

| column | why | share matching | result |
|---|---|---|---|
| `cn.CAND_ID` | candidate IDs are office-prefixed | 100.00% | PASS |
| `cm.CMTE_ID` | committee IDs are C plus 8 digits | 100.00% | PASS |
| `ccl.CMTE_ID` | the linkage file's committee side | 100.00% | PASS |
| `ccl.CAND_ID` | the linkage file's candidate side | 99.99% | PASS |
| `pas2.CMTE_ID` | the donating committee | 100.00% | PASS |
| `pas2.TRANSACTION_AMT` | amounts must cast to DECIMAL | 100.00% | PASS |
| `pas2.TRANSACTION_TP` | transaction types drive the 24K/24Z vs 24A/24E split in 03 | 100.00% | PASS |
| `weball.CAND_ID` | weball has no published header; this is what pins column 1 | 100.00% | PASS |
| `weball.CVG_END_DT` | weball has no published header; this is what pins the last-but-two column | 100.00% | PASS |


## Dates

| measure | value |
|---|---|
| `pas2` rows with a TRANSACTION_DT | 904,180 |
| failing to parse as MMDDYYYY | 0 (0.00%) |

`TRANSACTION_DT` is kept exactly as filed and a parsed `transaction_date` sits beside it. Unparseable rows are **counted, never dropped** — the row still carries money, and dropping it would move the reconciliation number in stage 03.


## Type invariants, probed

| probe | value | what it proves |
|---|---|---|
| `cm.CMTE_ZIP` values starting '0' | 2,675 | leading zeros survived; the column is not an int |
| max `length(pas2.SUB_ID)` | 19 | SUB_ID is wider than a float can address exactly |
| `SUB_ID` values above 2^53 | 913,245 | an int64→double round-trip would corrupt these |


## Acceptance

| check | result | detail |
|---|---|---|
| independent_expenditure 2024 symmetric difference | PASS | identical |
| independent_expenditure 2026 symmetric difference | PASS | identical |
| arity matches declared layout for every file | PASS | 16 files checked |
| sentinels pin every positional assumption | PASS | 9 sentinels at ≥99.00% |
| TRANSACTION_DT parse failures within tolerance | PASS | 0.00% (maximum 2.00%) |
| ZIPs retain leading zeros | PASS | 2,675 committee ZIPs begin with 0 |
| SUB_ID exceeds 2^53 and survived as text | PASS | 913,245 rows; max length 19 |

Result: **PASS**
