# Next session: start here

Updated 2026-09-27. `CLAUDE.md` holds the invariants, and they are binding.
`ROADMAP.md` holds the long list. **This file holds exactly what is half-done
and what to do next, in order.**

## Where things stand

- **Merged to `main`:** v1.1 (the party layer, zoom tiers, the map-first
  layout, the Netlify guard, the picking fix). Also merged: stage 07 re-run
  with `MIN_NAMED_INCUMBENTS` ratcheted to 414 (PR #4), and the riso revamp
  with real drum inks, a Senate plate and a printed texture (PR #5).
- **PR #6 merged** (2026-09-27): riso sizing, legend at the map's ruling,
  hand zoom. Branch `claude/brave-feynman-ahbiv5` was restarted from `main`
  and now carries v1.2 Task 1 (see item 3).

### What PR #6 changed, and the measurement behind each change

| | was | now | where |
|---|---|---|---|
| State screen | fixed `STATE_SCALE` 2.22×. CA (all superseded) printed 13.1px dots on ~15px LA districts, one dot per district | `stateScale()`: the lower quartile of districts must hold `MIN_CELLS_ACROSS` = 6 of their own cells across, clamped to [1, 2.22]. The certainty ratio is untouched (still one multiplier over `CELL`) | `view.ts` |
| Legend chips | hard-wired to the national 2.52px cell in every view | printed at `chipCell()`: the dominant vintage's cell × the view's scale. The vintage key is printed at each vintage's own cell. A footnote names the ruling. Chips are 44×20 | `App.tsx`, `three-plate.css` |
| Motion | fixed 0.42px breath + 0.34px wander, which is 3% of a 13px cell and looks still | the shader scales drift by `cell / MOTION_REF_CELL` (2.52), so movement is ~1/6 of a cell at any ruling. Reduced motion is still exactly zero | `plate.ts` |
| Hand zoom | none; only double-click tiers | pinch, Ctrl/⌘+wheel, drag to pan, and +/−/Fit, in state and district views. `uView` sits in both vertex shaders. **The screen stays in screen space, so districts grow and dots don't.** Keyline widths are divided by k. The picker quantises to the screen pixel (`makePicker(..)(x, y, k)`). A drag swallows its click. A plain wheel scrolls the page. On touch, `pan-x pan-y` applies until zoomed, then `none` | `App.tsx`, `plate.ts`, `atlas.ts` |
| Harness | `STATE_SCALE` equality | scale held within [1, ceiling]; CA added to `STATE_CASES`; legend ruling vs plate; zoom grows `press.view[0]` and leaves `cellScale` alone; hover while zoomed names an in-state district | `check.mjs` |

On the synthetic fixture: every new check passes (CA 1.036, TX 1.420, MD and
PR at the 2.222 ceiling). The only failures are the 8 pinned-dollar facts,
which is expected on the fixture. **Nobody has seen the new sizing or zoom on
real metro districts.** The fixture's districts are grid rectangles.

If the user wanted the big CA dots after all: raise `MIN_CELLS_ACROSS`, or
make its value the ceiling. Either is a one-line change in `view.ts`. The
reading of "take the size of the circles in California" as "they are too big"
was an interpretation, and the PR says so.

---

## To do, in order (the "before showing people" list given to the user)

### 1. Look at PR #6 (merged) on real data

On the machine with the data: `cd web && npm ci && npm run build`, confirm
`web/dist/data` is real, then run `node web/check.mjs`. **All green**, or
explain every FAIL. Then look at CA, TX and NY: light and dark, 1440 and 400,
all three tiers and layers, and the dark-stock district tier (never seen on
real data). Try pinch-zoom on a real phone; the harness only clicks the
buttons. If a metro still reads as one dot per district at fit, that is what
the hand zoom is for. Do not push `MIN_CELLS_ACROSS` so high that the scale
pins at 1 everywhere.

### 2. Publish the data and verify the live site

`scripts/publish_data.sh` needs `gh auth login`. The Netlify site must be
linked to the repo (Site configuration > Build & deploy > Continuous
deployment). After that, every merge to `main` deploys. Open the live site
and confirm there's **no "SYNTHETIC FIXTURE" banner** and the numbers match
`reports/07_artifacts.md`. Run `--verify` after the deploy.

### 3. The stale-map problem: Task 1 done, Task 2 next (needs network)

**Task 1 landed 2026-09-27** (overrides can carry geometry; 2026 only, by
the user's decision). Nothing in the data changes until a `geometry_source`
is filled in, so on the data machine a `05 → 06 → 07 → 09 → 10` re-run must
produce byte-identical artifacts — diff them; that is the check that the
per-cycle split changed nothing. **Task 2** sources the nine maps and needs
network (census.gov, legislatures). Each row needs `provenance_kind =
enacting_authority` and a `district_field`, and the loader refuses otherwise.

The text below is the original item, kept for context.

173 of 441 districts (39.23%) are drawn from a map that is no longer the law,
and in California it is all of them. This is the first thing an informed
viewer will raise. The plan is `docs/superpowers/plans/2026-09-26-v1.2.md`.
**Task 1** (a geometry path for overrides) is pure code and can run in the
build container. It closes a latent lie: filling in `geometry_source` in
`reference/district_overrides.csv` today would label a state
`override_applied` while `05_districts.py` still draws cd119. **Ask the user
the plan's open question before Task 2:** overrides for 2026 only, or for
both cycles? Tasks 2–6 need network access or the data. Task 7 is the user's
decision.

### 4. Pre-publication invariant audit

The site carries ads, so this is statutory (52 U.S.C. § 30111(a)(4)):
- Grep every file in `web/dist/data` and the per-district pages for any
  `itcont` field (`NAME`, employer, occupation, city). Any hit is a release
  blocker.
- Confirm every figure on the page names its filing period.
- Confirm totals show the itemized/unitemized split.
- Confirm 2026 is presented as a mid-cycle snapshot (+5.16% against
  `weball26`, never hard-gated).

### 5. The numbers people will question

Per-candidate reconciliation has a median error of 6.17% and a p90 of 80%,
even though the aggregate is -0.72%. Top outlier: SCALISE (`H0LA01087`),
$2.03M of 24K/24Z against weball's $187K. **Unexplained.** Someone looking up
their own member will find a case like this. Either add a short "how this is
counted, and where it disagrees with the FEC" note linked from the district
sheet, or chase the Scalise gap first. Never pin dollars in the tests; see
`tests/test_reconciliation_acceptance.py`.

---

## Harness notes

- The synthetic fixture (fake money on real state outlines) is rebuilt with
  npm `us-atlas@3` + `topojson-client@3` + `polygon-clipping@0.15`. Split
  each state's bbox into a grid, `pc.intersection` each cell, and **reverse
  every ring** (polygon-clipping winds counter-clockwise, which d3 reads as
  the whole globe minus the district). Also write `search-2026-v1.json`,
  `zip-districts-v1.json` (`{by_zip5, by_zip3}`) and per-district pages with
  two `top_committees`, or later checks crash. **Never commit it.**
- **`npm run build` wipes `dist/`, fixture included.** Copy `dist/data`
  aside before building and restore it afterwards.
- Chromium: `CHROME_FOR_TESTING=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node web/check.mjs`.
  Without the env var it looks for a macOS path and crashes at launch.
- On the fixture, PR #6 gives only the 8 real-data-pinned FAILs.

## Don't

- Don't commit fixture data, `web/public/data`, or `.venv/`.
- Don't put a model name in commits, docs or code.
- Don't "tidy" `tableRep` and `tableDem` into one table, drop the neutral
  hatch, or edit one `CELL` entry. Each of those is a measured encoding; see
  `inks.ts` and `view.ts`. The state screen is now one multiplier chosen per
  state, and it stays one multiplier.
- Don't make the hand zoom scale the screen. The dots holding their size
  while the districts grow is the point (a blow-up is a new plate).
- Don't let a plain mouse wheel zoom the map. It traps the reader above the
  fold.
