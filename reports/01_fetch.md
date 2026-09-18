# Stage 01 — fetch FEC bulk data

Cycles: 2024, 2026
Individual contributions included: False


## Objects

| object | bytes | sha256 |
|---|---|---|
| `2024/ccl24.zip` | 94,262 | `454024270fca3d2d…` |
| `2024/cm24.zip` | 883,457 | `4729e7497643575a…` |
| `2024/cn24.zip` | 356,397 | `4080028d94f94c91…` |
| `2024/independent_expenditure_2024.csv` | 19,534,174 | `f6d1849e3a1455f7…` |
| `2024/oth24.zip` | 505,214,543 | `0f16299c773b91a9…` |
| `2024/pas224.zip` | 24,683,218 | `81520f5d1371f2e8…` |
| `2024/weball24.zip` | 174,280 | `607058b30920f721…` |
| `2026/ccl26.zip` | 88,098 | `9ac187f3f2423e26…` |
| `2026/cm26.zip` | 867,201 | `9aa2cd30e7c5fe58…` |
| `2026/cn26.zip` | 307,857 | `13eb7dd0b34ea261…` |
| `2026/independent_expenditure_2026.csv` | 4,454,002 | `b323b1c3755ab96c…` |
| `2026/oth26.zip` | 212,869,664 | `9e0f506139684e5c…` |
| `2026/pas226.zip` | 8,130,657 | `6a761947b12992f6…` |
| `2026/weball26.zip` | 193,470 | `de802b2c6d128d0d…` |
| `headers/ccl_header_file.csv` | 79 | `9de902716f8c5086…` |
| `headers/cm_header_file.csv` | 158 | `9b5bfd7764a5e078…` |
| `headers/cn_header_file.csv` | 180 | `86fe00a87b53fb44…` |
| `headers/indiv_header_file.csv` | 204 | `944a1f765c8b549f…` |
| `headers/oppexp_header_file.csv` | 247 | `7480956254f3034f…` |
| `headers/oth_header_file.csv` | 204 | `944a1f765c8b549f…` |
| `headers/pas2_header_file.csv` | 212 | `9ce58b0576635ddb…` |

Total downloaded: **0.72 GB**


## Extracted members

| archive | member | bytes |
|---|---|---|
| `2024/ccl24.zip` | `2024/ccl.txt` | 353,375 |
| `2024/cm24.zip` | `2024/cm.txt` | 2,500,798 |
| `2024/cn24.zip` | `2024/cn.txt` | 952,677 |
| `2024/pas224.zip` | `2024/itpas2.txt` | 122,711,206 |
| `2024/weball24.zip` | `2024/weball24.txt` | 485,680 |
| `2026/ccl26.zip` | `2026/ccl.txt` | 332,013 |
| `2026/cm26.zip` | `2026/cm.txt` | 2,482,945 |
| `2026/cn26.zip` | `2026/cn.txt` | 836,722 |
| `2026/pas226.zip` | `2026/itpas2.txt` | 36,621,329 |
| `2026/weball26.zip` | `2026/weball26.txt` | 542,003 |

`itcont.txt` is deliberately absent: indivYY.zip carries a byte-identical `by_date/` copy, so extracting it writes 20.6 GB on a machine with ~17 GB free. Read it with `_fetch.stream_member()`.


## Acceptance

| check | result | detail |
|---|---|---|
| manifest entries | PASS | 21 (minimum 21) |
| on-disk size agrees with manifest | PASS | 0 mismatch(es) |
| no unmanifested file in headers/ | PASS | every headers/*.csv is a recorded download |

Result: **PASS**
