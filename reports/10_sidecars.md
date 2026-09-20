# Stage 10 — sidecars and the generation manifest

Cycles: 2024, 2026
Elapsed: 0.3s


## 2024

Search index: 441 districts. Stats: 1,359 candidates, 4,302 donor committees, reconciliation -0.72%.

| artifact | size |
|---|---|
| search-2024-v1.json | 144.6 KB |
| stats-2024-v1.json | 0.5 KB |


## 2026

Search index: 441 districts. Stats: 1,291 candidates, 3,899 donor committees, reconciliation +5.16%.

| artifact | size |
|---|---|
| search-2026-v1.json | 139.4 KB |
| stats-2026-v1.json | 0.5 KB |


## ZIP crosswalk

33,791 exact ZIPs (39,244 rows), 896 ZIP3 prefixes (2,354 rows). zip-districts-v1.json: 4.87 MB.


## generation.json

15 versioned top-level artifacts named, plus a pattern covering 882 district pages.


## Acceptance

| check | result | detail |
|---|---|---|
| every district_geoid in the search index exists in stage 07's artifact | PASS | 0 orphan geoid(s) |
| no ZIP row is missing resolution | PASS | 0 row(s) missing resolution |
| an exact and a prefix answer for 08062 are distinguishable | PASS | exact=[{'district_geoid': '3402', 'resolution': 'zcta_intersection', 'overlap_share': 0.9862164660615267, 'is_primary': True}, {'district_geoid': '3401', 'resolution': 'zcta_intersection', 'overlap_share': 0.013783533938474308, 'is_primary': False}] prefix=[{'district_geoid': '3403', 'resolution': 'zip3_prefix', 'supporting_zips': 24}, {'district_geoid': '3401', 'resolution': 'zip3_prefix', 'supporting_zips': 45}, {'district_geoid': '3402', 'resolution': 'zip3_prefix', 'supporting_zips': 28}] |
| generation.json names every versioned artifact, and every named file exists on disk | PASS | 0 missing top-level artifact(s), 0 district-page count mismatch(es) |

Result: **PASS**
