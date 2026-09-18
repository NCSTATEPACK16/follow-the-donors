# Stage 04 — committees, tiers and sectors

Cycles: 2024, 2026
Curated overrides: 40 in `reference/sectors.csv`


## Tiers

Read from `cm.CMTE_DSGN` and `cm.CMTE_TP`, never from `ccl`. For 2024 `ccl` carries 22 leadership-PAC links against 839 in `cm` — tiering there would silently merge leadership-PAC money into campaign totals.


### 2024

| tier | committees | of which gave 24K/24Z | 24K/24Z given |
|---|---|---|---|
| `pac` | 6,002 | 2,911 | $415,657,708 |
| `leadership_pac` | 839 | 626 | $65,953,640 |
| `authorized` | 8,715 | 636 | $17,660,714 |
| `joint_fundraising` | 1,298 | 45 | $5,851,088 |
| `hybrid_pac` | 897 | 215 | $4,185,966 |
| `party` | 613 | 127 | $2,846,395 |
| `super_pac` | 2,574 | 6 | $99,795 |


### 2026

| tier | committees | of which gave 24K/24Z | 24K/24Z given |
|---|---|---|---|
| `pac` | 5,957 | 2,743 | $327,160,699 |
| `leadership_pac` | 922 | 587 | $54,157,708 |
| `authorized` | 8,154 | 455 | $14,235,355 |
| `hybrid_pac` | 1,099 | 229 | $11,981,699 |
| `party` | 608 | 61 | $2,737,659 |
| `joint_fundraising` | 1,299 | 17 | $1,570,872 |
| `super_pac` | 2,655 | 4 | $10,047 |


## Sector coverage, weighted by dollars

| cycle | 24K/24Z total | classified | share | role |
|---|---|---|---|---|
| 2024 | $512,255,306 | $488,715,290 | 95.40% | **gated** |
| 2026 | $411,854,039 | $383,794,493 | 93.19% | report only |


### 2024 by sector

| sector | committees | dollars | share |
|---|---|---|---|
| Corporate | 1,344 | $175,619,206 | 34.28% |
| Trade Association | 534 | $89,800,380 | 17.53% |
| Leadership PAC | 626 | $65,953,640 | 12.88% |
| Labor | 159 | $52,235,868 | 10.20% |
| Membership | 208 | $48,644,540 | 9.50% |
| Unclassified | 809 | $23,540,016 | 4.60% |
| Candidate Committee | 636 | $17,660,714 | 3.45% |
| Ideological/Single-Issue | 25 | $15,038,775 | 2.94% |
| Cooperative | 39 | $5,854,566 | 1.14% |
| Joint Fundraising | 45 | $5,851,088 | 1.14% |
| Professional Services | 3 | $3,360,000 | 0.66% |
| Health | 5 | $3,003,450 | 0.59% |
| Party | 127 | $2,846,395 | 0.56% |
| Legal | 4 | $1,714,668 | 0.33% |
| Transportation | 1 | $760,000 | 0.15% |
| Energy | 1 | $372,000 | 0.07% |


## Curation completeness

Every committee giving at least 0.01% of contribution dollars must carry a sector. A dollar-weighted threshold bounds the work by consequence rather than by an arbitrary committee count, and it is finite: the list below is what is left.

| cycle | dollar floor | committees above it | classified | still unclassified |
|---|---|---|---|---|
| 2024 | $51,226 | 1,698 | 1,489 | 209 |


## Largest unclassified committees

| committee | name | dollars |
|---|---|---|
| `C00332296` | SUSAN B. ANTHONY LIST INC. CANDIDATE FUND (DBA SUSAN B. ANTHONY PRO-LIFE AMERICA CANDIDATE FUND) | $312,456 |
| `C00661272` | WITH HONOR PAC | $307,000 |
| `C00401083` | SQUIRE PATTON BOGGS POLITICAL ACTION COMMITTEE (SQUIRE PATTON BOGGS PAC) | $301,250 |
| `C00278895` | NELSON MULLINS RILEY & SCARBOROUGH, LLP FEDERAL POLITICAL COMMITTEE | $294,668 |
| `C00755173` | HONOR COURAGE COMMITMENT PAC | $290,900 |
| `C00383976` | FRIENDS OF COMMUNITY ONCOLOGY PAC | $288,000 |
| `C00842104` | FIGHT LIKE HELL PAC | $280,900 |
| `C00651042` | MOMS FED UP | $278,500 |
| `C00710848` | DMFI PAC | $278,000 |
| `C00410068` | FRATERNITY & SORORITY POLITICAL ACTION COMMITTEE | $261,000 |

These render as `Unclassified` in the UI. They are never guessed at, and the honest number above is published rather than hidden.


## Acceptance

| check | result | detail |
|---|---|---|
| 2024 sector dollar coverage | PASS | 95.40% (floor 95.00%) |
| every committee has a tier | PASS | no NULL tier |
| leadership PACs are tiered from cm, not ccl | PASS | 839 leadership PACs in cm; ccl holds 22 links |
| curated overrides all applied | PASS | 40 overrides in reference/sectors.csv |

Result: **PASS**
