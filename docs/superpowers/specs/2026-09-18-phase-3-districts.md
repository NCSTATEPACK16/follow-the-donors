# Phase 3 — district geometry

Implemented 2026-09-18. Closes the two things spike 00c deliberately left open
and gives Phase 4 a district key that carries its own vintage.

## What shipped

| file | purpose |
|---|---|
| `scripts/_districts.py` | the testable rules: registry loading and validation, `map_status`, `sourcing_gaps`, `resolve_zip`, `usps_of` |
| `scripts/05_districts.py` | the stage: district layer, ZIP crosswalk, ZIP3 index, 7 acceptance checks, `reports/05_districts.md` |
| `reference/district_overrides.csv` | the eleven states whose congressional maps moved since the 119th was seated — committed and diffable, like `reference/sectors.csv` |
| `tests/test_districts.py` | 25 unit tests |

Outputs (gitignored, `data/interim/`): `districts.parquet`,
`zip_district_crosswalk.parquet`, `zip3_district_index.parquet`.

## The two problems, and what was decided

### 1. A stale district is not a current one

The spike labelled every row `cd119_base`. That label is true of a state that
never redrew and false of one whose new map we cannot draw, and the difference
is the whole of invariant 3. `map_status` now separates four cases:

| status | meaning | districts |
|---|---|---|
| `cd119_current` | no known redraw; the map we draw is the law | 249 |
| `cd119_superseded` | a redraw is **in effect** and we lack its geometry | 173 |
| `cd119_contested` | enacted then blocked; `cd119` still governs | 19 |
| `override_applied` | we drew the new map | 0 |

**173 of 441 districts — 39.23% — are drawn from a map that is no longer the
law.** That is the number the UI has to state plainly. Stage 06 will weight it
by dollars, which is the version that will actually shock.

The rule is applied in Python, not as a SQL `CASE`, because `map_status()` is
what the tests pin and a duplicate expression in the stage is exactly the kind
of second code path that lets a stale value leak through the one nobody
updated.

### 2. `legal_status` answers which map governs — the plan had this wrong

The approved plan listed TN and LA as "in litigation" and MO as "blocked".
Checked against the record, that conflates two independent questions. Every
one of Texas, Tennessee and Louisiana is under active challenge, and all three
maps are **in effect** for 2026. Missouri's and Virginia's were enacted and
then struck down, so `cd119` is operative there.

So `legal_status` means *which map governs*, never *is anyone suing*; the
challenge history lives in `notes` and is rendered alongside. A status that
conflated the two would have drawn the wrong map for three states.

A corollary, tested: geometry we happen to hold never decides this. A blocked
map's shapefile sitting on disk must not cause us to draw a map that is not
the law.

### 3. The 15% of ZIPs with no ZCTA

Spike 00c measured that only 85.12% of distinct 5-digit ZIPs in FEC's `cm.txt`
resolve — ZCTAs do not exist for PO-box-only or point ZIPs, and committees use
PO boxes heavily — and required the rest to be answered as something other
than "no data".

The answer is a **ZIP3 prefix index**, built *from* the exact answers so it
inherits their sliver filtering and can never invent a district the
intersection rejected.

| | share of FEC committee ZIPs |
|---|---|
| resolved exactly (`zcta_intersection`) | 85.12% |
| resolved by prefix (`zip3_prefix`) | 14.63% |
| still unresolved | **0.24%** (19 ZIPs) |

The prefix answer names every district the ZIP's three-digit neighbourhood
touches. It is deliberately wider than the truth — that is what makes it an
honest coarser answer rather than a guess dressed as a lookup — and
`resolution` records which kind each row is, so the UI renders them
differently and never silently equates them. Structural heir to
follow-the-ppp's `geo_precision`.

## Provenance is tiered, and ours is not yet authoritative

`provenance_kind` is `enacting_authority` (a legislature's bill record, a
canvass, or the court order itself) or `documentary` (a secondary account).
Only the first is good enough to *draw* from; the second is good enough to
*say* a state redrew.

Every row is `documentary` today, read from the Wikipedia 2025-26
redistricting article on 2026-09-18. Ballotpedia was tried first for
per-state citations and is bot-blocked — its pages returned no readable
content, so they were not cited. Citing a URL whose content could not be read
would be the same failure the registry exists to prevent.

This gap is a column rather than a comment so that
`_districts.sourcing_gaps()` can enumerate it into the report on every run.

## Acceptance

Seven checks, all passing. Three are new to this stage and each was verified
**failable** by deliberately breaking it and confirming a non-zero exit:

| check | value | failability proof |
|---|---|---|
| district features | 441 (min 435) | inherited from the spike |
| every STATEFP maps to a USPS code | none unmapped | removed `"48": "TX"` → exit 1 |
| every district carries a `map_status` | non-null | — |
| **no state in the registry is reported as current** | 0 | forced `map_status` to `MAP_CURRENT` → exit 1 |
| ZCTA resolution rate | 100.00% (min 99%) | inherited |
| split-ZIP share in band | 15.21% (5–40%) | inherited |
| **FEC ZIPs answerable after fallback** | 99.76% (min 99.5%) | floor raised to 0.9999 → exit 1 |

`MIN_FEC_ZIP_RESOLVED` is ratcheted just under the achieved 99.76%, with small
headroom for FEC amendment churn adding ZIPs — the same discipline as
`03_hygiene`'s coverage floor.

The two sourcing gaps deliberately **do not** fail the build. Sourcing eleven
states' shapefiles is tracked work, not a defect, and a gate that fails on
every run until it is finished is a gate nobody reads. What would be a defect
— a redrawn state reported as current — is gated.

## Verification

```bash
source .venv/bin/activate
python scripts/05_districts.py
pytest
```

59 tests pass (34 from Phases 1-2, 25 new).

## Open, deliberately

- **Geometry for nine states** (AL, CA, FL, LA, NC, OH, TN, TX, UT). Until
  each arrives those districts render `cd119_superseded`. Adding one is a data
  change: drop the shapefile in, name it in `geometry_source`.
- **Provenance for all eleven** is `documentary`. Replace with the enacting
  authority's own record and flip `provenance_kind`.
- **The crosswalk stays an area approximation.** Census publishes no CD119
  block equivalency file — spike 00c proved it by deriving the vintage rather
  than assuming it. Do not quietly upgrade the claim.
