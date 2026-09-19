# Stage 05 — district layer and ZIP → district crosswalk

Districts: 441
Override registry: 11 states
Elapsed: 10.5s


## Map vintage

Census `cb_2025_us_cd119` draws the districts as they stood when the 119th Congress was seated. Eleven states have since moved: nine are voting on new lines in 2026, and two enacted maps that were blocked. `map_status` is carried on every district row so a stale district is never reported as a current one.

| map_status | districts |
|---|---|
| `cd119_current` | 249 |
| `cd119_superseded` | 173 |
| `cd119_contested` | 19 |

**173 districts (39.23%) are drawn from a map that is no longer the law**, because their state redrew and we do not yet hold the new geometry. This is the number the UI has to state plainly; stage 06 will weight it by dollars.


## What Phase 3 still owes

| gap | states |
|---|---|
| geometry for an in-effect redraw | AL, CA, FL, LA, NC, OH, TN, TX, UT |
| provenance still documentary, not the enacting authority | AL, CA, FL, LA, MO, NC, OH, TN, TX, UT, VA |

Neither list fails the build. Sourcing eleven states' shapefiles from their enacting legislature or court is tracked work, not a defect, and a gate that fails on every run until it is finished is a gate nobody reads. What *would* be a defect — a state whose map moved and that we report as current — is the acceptance check below.


## ZIP → district

| measure | value |
|---|---|
| ZCTAs in `cb_2020_us_zcta520_500k` | 33,791 |
| ZCTAs resolving to ≥1 district | 33,791 (100.00%) |
| crosswalk rows | 39,244 |
| ZCTAs spanning >1 district | 5,138 (15.21%) |


## Answering for a ZIP with no ZCTA

| measure | value |
|---|---|
| distinct 5-digit ZIPs in FEC `cm.txt` (2024) | 7,811 |
| resolved exactly, via ZCTA intersection | 6,649 (85.12%) |
| resolved via the ZIP3 prefix fallback | 1,143 (14.63%) |
| still unresolved | 19 (0.24%) |

The prefix answer names every district the ZIP's three-digit neighbourhood touches. It is deliberately wider than the truth — that is what makes it honest rather than a guess dressed as a lookup — and `resolution` records which of the two answers a row came from, so the UI can render them differently and never silently equate them.


## Acceptance

| check | result | detail |
|---|---|---|
| district features | PASS | 441 (minimum 435) |
| every STATEFP maps to a USPS code | PASS | unmapped: none |
| every district carries a map_status | PASS | map_status non-null |
| no state in the registry is reported as current | PASS | a redrawn state never renders as cd119_current |
| ZCTA resolution rate | PASS | 100.00% (minimum 99.00%) |
| split-ZIP share within expected band | PASS | 15.21% (band 5.00%–40.00%) |
| FEC committee ZIPs answerable after the ZIP3 fallback | PASS | 99.76% (minimum 99.50%) |

Result: **PASS**
