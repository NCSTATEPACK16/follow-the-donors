# Next session: start here

Written 2026-09-25, at the end of a session that ran out of room. `CLAUDE.md`
holds the invariants (binding). `ROADMAP.md` holds the long list. **This file
holds exactly what is half-done and what to do next, in order.**

Branch: `claude/brave-feynman-ahbiv5`, 4 commits ahead of `main`, pushed,
**no PR opened yet**. PR #2 (the ramp / motion / grain audit) is merged.

---

## What this branch carries (done, committed)

| # | item | state |
|---|---|---|
| 1 | Layout: map fills the first screen, controls in a scrolling rail, colophon in a closed `<details>`, bottom sheet under 720px | done, checked |
| 2 | Zoom tiers: double-click nation → state → district; back steps one tier | done, checked |
| 3 | Netlify guard: `web/scripts/require-data.mjs`, run by `netlify.toml` | done, verified both ways |
| 4 | Party layer: stage 07 `incumbent_party` + `PARTY` inks + the toggle, legend, hatch, sheet line | code done; **stage 07 not re-run** |
| – | Picking fix: click takes the district the pointer was last over (fractional vs rounded coords at a border) | done, checked |

Commits: `12cce29` stage 07 · `08b53a4` party inks · `d0b484a` Netlify
guard · `31465f8` app + harness. Their messages give the measurements.

Tests at hand-off: `pytest` 100 passed / 7 skipped (data-gated) ·
`vitest` 28 · `web/check.mjs` on a synthetic fixture: **101 ok, 8 FAIL**. All 8 are checks
pinned to real-data figures (house total, 173 superseded, 35/15 Senate seats,
the DC→MD correction). They cannot pass on fake data and are not regressions.

## Measured this session: keep these, don't re-derive them

- REP/DEM party inks reproduce the v1.1 plan exactly: worst ΔE 16.7 on both
  stocks, worst colour-blind ΔE 13.6 light / 13.1 dark.
- **The third party-layer case can't be carried by colour alone.** At the
  red/blue ramps' lightness, the best third ink over every hue reaches
  colour-blind ΔE 6.3 (floor 8), and a gray reaches 3.2 against red
  (protanopia). So "no single party incumbent" is gray **plus a hatch** drawn
  on the keyline canvas. Don't remove the hatch to "clean up" the map.
- The neutral gray has its own solved tables (`tableNeutral*`). Borrowing
  red's table left dark-stock steps at ΔL 0.059, under the 0.06 gate.
- `DISTRICT_SCALE` is 14 at base, not the plan's 18. With `GRAIN` 0.7, 18
  put superseded dots at 29px, which is polka dots.
- Two clicks within ~500ms a pixel apart are a **double-click**, which now
  descends a tier. The harness border walk spaces its clicks 650ms apart for
  this reason.

---

## To do, in order

### A. Finish the harness hardening (small; was interrupted mid-edit)

The last edit was **not written**. In `web/check.mjs`:

1. `checkLayout`: the `.sheetwrap` lookups crash when the element is absent.
   Make each `evaluate` return `"absent"` rather than throwing, and give
   `.sheet-handle`'s click `{ timeout: 3000 }` with a `.catch`.
2. `checkPartyLayer`: log a FAIL and return if there is no "Party layer"
   button, instead of letting `pg.click` time out and throw.
3. `checkZoomTiers`: spread `window.__view ?? { mode: "no __view" }` so a
   missing `__view` is a FAIL rather than a crash, and return early if the
   district tier was never reached.

Then **verify failability**: build `origin/main` in a worktree, copy the new
`check.mjs` in, and run it on the same fixture. Already seen: the three
layout checks FAIL on main (map top 452px / 562px, bottom past the fold,
colophon a `DIV`). Still to see: the zoom-tier and party-layer checks
failing there. They should, since main has neither.

**The fixture** (fake money on real state outlines, split into grid
"districts") lives only in the old session's scratchpad. Rebuild it: npm
`us-atlas@3` + `topojson-client@3` + `polygon-clipping@0.15`. Split each
state's bbox into a grid, `pc.intersection` each cell, and **reverse every
ring** (polygon-clipping winds counter-clockwise; d3 reads that as "the
globe minus the district"). Also write `search-2026-v1.json` (array of
`{geoid,state,cd,district_name,candidates:[]}`), `zip-districts-v1.json`
(`{by_zip5, by_zip3}`) and per-district pages with two `top_committees`, or
later checks crash. **Never commit it.** `npm run build` wipes `dist/`, so
regenerate the fixture into `web/dist/data` after every build. Chromium:
`CHROME_FOR_TESTING=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

### B. Open the PR (after A)

Title along the lines of "v1.1: party layer, zoom tiers, map-first layout,
Netlify guard". The body should state plainly that **stage 07 has not been
re-run**, so until it is, the party layer shows its "data predates this
field" note on the live site. That is deliberate and safe.

### C. On the machine with the data (the user, or a session that has it)

1. `.venv/bin/python scripts/07_artifacts.py`, then read
   `reports/07_artifacts.md`. The two new checks must PASS, with about 414
   named incumbents for 2026 and 416 for 2024. **Raise
   `MIN_NAMED_INCUMBENTS`** (400, in `07_artifacts.py`) to what the run
   reports. It's a ratchet: raise it, never lower it.
2. Re-run 09/10 only if 07's shape change requires it (it adds one property;
   09 and 10 don't read it).
3. `cd web && npm ci && npm run build`, confirm `web/dist/data` is real, then
   `node web/check.mjs`. **All green**, or explain every FAIL.
4. Look at it: light and dark, 1440 and 400, three tiers, three layers.
   Specifically, a low-money red district next to a low-money blue one
   (`#c97a7a` vs `#7b96d6`, measured 16.7 apart), and a hatched gray one.
5. Deploy as before: `netlify deploy --prod --dir web/dist`.

### D. Write the big implementation doc (asked for; not started)

The user asked for one implementation doc covering the six items from the
2026-09-25 "what's next" list, for a later session to execute. Write it as
`docs/superpowers/plans/2026-09-2x-v1.2.md` in the house style of
`docs/superpowers/plans/2026-09-20-v1.1-legibility.md`: global constraints,
file plan, then per task the failing check first, then code, then a commit.
Every check must be seen to fail, and every number must name its
measurement.

1–4 are **done on this branch**. For those, the doc records what was built
and what is still owed (A and C above), not a plan.

5. **Geometry for the nine redrawn states** (AL, CA, FL, LA, NC, OH, TN,
   TX, UT). Today 173 of 441 districts render as `cd119_superseded`.
   - Per state: find the enacted plan's shapefile at the legislature or
     court. Census `cd119` has none of them.
   - Record it in `reference/district_overrides.csv` with its
     `geometry_source`, and flip `map_status` to `override_applied`.
   - `legal_status` decides which map governs, never the file on disk.
     MO and VA were blocked, so `cd119` governs there even if a shapefile
     exists.
   - Acceptance: the superseded count falls by exactly that state's district
     count, and `05_districts.py`'s checks pass.
   - census.gov and state sites were blocked in the 2026-09-24/25 sessions;
     check the network policy first.
6. **Loose ends.**
   - (a) Run `01b_totals.py`. `FEC_API_KEY` is registered. Then ratchet
     `MIN_RECEIPTS_AGREEMENT` off the provisional 0.90.
   - (b) SCALISE `H0LA01087`: $2.03M of 24K/24Z against weball's $187K.
     Unexplained; write down what it was if solved.
   - (c) Provenance for the 11 redrawn states is still `documentary`
     (Wikipedia). Replace each with the bill record, canvass or court order,
     and flip `provenance_kind` to `enacting_authority`.
   - (d) Decide R2 + Worker vs Netlify-only. With the Netlify guard in place,
     Netlify-only is viable.
   - (e) 2026 does not hard-gate (`_db.GATE_CYCLES`): measure its own
     thresholds.

Also worth a line in the doc, found in passing:
- The dark-stock district tier at 9.8px cells has not been looked at on real
  data.
- The tooltip can linger over the new plate after a double-click descends.
  It's cosmetic; hide `tip` in `goTo`.

---

## Don't

- Don't commit fixture data, `web/public/data`, or `.venv/`.
- Don't put a model name in commits, docs or code.
- Don't "tidy" `tableRep` and `tableDem` into one table, drop the neutral
  hatch, or edit one `CELL` entry. Each of those is a measured encoding;
  see `inks.ts` and `view.ts`.
