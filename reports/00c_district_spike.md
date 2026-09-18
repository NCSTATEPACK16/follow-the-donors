# Spike 00c — ZIP5 → congressional district crosswalk

Question: can this be built from public-domain Census files alone?
Elapsed: 26.5s


## Route (a) — block equivalency: REJECTED

The approved plan specified Census's 119th CD Block Equivalency File. That path 404s. The two block-assignment files Census actually publishes are `data/baf/` (dated 2011) and `data/baf2020/` (dated 2020-12-11). Their vintage is derived rather than assumed: count the districts each source gives Texas, which gained two seats between the 116th and 119th Congresses.

| source | Texas districts |
|---|---|
| `baf2020` BlockAssign_ST48_TX_CD.txt | 36 |
| `cb_2025_us_cd119_500k.shp` | 38 |

**Unequal (36 vs 38). The newest published BAF is not CD119, so route (a) does not exist.** Block-level, population-weighted assignment is unavailable for the current districts from any public-domain source. Route (b) is used.


## Route (b) — spatial intersection: USED

| measure | value |
|---|---|
| district features in `cb_2025_us_cd119_500k` | 441 |
| ZCTAs in `cb_2020_us_zcta520_500k` | 33,791 |
| ZCTAs resolving to ≥1 district | 33,791 (100.00%) |
| crosswalk rows | 39,244 |
| ZCTAs spanning >1 district | 5,138 (15.21%) |

Every row carries `derivation`, `vintage` and `legal_status`. The derivation is an **area approximation, not population-weighted** — a ZCTA split 50/50 by area may be split 90/10 by people. That is recorded, never silently equated with a block-level assignment, in the same spirit as follow-the-ppp's `geo_precision`.


## ZCTA coverage is not ZIP coverage

| measure | value |
|---|---|
| distinct 5-digit ZIPs in FEC `cm.txt` (2024) | 7,811 |
| resolving against the crosswalk | 6,649 (85.12%) |

ZCTAs are Census *approximations* of ZIP codes and do not exist for PO-box-only or point ZIPs. The shortfall here is that gap, not a defect in the join — and it is the number the UI's ZIP entry will actually live with. Phase 3 decides how to answer for an unresolvable ZIP; it must not render as 'no data'.


## Scope

Mechanism only. Ten states redrew congressional maps in 2025-26 and this spike sources **no overrides** — every row is `cd119_base`. Adding a state later is a data change, not a code change. Output is `data/interim/zip5_district_crosswalk.parquet`, gitignored: a cd119-only crosswalk has an unsolved vintage problem and must not be enshrined as committed reference data.


## Acceptance

| check | result | detail |
|---|---|---|
| district features | PASS | 441 (minimum 435) |
| ZCTA resolution rate | PASS | 100.00% (minimum 99.00%) |
| split-ZIP share within expected band | PASS | 15.21% (band 5.00%–40.00%) |
| derivation recorded on every row | PASS | derivation, vintage and legal_status non-null |

Result: **PASS**
