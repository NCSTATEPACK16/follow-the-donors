# Stage 03 — hygiene and the reconciliation gate

Cycles computed: 2024, 2026
Cycles gated: 2024 (others report only)


## Transaction types — why the split is not optional


### 2024

| type | rows | dollars | treatment |
|---|---|---|---|
| `24A` | 19,243 | $2,554,991,126 | independent expenditure |
| `24E` | 58,611 | $1,942,574,823 | independent expenditure |
| `24K` | 621,349 | $512,548,692 | **contribution** |
| `24C` | 1,094 | $90,575,928 | not a candidate receipt |
| `24F` | 708 | $7,101,055 | not a candidate receipt |
| `24Z` | 2,501 | $1,720,572 | **contribution** |
| `24N` | 91 | $56,932 | not a candidate receipt |

Independent expenditures are **8.7x** the contributions in 2024. Summing pas2 without splitting by transaction type would overstate money given to candidates by that factor. An independent expenditure may not legally be coordinated with the candidate and never enters their account: a category error, not a duplication.


### 2026

| type | rows | dollars | treatment |
|---|---|---|---|
| `24E` | 12,931 | $484,635,295 | independent expenditure |
| `24K` | 192,373 | $408,273,316 | **contribution** |
| `24A` | 3,223 | $276,974,579 | independent expenditure |
| `24C` | 535 | $27,178,904 | not a candidate receipt |
| `24Z` | 506 | $3,959,581 | **contribution** |
| `24F` | 63 | $1,169,594 | not a candidate receipt |
| `24N` | 17 | $0 | not a candidate receipt |

Independent expenditures are **1.8x** the contributions in 2026. Summing pas2 without splitting by transaction type would overstate money given to candidates by that factor. An independent expenditure may not legally be coordinated with the candidate and never enters their account: a category error, not a duplication.


## The amendment filter that is NOT applied

| cycle | pas2 rows | distinct SUB_ID | rows genuinely colliding | the prescribed filter would delete |
|---|---|---|---|---|
| 2024 | 703,597 | 703,597 | 600 | 16,098 / $36,836,573 |
| 2026 | 209,648 | 209,648 | 75 | 8,719 / $29,594,908 |

`SUB_ID` is unique across every row, so the bulk file **already supersedes**. The widely repeated prescription — drop `N` records where an `A` exists for the same committee and report type — deletes orders of magnitude more than actually collides. It is a data-destroying filter and it is not implemented. This measurement runs every time rather than living in a comment, so that if FEC ever changes how bulk files handle amendments, the number moves and this report says so.


## Reconciliation

Computed = 24K + 24Z from pas2, memo-filtered, with the candidate resolved through the recipient committee (`pas2.OTHER_ID` → `ccl.CMTE_ID` → `CAND_ID`) rather than through pas2's own donor-reported `CAND_ID`, which reconciles at -6.79%. Reported = `weball.OTHER_POL_CMTE_CONTRIB + POL_PTY_CONTRIB`. `TRANS_FROM_AUTH` is never added: it takes agreement to -73.8%.

| cycle | computed | reported | aggregate difference | within 5% | role |
|---|---|---|---|---|---|
| 2024 | $509,441,379 | $513,154,260 | -0.72% | 543 / 1,221 (44.47%) | **gated** |
| 2026 | $409,501,443 | $389,396,963 | +5.16% | 502 / 1,267 (39.62%) | report only |


## Named outliers

Carried as regression cases, asserted on membership and ratio rather than exact dollars so routine FEC amendments do not trip them. SCALISE remains **unexplained** and is recorded rather than normalised away — an unexplained 10x gap on a House leader is exactly what must not be quietly smoothed.

| candidate | computed | reported | gap |
|---|---|---|---|
| SCALISE, STEVE MR (`H0LA01087`) | $2,034,269 | $187,000 | $1,847,269 |
| MCCORMICK, DAVE (`S2PA00661`) | $2,233,016 | $1,066,344 | $1,166,672 |
| HALEY, NIKKI (`P40010977`) | -$1,129,532 | $32,800 | -$1,162,332 |
| MCCARTHY, KEVIN (`H6CA22125`) | $1,257,813 | $292,500 | $965,313 |
| SCOTT, TIMOTHY E. (`S4SC00240`) | -$135,072 | $730,400 | -$865,472 |
| CRUZ, RAFAEL EDWARD  TED (`S2TX00312`) | $444,911 | $1,268,020 | -$823,109 |
| HARRIS, KAMALA (`P00009423`) | $818,886 | $154,412 | $664,474 |
| SINEMA, KYRSTEN (`S8AZ00197`) | $286,385 | $818,655 | -$532,270 |
| BROWN, SAM (`S2NV00308`) | $613,707 | $1,131,536 | -$517,829 |
| RAMASWAMY, VIVEK (`P40011082`) | -$470,028 | $13,750 | -$483,778 |


## Acceptance

| check | result | detail |
|---|---|---|
| no independent expenditure in the contribution set | PASS | 0 rows of ('24A', '24E') |
| no coordinated/communication cost in the contribution set | PASS | 0 rows of ('24C', '24F') |
| 2024 aggregate tolerance | PASS | -0.72% (tolerance ±1.5%) |
| 2024 coverage floor | PASS | 44.47% (floor 44.40%) |

Result: **PASS**
