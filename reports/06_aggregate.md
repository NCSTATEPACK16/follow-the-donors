# Stage 06 — PAC money by congressional district

Cycles: 2024, 2026
Gated: 2024
Elapsed: 1.5s


## 2024

Every contribution dollar lands in exactly one bucket. The five are asserted to sum back to the hygiene total, which is what makes the district figure checkable rather than asserted.

| bucket | contributions | dollars | share |
|---|---|---|---|
| `district` | 418,411 | $420,315,216 | 82.46% |
| `statewide` | 174,625 | $89,745,312 | 17.61% |
| `unassignable` | 129 | $194,744 | 0.04% |
| `unresolved` | 1 | $3,300 | 0.00% |
| `national` | 23,617 | -$549,034 | -0.11% |

|  |  |
|---|---|
| sum of buckets | $509,709,538 |
| hygiene total | $509,709,538 |
| difference | $0 |

439 of 441 districts received PAC money. **$148,861,248 of it (35.42%) sits in districts drawn from a map that is no longer the law** — the dollar-weighted version of the 39.23% of districts stage 05 measured. Those rows carry `map_status` and are not comparable across cycles.

| district | PAC dollars | map_status |
|---|---|---|
| MO-08 | $3,497,975 | `cd119_contested` |
| NY-17 | $3,088,478 | `cd119_current` |
| IA-01 | $3,022,627 | `cd119_current` |
| CA-41 | $3,017,613 | `cd119_superseded` |
| PA-01 | $3,000,352 | `cd119_current` |


## 2026

Every contribution dollar lands in exactly one bucket. The five are asserted to sum back to the hygiene total, which is what makes the district figure checkable rather than asserted.

| bucket | contributions | dollars | share |
|---|---|---|---|
| `district` | 158,706 | $328,788,436 | 80.25% |
| `statewide` | 31,593 | $80,871,118 | 19.74% |
| `unassignable` | 16 | $37,500 | 0.01% |
| `unresolved` | 2 | $20,000 | 0.00% |
| `national` | 9 | $12,292 | 0.00% |

|  |  |
|---|---|
| sum of buckets | $409,729,346 |
| hygiene total | $409,729,346 |
| difference | $0 |

440 of 441 districts received PAC money. **$122,738,240 of it (37.33%) sits in districts drawn from a map that is no longer the law** — the dollar-weighted version of the 39.23% of districts stage 05 measured. Those rows carry `map_status` and are not comparable across cycles.

| district | PAC dollars | map_status |
|---|---|---|
| KY-02 | $3,139,396 | `cd119_current` |
| CA-40 | $3,081,467 | `cd119_superseded` |
| LA-04 | $2,981,644 | `cd119_superseded` |
| IA-01 | $2,914,411 | `cd119_current` |
| MO-08 | $2,858,774 | `cd119_contested` |


## Acceptance

| check | result | detail |
|---|---|---|
| 2024 partition sums to the hygiene total | PASS | $509,709,538 vs $509,709,538 |
| 2024 unassignable share within tolerance | PASS | 0.04% (maximum 0.50%) |
| 2024 no statewide or national money reached a district | PASS | Senate and presidential dollars carry no district |
| 2024 every district row carries its map vintage | PASS | map_status and map_vintage non-null |
| 2024 no contribution is counted twice | PASS | 0 duplicated rows, $0 double-counted — one pas2 row reaching two candidates through ccl |
| 2024 district x sector reconciles to district totals | PASS | every district dollar carries a donor tier and sector |

Result: **PASS**
