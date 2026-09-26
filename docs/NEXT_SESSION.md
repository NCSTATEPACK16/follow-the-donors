# Next session: start here

Updated 2026-09-26. `CLAUDE.md` holds the invariants (binding). `ROADMAP.md`
holds the long list. **This file holds exactly what is half-done and what to
do next, in order.**

Branch: `claude/brave-feynman-ahbiv5`, pushed. It carries v1.1: the party
layer, zoom tiers, the map-first layout, the Netlify guard, and the picking
fix. PR #2 (the ramp, motion and grain audit) is merged. Check whether the
v1.1 PR is open or merged before doing anything else.

The next plan is **`docs/superpowers/plans/2026-09-26-v1.2.md`**. Its §0
records what v1.1 built, the measurements not to re-derive, and what it still
owes.

---

## To do, in order

### 1. On the machine with the data (the user, or a session that has it)

The build container can reach none of fec.gov, census.gov, state sites or
netlify.com. So:

1. `.venv/bin/python scripts/07_artifacts.py`, then read
   `reports/07_artifacts.md`. The two new checks must PASS, with about 414
   named incumbents for 2026 and 416 for 2024. **Raise
   `MIN_NAMED_INCUMBENTS`** (400, in `07_artifacts.py`) to what the run
   reports. It's a ratchet: raise it, never lower it.
2. `cd web && npm ci && npm run build`, confirm `web/dist/data` is real, then
   `node web/check.mjs`. **All green**, or explain every FAIL.
3. Look at it: light and dark, 1440 and 400, three tiers, three layers. In
   particular, the dark-stock district tier, which nobody has seen on real data.
4. Deploy: `netlify deploy --prod --dir web/dist`.

Until step 1 runs, the live party layer shows its "data predates this field"
note. That is deliberate and safe.

### 2. The v1.2 plan

Task 1 (a geometry path for overrides) is pure code and **can run in the build
container**. Do it first. It closes a latent lie: today, filling in
`geometry_source` in `reference/district_overrides.csv` would label a state
`override_applied` while `05_districts.py` still draws cd119. Ask the user
the plan's open question (overrides for 2026 only, or for both cycles)
before Task 2.

Tasks 2–6 need network access or the data. Task 7 is a decision for the user.

---

## Harness notes

- The synthetic fixture (fake money on real state outlines) is rebuilt with
  npm `us-atlas@3` + `topojson-client@3` + `polygon-clipping@0.15`. Split
  each state's bbox into a grid, `pc.intersection` each cell, and **reverse
  every ring** (polygon-clipping winds counter-clockwise, which d3 reads as
  the whole globe minus the district). Also write `search-2026-v1.json`,
  `zip-districts-v1.json` (`{by_zip5, by_zip3}`) and per-district pages with
  two `top_committees`, or later checks crash. **Never commit it.**
  `npm run build` wipes `dist/`, so regenerate it after every build.
  Chromium: `CHROME_FOR_TESTING=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- On the fixture: branch 102 ok and 8 FAIL, where the 8 are pinned to
  real-data figures. `origin/main` gives 20 FAIL with no crash, so every new
  check has been seen to fail.

## Don't

- Don't commit fixture data, `web/public/data`, or `.venv/`.
- Don't put a model name in commits, docs or code.
- Don't "tidy" `tableRep` and `tableDem` into one table, drop the neutral
  hatch, or edit one `CELL` entry. Each of those is a measured encoding;
  see `inks.ts` and `view.ts`.
