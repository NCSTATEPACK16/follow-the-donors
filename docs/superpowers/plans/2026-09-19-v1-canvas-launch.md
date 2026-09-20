# v1 launch — canvas riso, no MapLibre

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans`
> or `superpowers:subagent-driven-development` to implement task-by-task. Steps
> use checkbox (`- [ ]`) syntax.

> **Supersedes Tasks 1, 4 and 5 of `2026-09-18-v1-launch.md`.** Tasks 2 and 3 of
> that plan survive in substance and are restated here with corrected
> interfaces. Read that file for the cut list (individuals, IEs, candidate
> profiles) and the reasoning behind each cut — none of it changes.

**Goal:** ship the smallest honest version of follow-the-donors — a district
choropleth of federal PAC money in the risograph visual language of prototype
**D (Three-Plate)**, tappable, searchable, static, on $0 infrastructure.

**Read `CLAUDE.md` first. Its invariants are binding and this plan does not
restate them all.**

---

## The decision this plan exists to carry out

Round 2 chose **D — Three-Plate** (commit `9807c19`): money only, three plates,
green → teal → navy, no second variable.

Round 2 also settled **discrete zoom** — national and state are two separate
renders with a transition, no free zoom. That decision removed the only reason
MapLibre was in the stack. The old plan's Task 5 said *"flat validated inks —
true halftone on vector tiles is impractical and is not attempted"*, which
directly contradicts the design that was chosen.

**Resolution (user, 2026-09-19): option 3 — drop MapLibre.** The national and
state views render through the prototype's own WebGL2 press on a canvas, which
is the artifact that was judged. Consequences, all of them good:

- **`tippecanoe` and PMTiles are cut.** No vector tiles, no tile pipeline, no
  z0–7 build. The geometry ships as simplified GeoJSON, which stage 07 already
  knows how to make (`web/prototypes/export_data.py`).
- **`maplibre-gl` and `pmtiles` are cut from the frontend.** ~250 KB of
  dependency removed.
- **`d3-geo`, `d3-array` and `earcut` become load-bearing** (64 KB vendored,
  already proven in the prototypes).
- **Ring winding becomes a release blocker.** COMPARISON.md §6: d3-geo winds
  opposite to RFC 7946, and tippecanoe/MapLibre were planar and indifferent to
  it. Nothing is indifferent to it now. `rewind_for_d3()` is mandatory and gets
  its own acceptance check.

---

## Ground truth — verified in the repo on 2026-09-19

The old plan describes some things that do not exist. Every row below was
checked today; **do not trust the old plan's file table over this one.**

| claim in the old plan | actual state |
|---|---|
| "the frontend is React + Vite … reading from R2 through the existing Worker" | **No frontend exists.** `web/` contains only `prototypes/`. No `web/src`, no `package.json`, no Vite config. |
| `web/src/map/style.ts`, `web/src/lib/config.ts`, `web/src/styles/riso.css` listed as *modify* | None of the three exists. All are new files. |
| "the existing Worker" | **`worker/` is an empty directory.** No Worker, no `wrangler.toml`. |
| Task 4's ink table | Superseded. The validated D values live in `web/prototypes/shared/inks.js`; round 1 already measured the old plan's set as failing (`#7E5BB0↔#2F4B9B` ΔE 13.4 against a 15 floor). |
| 2026 reconciles at +5.08% | **Measured +5.16%** today (`computed 409,501,443.00` vs `reported 389,396,962.96`, n=1492). See "Recorded drift" below. |

**What does exist and is ready:**

- `scripts/` 00–06 plus helpers `_db _report _aggregate _committees _districts _hygiene _fetch _totals`.
- `data/fec.duckdb` (514 MB) with every table this plan reads.
- `tests/` 7 files; `pytest.ini` sets `pythonpath = scripts`, `testpaths = tests`.
- CI (`.github/workflows/ci.yml`): Python 3.14, `pip install -r requirements.txt`,
  `pytest -v`. Data-dependent tests `skipif`-guard on the gitignored `data/` tree.
- `requirements.txt` pins `duckdb==1.5.5`, `boto3==1.43.72`, `pytest==9.1.1`.
  **`boto3` is already there for Phase 7.**
- The whole of `web/prototypes/` — 2,345 lines of working, verified renderer.

### Verified table interfaces

Column names are exact. `pac_dollars` and `amount` are **`DECIMAL(38,2)` in
dollars, not cents** — the prototypes convert to cents at the artifact
boundary and production must do the same, because JSON floats are not money.

Row counts are **2026**; 2024 differs (e.g. `reconciliation_2024` has 1,597 rows).

**`_db.CYCLES` is `(2024, 2026)` — integers — and every `cycle` column in the
database is VARCHAR.** The existing stages call `str(cycle)` at the boundary
(see `_db.raw_path`, `06_aggregate.py`). A `WHERE cycle = 2026` against a
VARCHAR column is a silent-cast trap; write `WHERE cycle = '2026'`. Table names
interpolate either type safely, which is why the mistake survives until a
`WHERE`.

| table | rows (2026) | columns this plan uses |
|---|---|---|
| `districts_raw` | 441 | `statefp, cd, district_geoid, district_name, congress, geom` |
| `district_totals_{cycle}` | 441 | `district_geoid, state_usps, cd, district_name, cycle, map_status, map_vintage, legal_status, notes, pac_dollars, contributions, candidates, donor_committees` |
| `district_sector_{cycle}` | 5,622 | `district_geoid, cycle, tier, sector, pac_dollars, contributions` |
| `district_vintage` | 441 | `district_geoid, state_usps, map_status, map_vintage, enacted_date, legal_status, provenance_url, provenance_kind, notes` |
| `attribution_{cycle}` | 31,593 rows in `bucket='statewide', office='S'` alone | `sub_id, amount, cand_id, donor_cmte_id, office, office_st, office_cd, cand_name, cand_party, bucket, district_geoid` |
| `candidate_totals_{cycle}` | 1,529 | `cand_id, cand_name, cand_party, office, cycle, bucket, district_geoid, pac_dollars, contributions, donor_committees` |
| `committees` | — | `cycle, cmte_id, cmte_name, cmte_tp, cmte_dsgn, party, connected_org, org_type, tier, sector, sector_curated` |
| `cn` | — | `cycle, CAND_ID, CAND_ELECTION_YR, CAND_OFFICE_ST` — **column names are UPPERCASE in this table**, unlike every other |
| `zip_districts` | 39,244 | `zip5, district_geoid, overlap_share, is_primary, state_usps, map_status, resolution, derivation` |
| `zip3_districts` | 2,354 | `zip3, district_geoid, state_usps, map_status, supporting_zips, resolution` |
| `reconciliation_{cycle}` | 1,492 | `cand_id, cand_name, computed, reported, gap, rel` |

### Verified figures

| | 2024 | 2026 |
|---|---|---|
| districts | 441 | 441 |
| PAC money in a district | $420,315,216 | $328,788,436 |
| Senate PAC money | $89,745,312 | $80,871,118 |
| superseded | 173 districts, $148,861,248 (**35.42%**) | 173 districts, $122,738,240 (**37.33%**) |
| reconciliation | **−0.72%**, 44.47% within 5% | **+5.16%**, 39.62% within 5% |
| gated (`_db.GATE_CYCLES`) | **yes** | no |

`attribution_{cycle}` where `bucket='district'` sums to `district_totals_{cycle}`
**exactly** ($328,788,436.00 both sides, 2026), and `attribution` and
`candidate_totals` agree on Senate to the dollar ($80,871,118.00). Both are
free acceptance checks and both are specified below.

### Recorded drift — do not normalise away

`CLAUDE.md` and `2026-09-19-riso-round-2.md` both state 2026 reconciles at
**+5.08%**. Measured today it is **+5.16%**, and `web/prototypes/data/meta-2026.json`
also carries 5.16%. The difference is small and 2026 is the ungated cycle, so
nothing failed — but the figure in the docs is stale.

**Task 0 below corrects the two documents to the measured value** rather than
leaving a number in `CLAUDE.md` that the database disagrees with. Do not
instead change the measurement.

---

## Settled decisions

| decision | choice |
|---|---|
| Prototype | **D — Three-Plate** |
| Renderer | **Canvas + WebGL2 press.** No MapLibre, no PMTiles, no tippecanoe. |
| Zoom | **Discrete.** National ↔ state are two renders with a transition. |
| Screen scale | National 3.6 px cell, state re-screened to 8 px. |
| Motion | Registration breathing + a press one-shot on entering a state; dot gain only under `prefers-reduced-motion`. |
| Senate | Replaces geometry at national; shares the page at state level. |
| Shipped cycles | **Both 2024 and 2026 artifacts are built.** |
| Default cycle on the site | **2026**, the user's standing explicit choice from round 2. |

**On the default cycle.** 2026 is the *ungated* cycle: partial filing periods,
+5.16% against FEC's own published candidate summaries, and `_db.GATE_CYCLES`
is `(2024,)` so it never fails the build. That is acceptable **only** because
the mid-cycle band is mandatory and persistent (`meta.mid_cycle` is already
written by the prototype exporter and rendered by `renderCycleBand()`). It is
never a tooltip and never a colophon line.

Because both cycles' artifacts are built, flipping the default is a one-line
change in `web/src/lib/config.ts` and **not** a rebuild. If the ungated
headline is judged wrong before launch, flip it then; nothing downstream
depends on the choice.

---

## Invariants this plan can break, and therefore checks for

Each has a named acceptance check in the task that could violate it.

1. **No individual is ever named.** v1 publishes no individual-level data at
   all. **Committee names are explicitly permitted** — `CLAUDE.md` quotes the
   FEC carve-out: *"Any person may compile and sell the names of political
   committees."* The district page's top-PAC list is therefore legal and is
   specified. `NAME` from `itcont.txt` appears nowhere in this plan.
2. **IEs are never contributions.** v1 ships no IE figure at all.
3. **All IDs and ZIPs are VARCHAR** in every artifact. `district_geoid` is
   zero-padded; JSON keys are strings.
4. **Money is integer cents** in artifacts, never a float dollar.
5. **Every published figure names its filing period.** `meta.filing_period`
   rides on every artifact and is rendered.
6. **Every district renders its map vintage**, and the four `map_status` values
   are never collapsed.
7. **Exact and prefix ZIP answers are never equated** — `resolution` is carried
   and rendered differently.
8. **Rings are wound for d3-geo** (new blocker; see above).
9. **Halftone coverage stays capped** so the certainty screen survives. The
   shader's dot radius is `sqrt(cov/π)`; commit `a241fb3` fixed a radius that
   inked 1.57× the requested coverage and closed 99.2% of the cell at the cap.
   **A change to that line is a release blocker.**
10. **$0 infrastructure.** No cloud write without explicit approval. Only
    Phase 7 writes, and it asks.

---

## File plan

| file | status | responsibility |
|---|---|---|
| `scripts/_artifacts.py` | new | artifact derivation — breaks, cents conversion, ring rewind, Senate rollup. Importable, therefore testable. |
| `scripts/07_artifacts.py` | new | stage: geometry + map artifacts per cycle |
| `scripts/09_district_pages.py` | new | one JSON per district |
| `scripts/10_sidecars.py` | new | search, ZIP crosswalk, national stats, `generation.json` |
| `scripts/11_upload_r2.py` | new | **Phase 7 only.** First cloud write. |
| `tests/test_artifacts.py` | new | unit tests over `_artifacts` |
| `tests/test_sidecars.py` | new | unit tests over the sidecar builders |
| `web/package.json`, `vite.config.ts`, `tsconfig.json` | new | the app does not exist yet |
| `web/src/lib/inks.ts` | new | port of `prototypes/shared/inks.js` |
| `web/src/lib/plate.ts` | new | port of `prototypes/shared/plate.js` |
| `web/src/lib/atlas.ts`, `view.ts` | new | ports of the matching prototype modules |
| `web/src/styles/riso.css` | new | port of `prototypes/shared/base.css` |
| `web/src/lib/config.ts` | new | versioned asset names — **must stay in lockstep with stage 10's manifest** |
| `worker/` | new | static asset Worker in front of R2 |

Numbering keeps the approved plan's slots. **08 is skipped deliberately**
(candidate profiles, cut to v1.1). 07 changes meaning from "tiles" to
"artifacts" and the report filename changes with it.

---

## Task 0: correct the recorded reconciliation figure

**Files:** `CLAUDE.md`, `docs/superpowers/plans/2026-09-19-riso-round-2.md`

- [x] **Step 1:** Re-measure, do not assume:

```bash
.venv/bin/python -c "
import duckdb
con = duckdb.connect('data/fec.duckdb', read_only=True)
for c in ('2024', '2026'):
    r = con.execute(f'select sum(computed), sum(reported) from reconciliation_{c}').fetchone()
    print(c, f'{(float(r[0]) - float(r[1])) / float(r[1]):+.4%}')
"
```

- [x] **Step 2:** Replace `+5.08%` with the measured value in both documents,
      in the same voice the rest of `CLAUDE.md` uses: state the number, state
      that it was re-measured on 2026-09-19, and leave the reasoning intact.
      2024's `−0.72%` and `44.47%` are confirmed correct — do not touch them.
- [x] **Step 3:** Commit on its own. A documentation correction should not ride
      inside a feature commit.

---

## Task 1: Stage 07 — publishable artifacts

**Files:** create `scripts/_artifacts.py`, `scripts/07_artifacts.py`,
`tests/test_artifacts.py`

**Consumes:** `districts_raw`, `district_totals_{cycle}`,
`district_sector_{cycle}`, `district_vintage`, `attribution_{cycle}`,
`candidate_totals_{cycle}`, `cn`

**Produces:** in `data/artifacts/` (gitignored), per cycle —
`districts-{cycle}-v1.geojson`, `states-{cycle}-v1.geojson`,
`sectors-{cycle}-v1.json`, `senate-{cycle}-v1.json`, `meta-{cycle}-v1.json`;
plus `reports/07_artifacts.md`

**`web/prototypes/export_data.py` already does all of this correctly.** This
task is a port into the repo's stage conventions, not a rewrite. Read it first.
Carry over, without re-deriving:

- the mapshaper invocation (`npx --yes mapshaper@0.6.102`) with **shared-boundary
  topology**, so contiguous borders stay contiguous through simplification;
- `rewind_for_d3()`;
- the Senate rollup from `attribution_{cycle}`, including the **de-duplication of
  `cn` to distinct `(CAND_ID, CAND_ELECTION_YR)`** before joining — without it
  the amounts fan out and double;
- the `SENATE_ST_FIX` correction (`S6MD03441`: the 2026 `cn` file records
  `CAND_OFFICE_ST='DC'` for a Maryland senator; DC has no Senate seats). The
  row is **moved and the move is recorded in the artifact**, never silently
  applied and never dropped;
- per-cycle quantile breaks in `meta.breaks_cents` — 2024 and 2026 do not share
  a distribution and a shared ramp stops encoding at the end that matters.

- [x] **Step 1: Write the failing tests** (`tests/test_artifacts.py`, over
      `_artifacts`, no database — follow `tests/test_aggregate.py` for the shape):

```python
def test_dollars_become_integer_cents():
    """JSON floats are not money. $328,788,436.00 must survive as an int."""

def test_ring_rewind_reverses_exterior_rings_only():
    """d3-geo winds opposite to RFC 7946. An un-rewound exterior ring makes
    d3.geoArea return ~12.57 sr — the whole sphere minus the district — and
    every fill becomes the clip rectangle while the outline still draws
    correctly. COMPARISON.md §6."""

def test_quantile_breaks_are_per_cycle():
    """2024's median district took $775,503 and 2026's $608,524. Running
    2026 through 2024's breaks bins it [74, 81, 128, 102, 41, 15] — the top
    two steps hold 56 districts between them and the ramp stops encoding at
    exactly the end that matters. All three figures re-verified 2026-09-19."""

def test_senate_state_fix_is_recorded_not_silent():
    """The artifact must carry a corrections list naming the candidate, the
    from-state, the to-state, the cents and the reason."""
```

- [x] **Step 2: Write `_artifacts.py`** with those four behaviours as pure
      functions taking rows and returning data. No I/O in the helper.
- [x] **Step 3: Write `07_artifacts.py`** using `_report.Report` and
      `_db.connect`, following `06_aggregate.py`'s shape exactly: build both
      cycles in `_db.CYCLES`, write markdown, `return report.write()`,
      `sys.exit(main())`.
- [x] **Step 4: Acceptance checks** (every one must be verified failable —
      break it on purpose once, see it exit nonzero, put it back):

  1. `districts-{cycle}` has exactly **441** features.
  2. Feature `pac_cents` sums to `district_totals_{cycle}.pac_dollars × 100`
     **exactly**, as integers.
  3. `attribution_{cycle}` where `bucket='district'` equals that same total —
     the artifact agrees with the row-level source, not just with the rollup.
  4. Senate artifact total equals `candidate_totals_{cycle}` where
     `bucket='statewide' AND office='S'` **to the cent** ($80,871,118.00 for
     2026). Two independent paths, one number.
  5. Every feature carries non-null `map_status`, `map_vintage`, `legal_status`.
  6. `map_status` counts match `district_vintage` exactly — 2026: 249 current,
     173 superseded, 19 contested.
  7. **Ring winding:** every district's `d3.geoArea` is < 0.1 sr. Run it through
     the vendored `d3-geo` via `node`, not by inspecting coordinate order —
     the point is that the consumer agrees.
  8. Senate states sum to 50 after the DC→MD correction, with `corrections`
     non-empty, and 35 seats-up + 15 banked for 2026.
  9. Every ID in every artifact is a JSON **string**.

- [x] **Step 5:** `.venv/bin/python scripts/07_artifacts.py`, read
      `reports/07_artifacts.md`, confirm every check passes.
- [x] **Step 6: Commit.**

---

## Task 2: Stage 09 — district pages

**Files:** create `scripts/09_district_pages.py`; extend `tests/test_artifacts.py`

**Produces:** `data/artifacts/districts/{geoid}-{cycle}-v1.json` (441 × 2 cycles);
`reports/09_district_pages.md`

Each page carries: the district's totals, its sector breakdown in the measured
`SECTOR_ORDER`, its **top donor committees by name**, its map vintage with
provenance, and the cycle's filing period.

**Top PACs — verified available.** `attribution_{cycle}` JOIN `committees` on
`(cmte_id, cycle)` returns **zero unmatched rows**, and gives
`cmte_name, tier, sector` per donor. Committee names are permitted; see
invariant 1.

- [x] **Step 1:** Failing test — a page's sector dollars sum to its total, and
      the top-PAC list sums to no more than the total.
- [x] **Step 2:** Build the pages. Top 10 committees per district, by dollars,
      ties broken by `cmte_id` so a rebuild is deterministic.
- [x] **Step 3: Acceptance checks:**
  1. 441 pages per cycle, one per `district_geoid`, no extras.
  2. Per page, sector dollars sum to the page total **to the cent**.
  3. Summed across pages, the total equals stage 07's artifact **to the cent**.
  4. No page contains a key or value sourced from `itcont.txt`. Assert on the
     absence of individual-level fields explicitly, so the check is real.
  5. Every page carries `map_status`, `map_vintage`, `legal_status`,
     `provenance_url`, `filing_period`.
- [x] **Step 4:** Run it, read the report, **commit.**

---

## Task 3: Stage 10 — sidecars and the generation manifest

**Files:** create `scripts/10_sidecars.py`, `tests/test_sidecars.py`

**Produces:** `data/artifacts/search-{cycle}-v1.json`,
`zip-districts-v1.json`, `stats-{cycle}-v1.json`, `generation.json`;
`reports/10_sidecars.md`

- **search** — district name, state, `cd`, geoid, and the candidate names for
  that district from `candidate_totals_{cycle}`. Candidates are people but they
  are *filed public candidates*, not contributors; the individual-name
  invariant is about `itcont.txt` contributors. Keep it to candidates who
  appear in `candidate_totals`.
- **zip crosswalk** — from `zip_districts` and `zip3_districts`. **Every row
  carries `resolution`** (`zcta_intersection` vs `zip3_prefix`) and the UI
  renders the two differently. 85.12% of committee ZIPs resolve exactly; the
  prefix fallback lifts coverage to 99.76% and is deliberately wider than the
  truth.
- **stats** — the national figures the home view prints, and nothing that a
  district page already carries.
- **`generation.json`** — the **unversioned** sidecar: cycle, build timestamp,
  filing period, per-artifact versioned filenames, reconciliation figures.
  This is the one file that may be overwritten in place (1-hour cache); every
  other artifact is immutable.

- [x] **Step 1:** Failing tests — a ZIP that resolves both ways keeps both rows
      and both `resolution` values; `generation.json` lists every artifact the
      frontend asks for.
- [x] **Step 2:** Build them.
- [x] **Step 3: Acceptance checks:**
  1. Every `district_geoid` in the search index exists in stage 07's artifact.
  2. No ZIP row is missing `resolution`.
  3. An exact and a prefix answer for the same ZIP are distinguishable in the
     artifact — assert on a ZIP known to have both.
  4. `generation.json` names every versioned artifact, and every named file
     exists on disk.
- [x] **Step 4:** Run, read the report, **commit.**

---

## Task 4: Scaffold `web/` and port the design system

**Files:** create `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`,
`web/index.html`, `web/src/styles/riso.css`, `web/src/lib/inks.ts`,
`web/src/lib/config.ts`, `web/src/lib/inks.test.ts`

**There is no app yet.** This is a scaffold, not a modification.

- [x] **Step 1:** `npm create vite@latest` → React + TypeScript, in `web/`.
      Add Vitest. **Do not install `maplibre-gl` or `pmtiles`.**
- [x] **Step 2:** Move `prototypes/vendor/{d3-geo,d3-array,earcut}.min.js`
      into the build as real dependencies (`d3-geo`, `d3-array`, `earcut` from
      npm, pinned), or keep them vendored — either is fine, but pin the version
      and record which.
- [x] **Step 3:** Copy `prototypes/fonts/` (192 KB, OFL, self-hosted, Latin
      subsets) and `prototypes/texture/` (36 KB) into `web/public/`.
      **Self-hosted, never a third-party font CDN** — nothing render-blocking
      may compete with the data fetch on cellular.
- [x] **Step 4:** Port `shared/inks.js` → `src/lib/inks.ts`, typed. Carry over
      **verbatim**, with their comments, because each comment records a
      measurement:
      - the `D` system: plates, `platesDark`, `table`, `tableDark`, `plateOrder`
      - `splitInk`, `seqWeights`, `coverageAt`, `sequentialPlates`
      - `plateTone` and `derivedRamp` — **the ramp is derived from the plates,
        never typed.** COMPARISON.md §8: round 1 shipped a legend that showed a
        different map than the one it sat beside.
      - `COVERAGE_FLOOR`, `COVERAGE_CEIL`, `SCREEN_ANGLES`, `SECTOR_ORDER`
- [x] **Step 5:** Port `shared/base.css` → `src/styles/riso.css`.
- [x] **Step 6:** `src/lib/config.ts` — the versioned asset names.
      **Must stay in lockstep with stage 10's `generation.json`.** A mismatch
      404s in production and nowhere else.
- [x] **Step 7:** Tests (`inks.test.ts`):
  1. `derivedRamp(D, false)` returns the six tones the plates print, and every
     adjacent pair differs — a regression here means the legend has drifted
     from the map again.
  2. `splitInk` conserves paper: `Π(1 - c_i) === 1 - C` for several weight
     vectors, to 1e-9. This is "total ink is the money", asserted.
  3. `coverageAt` maps each of the six `t` values to its table entry.
- [x] **Step 8:** `npm test`, **commit.**

---

## Task 5: Port D as the application

**Files:** create `web/src/lib/plate.ts`, `atlas.ts`, `view.ts`,
`web/src/App.tsx` and components; `web/src/check.mjs` (the harness, moved)

Port `d-threeplate.html` and its three shared modules. This is the prototype
the user chose; **port it, do not redesign it.**

- [x] **Step 1:** `plate.ts` — the WebGL2 press. Carry the shader **exactly**,
      including:
      - `radius = sqrt(cov / 3.14159265)` — invariant 9. The previous
        half-diagonal form inked 1.57× and closed 99.2% of the cell at the cap.
      - antialiasing by true gradient magnitude, not `fwidth()`, which is
        anisotropic on exactly the diagonals the rosettes sit on.
      - drift added **before** rotation, so the plate slides against the paper
        rather than the screen shearing inside a stationary plate.
      - the additive dark branch. **Kubelka-Munk has no dark mode** — this is a
        permanent two-model split, not a branch to unify later.
- [x] **Step 2:** `atlas.ts` — loading, Albers projection, `partitionProjectable`,
      triangulation, picking, sheet, table, legend, off-map chips.
      **AS/GU/MP/PR/VI cannot be drawn on Albers USA**: each returns the full
      clip rectangle, paints over the map and poisons `fitExtent`. Probe with a
      *plain unfitted* projection, partition them out, render as chips, keep
      them in the table. National draws **436**; the other five are chips.
- [x] **Step 3:** `view.ts` — the cycle band, the Senate layer, the state
      blow-up, the state picker, `CELL`/`STATE_SCALE`.
- [x] **Step 4:** Wire the app: national view, state blow-up, Senate toggle,
      table view, theme toggle, motion toggle, district sheet.
      **The theme toggle must rebuild the mesh**, not just repaint — light and
      dark have different step tables.
- [x] **Step 5:** Add what the prototype does not have and v1 needs:
      - **search** (district, state, candidate) over stage 10's index;
      - **ZIP entry**, rendering `resolution` — an exact answer and a prefix
        answer must look different, per invariant 7;
      - deep links to a district;
      - the district sheet reading stage 09's page JSON.
- [x] **Step 6:** Move `prototypes/check.mjs` to `web/` and re-point it at the
      built app. **Keep every check**, in particular:
      - WebGL2 forced on via `--use-gl=angle --use-angle=swiftshader
        --enable-unsafe-swiftshader`; without these the harness passes while
        testing nothing;
      - `selectOption`, never `click`, for the state picker — clicking a
        `<select>` fires no `change` and the blow-up goes untested (§14);
      - reduced motion asserted on the **GL calls**, not on pixels;
      - the re-screen asserted against the **GPU uniform**, not its own label.
- [x] **Step 7:** **Render it and look at it.** The harness checks structure and
      the validator checks colour; neither looks at the page. The 1.57× dot bug
      passed every automated check for two rounds and was found by looking.
      Check at 1440 px and ~400 px, light and dark.
- [x] **Step 8:** `npm test && node web/check.mjs`, **commit.**

### Known cosmetic item — SETTLED 2026-09-20

**The floor is 0.34, down from 0.4625 (light) / 0.4375 (dark).** Measured on
the shipped ink model, the derivation first verified by reproducing the
round-2 table to the digit from its own floor:

| floor | light end vs paper | min adjacent ΔL (gate 0.06) |
|---|---|---|
| 0.20 | 1.32:1 | 0.086 |
| **0.34** | **1.64:1** | **0.073** |
| 0.40 | 1.81:1 | 0.068 |
| 0.4625 | 2.01:1 | 0.061 ← what round 2 shipped |

The 2:1 gate is written for a chart mark on a chart surface. A district is not
a bare mark: it carries a keyline, which is the heaviest thing on the plate
and is what answers "is this a district", so the fill only has to carry ORDER
among six classes — the adjacent-ΔL gate, not the contrast one. 0.34 buys 20%
more separation between the money classes and is the floor E and F already
use. It is **not** taken to round 1's 0.20: at 1.32:1 the palest fill is a
tint no one would call ink, and the certainty screen stops being legible in
it. The departure is recorded in `inks.ts`'s own header, which now says the
light-end check is deliberately failed and at what value. The ink hues were
not touched.

**And the reason the keyline argument was checkable at all is that the
keylines were not being drawn.** The port dropped
`#lines { position: absolute; inset: 0 }` from `d-threeplate.html`, so the two
canvases stacked vertically: the map drew with no district boundaries, a ghost
outline map appeared below it, and every pointer target — hover, tooltip,
click-to-select — sat one canvas height down the page. Found by Step 6's
harness on its first run, not by any of the screenshots taken before it.

---

## Task 6: The Worker

**Files:** create `worker/wrangler.toml`, `worker/src/index.ts`

`worker/` is **empty**. There is no existing Worker.

- [x] **Step 1:** A static-asset Worker in front of the R2 bucket.
- [x] **Step 2:** Cache headers, and they are not uniform:
      - versioned artifacts → `public, immutable, max-age=31536000`
      - `generation.json` → `public, max-age=3600`
- [x] **Step 3:** No secrets in the Worker; no dynamic origin.
- [x] **Step 4:** **Commit.** Do not deploy — deploying is Phase 7.

---

## Phase 7: Stage 11 — upload to R2

**Files:** create `scripts/11_upload_r2.py`

> **This is the first cloud write in the project and it needs explicit
> approval before it runs. Do not run it as part of implementing this plan.**

### Blocker to raise before starting

**There are no R2 credentials.** `.env` contains only `FEC_API_KEY`. Phase 7
needs an account ID, an access key pair and a bucket name, and **asking for
them is the first step, not a detail to discover mid-upload.** `boto3==1.43.72`
is already pinned, so nothing else is missing.

### Budget — measured

The R2 free tier is 10 GB, shared with follow-the-ppp (1.89 GB used), leaving
~8.1 GB. Measured locally today: **4.3 MB** of artifacts for both cycles,
192 KB fonts, 36 KB texture, 64 KB vendored JS. District pages add 882 small
JSON files. The published set is well under 100 MB — **not close to binding.**
Check at the end of the rebuild anyway, because the rule says to.

- [ ] **Step 1:** Ask the user for credentials and the bucket name. Store in
      `.env`, which is gitignored.
- [ ] **Step 2:** Upload from `generation.json`'s manifest, never from a
      directory walk — the manifest is what the frontend reads and it is what
      must be true.
- [ ] **Step 3:** **A corrected file takes a NEW name.** Overwriting an
      immutable object reaches nobody who already visited. Only the small
      unversioned sidecars may be overwritten in place.
- [ ] **Step 4:** Assert `web/src/lib/config.ts` matches the manifest **before**
      uploading anything. A mismatch 404s in production and nowhere else.
- [ ] **Step 5:** `--verify` after the deploy. **A 429 is not a missing
      object** — back off and re-check rather than re-uploading.
- [ ] **Step 6:** Report free-tier usage.
- [ ] **Step 7:** **Commit.**

---

## Order and parallelism

Tasks 1 → 2 → 3 are sequential (2 and 3 read 1's output). Task 4 depends on
nothing and can start immediately. Task 5 needs 3 and 4. Task 6 is
independent. Phase 7 needs everything.

The fastest honest order: **Task 0, then 1 and 4 together, then 2 and 3, then
5, then 6, then ask about 7.**

## Definition of done for v1

- `pytest -v` green; `npm test` green; `node web/check.mjs` green.
- Stages 07, 09, 10 each write a report in which **every acceptance check
  passes**, and each check has been verified failable.
- The app renders D at 1440 px and 400 px, light and dark, national and state,
  House and Senate, **and somebody has looked at it**.
- Every published figure names its filing period; the mid-cycle band is present
  and persistent.
- Phase 7 has not run.
