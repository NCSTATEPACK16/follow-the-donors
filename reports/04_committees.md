# Stage 04 — committees, tiers and sectors

Cycles: 2024, 2026
Curated overrides: 40 in `reference/sectors.csv`


## Tiers

Read from `cm.CMTE_DSGN` and `cm.CMTE_TP`, never from `ccl`. For 2024 `ccl` carries 22 leadership-PAC links against 839 in `cm` — tiering there would silently merge leadership-PAC money into campaign totals.


### 2024

| tier | committees | of which gave 24K/24Z | 24K/24Z given |
|---|---|---|---|
| `pac` | 6,002 | 2,911 | $414,112,083 |
| `leadership_pac` | 839 | 626 | $65,283,789 |
| `authorized` | 8,715 | 636 | $17,539,105 |
| `joint_fundraising` | 1,298 | 45 | $5,851,088 |
| `hybrid_pac` | 897 | 215 | $4,096,963 |
| `party` | 613 | 127 | $2,736,825 |
| `super_pac` | 2,574 | 6 | $89,685 |


### 2026

| tier | committees | of which gave 24K/24Z | 24K/24Z given |
|---|---|---|---|
| `pac` | 5,957 | 2,743 | $325,635,783 |
| `leadership_pac` | 922 | 587 | $53,823,108 |
| `authorized` | 8,154 | 455 | $14,121,355 |
| `hybrid_pac` | 1,099 | 229 | $11,846,882 |
| `party` | 608 | 61 | $2,732,880 |
| `joint_fundraising` | 1,299 | 17 | $1,559,291 |
| `super_pac` | 2,655 | 4 | $10,047 |


## Sector coverage, weighted by dollars

| cycle | 24K/24Z total | classified | share | role |
|---|---|---|---|---|
| 2024 | $509,709,538 | $486,436,753 | 95.43% | **gated** |
| 2026 | $409,729,346 | $381,892,347 | 93.21% | report only |


### 2024 by sector

| sector | committees | dollars | share |
|---|---|---|---|
| Corporate | 1,344 | $175,561,357 | 34.44% |
| Trade Association | 534 | $89,758,630 | 17.61% |
| Leadership PAC | 626 | $65,283,789 | 12.81% |
| Labor | 159 | $51,860,368 | 10.17% |
| Membership | 208 | $47,881,555 | 9.39% |
| Unclassified | 809 | $23,272,785 | 4.57% |
| Candidate Committee | 636 | $17,539,105 | 3.44% |
| Ideological/Single-Issue | 25 | $14,914,352 | 2.93% |
| Cooperative | 39 | $5,854,566 | 1.15% |
| Joint Fundraising | 45 | $5,851,088 | 1.15% |
| Professional Services | 3 | $3,360,000 | 0.66% |
| Health | 5 | $2,988,450 | 0.59% |
| Party | 127 | $2,736,825 | 0.54% |
| Legal | 4 | $1,714,668 | 0.34% |
| Transportation | 1 | $760,000 | 0.15% |
| Energy | 1 | $372,000 | 0.07% |


## Curation completeness

Every committee giving at least 0.01% of contribution dollars must carry a sector. A dollar-weighted threshold bounds the work by consequence rather than by an arbitrary committee count, and it is finite: the list below is what is left.

| cycle | dollar floor | committees above it | classified | still unclassified |
|---|---|---|---|---|
| 2024 | $50,971 | 1,703 | 1,495 | 208 |


## Largest unclassified committees

| committee | name | dollars |
|---|---|---|
| `C00332296` | SUSAN B. ANTHONY LIST INC. CANDIDATE FUND (DBA SUSAN B. ANTHONY PRO-LIFE AMERICA CANDIDATE FUND) | $307,456 |
| `C00661272` | WITH HONOR PAC | $307,000 |
| `C00401083` | SQUIRE PATTON BOGGS POLITICAL ACTION COMMITTEE (SQUIRE PATTON BOGGS PAC) | $301,250 |
| `C00278895` | NELSON MULLINS RILEY & SCARBOROUGH, LLP FEDERAL POLITICAL COMMITTEE | $294,668 |
| `C00755173` | HONOR COURAGE COMMITMENT PAC | $290,900 |
| `C00383976` | FRIENDS OF COMMUNITY ONCOLOGY PAC | $288,000 |
| `C00651042` | MOMS FED UP | $276,500 |
| `C00842104` | FIGHT LIKE HELL PAC | $270,900 |
| `C00710848` | DMFI PAC | $270,000 |
| `C00410068` | FRATERNITY & SORORITY POLITICAL ACTION COMMITTEE | $261,000 |

These render as `Unclassified` in the UI. They are never guessed at, and the honest number above is published rather than hidden.


## Acceptance

| check | result | detail |
|---|---|---|
| 2024 sector dollar coverage | PASS | 95.43% (floor 95.00%) |
| every committee has a tier | PASS | no NULL tier |
| leadership PACs are tiered from cm, not ccl | PASS | 839 leadership PACs in cm; ccl holds 22 links |
| curated overrides all applied | PASS | 40 overrides in reference/sectors.csv |

Result: **PASS**
