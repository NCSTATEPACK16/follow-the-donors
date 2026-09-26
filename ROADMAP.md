# Roadmap

> **Mid-flight work: read `docs/NEXT_SESSION.md` first** (2026-09-26). The next
> plan is `docs/superpowers/plans/2026-09-26-v1.2.md`.

Written 2026-09-20, after v1 merged to `main` (PR #1). `CLAUDE.md` holds the
invariants and they are binding. `docs/HANDOFF.md` holds the reasoning behind
the data pipeline. **This file holds what is left**, and for the design work,
the measurement each idea has to get past.

---

## Where things stand

- **Live:** https://follow-the-donors.netlify.app — deployed from `web/dist`,
  data served from the same origin (`web/public/data`), no cloud dependency.
- **`main`** carries stages 01–10, the app, and the Worker. `pytest` 104 ·
  `vitest` 5 · `node web/check.mjs` 80 checks, all green.
- **Nothing has been spent.** No R2 bucket, no credentials, no object written.
- **Branch `claude/brave-feynman-ahbiv5` (2026-09-24)** carries the design
  audit below — not yet merged or deployed. `vitest` 20. The harness gained
  six checks (ratio, per-district wander ×2, phases, state borders, no
  per-frame keyline restroke), each seen to fail against broken code. It was
  run against a synthetic fixture only — real artifacts could not be fetched
  into that session — so **re-run `node web/check.mjs` on real data before
  deploying.**

---

## Design audit, 2026-09-24 — what changed and why

The user's note: the colour scheme and readability of each district need
refinement, riso for sure; smaller / more movement per section; broader
colour. Taken as: widen the **money ramp** (not the party layer), and
**per-district, finer** motion.

| | was | now | where |
|---|---|---|---|
| Money ramp hue sweep | 66° light / 47° dark | **127° / 138°** — khaki→indigo; umber→ice on dark | `inks.ts` D |
| Min adjacent ΔE between money steps | 7.6 / 7.0 | **9.1 / 7.8** | asserted in `inks.test.ts` |
| Min adjacent CVD ΔE | 6.7 / 7.0 | **8.5** / 7.1 | |
| Pale-end contrast | 1.64 / 1.67:1 | **1.51 / 1.54:1** — the one cost, recorded | |
| Step tables | typed copy of an out-of-repo solve | `solve.ts`; tests assert table = solve output | |
| Grain | 3.6px current | `GRAIN` 0.7 → 2.52px, ratio 2.33× kept | `view.ts` |
| Motion | one drift per plate, whole sheet | + per-district wander on its own clock, 0.34px | `plate.ts` |
| Structure | every ring 0.75px, no state borders | 0.6px districts under 1.6px states | `App.tsx` |

**Correction to the v1.1 plan's Task 3, found in review:** its shader added
`vec2(cos a, sin a) * uPhaseAmp` — a *fixed* offset per district — so every
district would still have moved in unison with the global drift. The phase
has to modulate time; `wander()` in `plate.ts` does. If you execute the rest
of the v1.1 plan, Tasks 3, 4 and 5 are **done** here; skip them.

**Fixed along the way:** the legend was drawn from a different map (no step
table, superseded cell size, the 1.57× half-diagonal dot radius the shader
had already fixed); keylines were re-stroked every animation frame; dark
stock had no warning inks of its own (3.32:1 and 2.21:1 as small text);
`mesh 0 verts` on a cold deep link (the known defect below — now fixed).

**Still open from v1.1:** the party layer (Tasks 1, 2, 7 — needs a stage 07
re-run for `incumbent_party`), double-click zoom tiers (Task 6), the
viewport-filling layout (Task 8).

**Verify anything you change with `node web/check.mjs`** (build first). It is
the file that found all three v1 picking bugs, and each of its checks has been
confirmed failable. If you add a behaviour, add the check that fails without
it — this repo has twice shipped a check that passed while testing nothing
(COMPARISON.md §14; the tooltip/sheet check in v1).

---

## v1.1 — the direction from 2026-09-20

> **Planned and ready to execute:**
> `docs/superpowers/plans/2026-09-20-v1.1-legibility.md`. Two decisions were
> taken after this section was written and the plan carries them: the party
> layer is a **red/blue fill at four money steps** (measured — six does not
> clear the gates, four does), and zoom is **three tiers**, nation → state →
> district. Read the plan, not this section, to implement.

Three notes from the user, in their order. Each has a measurement in front of
it, because two of the three run straight at something round 2 already
measured.

### 1. Motion per district, finer grain, and a party overlay

**Asked for:** the riso should move *within each district*, not as one sheet;
colours more distinct, with a fine engraved grain like the green on a dollar
bill; and a party overlay — the incumbent's party as hue, red REP / blue DEM,
darker with more PAC money.

**Reference:** a Reddit post the user linked as the visual target
(`r/ClaudeAI/comments/1wii5w6`). **Not yet seen — reddit.com is blocked from
this environment.** Ask for a screenshot or a description before building to
it; do not guess at what it looks like.

#### 1a. Per-district motion — tractable, and cheap

`uDrift` is a `vec2[3]` uniform: one drift per plate for the whole sheet, one
`drawArrays` for all 436 districts (`plate.ts`). That is why the whole map
slides together.

Give each district a per-vertex **phase** attribute and offset its drift by
it in the vertex/fragment stage. One attribute, same single draw call, no new
uniforms per district. The plates keep their global angles — one angle per
plate for the whole sheet is what makes it a press rather than 436 presses,
and that does not change.

**The trap:** `check.mjs` asserts that under `prefers-reduced-motion` exactly
**one** distinct drift vector reaches the GPU — the zero vector. Per-district
phase must collapse to zero for everyone under reduced motion, and the check
must be extended to assert the opposite while breathing (phases differ), or
this ships as a regression nobody sees.

#### 1b. Finer grain — nearly free, but the ratio is the encoding

Cell size is a fragment-shader constant, so a finer screen costs the same to
draw. But `CELL` is **not** a style value:

```
cd119_current 3.6px · cd119_contested 5.6px · cd119_superseded 8.4px
```

The **ratio** (2.33× coarse-to-current) is the certainty encoding — it is what
says "173 of 441 districts sit on a map that is no longer the law". Scale the
whole table if you want a finer grain; changing one value silently changes
what the map claims. The `STATE_SCALE` multiplier (8/3.6 ≈ 2.222) already
preserves the ratio across the blow-up — copy that pattern.

#### 1c. The party overlay — this is the one with a wall in front of it

The data is there. District artifacts already carry `rep_cents`, `dem_cents`,
`oth_cents`. For *incumbency* specifically, `cn.CAND_ICI` is loaded and
measured today: **414 of 441 districts have exactly one filed incumbent for
2026** (REP 208 · DEM 203 · DFL 2 · OTH 1), and 416 of 441 for 2024. The other
27 have none (20) or several (7) — redistricting puts incumbents in new seats
— and must render as their own case, not silently as one party.

(An earlier draft of this line said 419. That was the count of groups in the
candidate master, before joining to our own districts; joined, it is 414. The
join is on `state_usps` + `cd`, and `cd` is `'00'` for an at-large seat on
both sides — get that wrong and seven states lose their incumbent silently.)

**The wall:** round 2 built this and measured it failing. Prototype E put
party tilt in the hue and money in the lightness. REP↔DEM separation on the
printed composite, by money step:

| step | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| normal ΔE | 6.5 | 9.1 | 11.9 | 14.6 | **17.7** | **20.9** |
| CVD ΔE | 5.4 | 7.5 | 9.8 | 11.9 | **14.4** | **17.1** |

It clears the 15/8 floors **at the top two steps only — 147 of 441 districts
(33.3%)**. COMPARISON.md §12 states the cause, and it is structural rather
than a palette that needs another search: *lightness encodes money by putting
less ink on a poorer district, and less ink is less hue.* Any design where
the party colour rides on the ink that the money encoding thins out inherits
this exact table.

So the overlay has to put party in a channel that **does not thin with the
money**. Four ways, best first:

**Resolved 2026-09-20 — and none of the four options below is what was
built.** The user chose the red/blue *fill* they originally asked for, and the
wall turned out to be passable: E's inks were constrained to iso-lightness
*with a neutral plate* because E mixed party continuously. An incumbent party
is categorical and never mixes, so the chroma cap does not apply. A search
under that weaker constraint found **152 light and 76 dark ink pairs clearing
both gates at four money steps** — and none at five or six. So the answer was
not a different channel but a shorter money axis, which is the trade the user
took. The four options below are kept as the record of what was considered.
The adopted pair and both coverage tables are in the plan.

1. **Party in the keyline.** The fill stays the money ramp; the district's
   *boundary* is drawn in the incumbent's ink at full strength. A keyline is
   full-coverage ink at every money level, so red and blue separate at step 0
   exactly as well as at step 5. It is also already the heaviest mark on the
   plate — that is the argument the coverage floor was lowered on — and it
   composes with the existing map instead of replacing it.
2. **Two small multiples.** A red map and a blue map side by side, each a
   single-hue money ramp, stacked on a phone. Always readable, costs the
   screen space v1.1 is trying to reclaim (see §2).
3. **Party in the screen angle.** Riso-native and independent of ink quantity
   — but the cell closes at `COVERAGE_CEIL` 0.88, so the angle disappears in
   exactly the richest districts, and angle is a weak categorical channel at
   3.6px.
4. **Constant-coverage party plate, money moved to another channel.** Clean
   in theory; in practice the only channels left are screen frequency, which
   already carries certainty (§1b), and registration offset, which is the
   original riso thesis for precision. Do not spend both on money.

**Before building any of them, measure.** Run the REP and DEM inks against
all six fills, light and dark, through the dataviz validator the way
`web/src/lib/inks.ts` documents — the same procedure that produced and then
re-derived D's table. Option 1's measurement is *keyline vs fill*, not ink vs
ink, and it has not been taken yet.

**And keep it a layer.** Party is a second variable; money is the map. A
toggle, like the Senate layer, never a merge — that is the round-2 verdict and
nothing above overturns it.

### 2. The page wastes space and cannot be zoomed

From the dark-mode screenshot: the map floats in a large empty field, the
colophon pushes a wall of prose under the fold, and there is no way in.

- **The map should fill the viewport.** Chrome collapses, the rail scrolls
  independently of the plate.
- **Double-click to enter.** Double-click a state → the state blow-up (which
  already exists and is already re-screened); double-click a district inside
  it → that district. The `<select>` stays: a map you can only enter by
  clicking a 2px polygon is not keyboard-reachable, which is why the picker
  is the primary control (`view.ts`). Free zoom is still not needed.
- **The colophon goes behind a disclosure.** It is good writing and it is not
  the first thing.
- **Mobile:** the sheet becomes a bottom sheet over the map rather than a
  column below it.
- Test it. `check.mjs` already drives real pointer input; a `dblclick` path
  is a few lines on top of `checkPicking`.

### 3. District and state lines are indistinguishable, and it crowds

Measured in the code: `drawLines()` strokes **every district ring at one
weight** (0.75px national, 1.1px state) and **state borders are never drawn
at all** at national view. The states geometry is already loaded — `atlas.states`
— and used only by the Senate layer. So the fix is cheap:

- A **state-border pass** at a heavier weight over the district hairlines, so
  the eye gets the country's structure before it gets 436 cells.
- Then the zoom tiers from §2 re-screen finer as you go in, the way
  follow-the-ppp does — with the `CELL` ratio preserved (§1b).
- On a phone the national view may simply be too dense to be honest at 436
  districts. Consider entering at state level from a ZIP or a location, with
  the national map as the overview rather than the default working surface.

---

## Carried over — data and infrastructure

| | what | note |
|---|---|---|
| **Risk** | **A git-triggered Netlify build ships no data** | `netlify.toml` builds `web/` from git, but `web/public/data` is gitignored (it is a symlink to local `data/artifacts/`). The live site works because it was deployed from a local `web/dist`. If Netlify's git integration ever builds on push, it publishes a map with every fetch 404ing. Either deploy only by CLI from a machine with the artifacts, or set `VITE_DATA_BASE_URL` to where the artifacts really live. |
| **Decision** | **R2 + Worker, or just Netlify?** | The site is live on Netlify serving data from its own origin, and `worker/` is written but never deployed. Phase 7 may no longer be needed for v1. Decide deliberately — do not let it rot half-done. |
| Phase 7 | `scripts/11_upload_r2.py` | Blocked: no account ID, key pair or bucket. **First cloud write in the project; needs explicit approval.** `boto3` is pinned and ready. Budget measured: ~4.3 MB of artifacts against ~8.1 GB free. |
| Geometry | AL, CA, FL, LA, NC, OH, TN, TX, UT | Nine states we do not hold 2025-26 lines for; **173 of 441 districts render as superseded** because of it. Adding one is a data change: drop the shapefile in, name it in `geometry_source`. |
| Provenance | all eleven redrawn states | Still `documentary` — read off Wikipedia on 2026-09-18. Replace with the enacting bill record, canvass, or court order and flip `provenance_kind` to `enacting_authority`. Ballotpedia is bot-blocked; do not retry it. |
| Reconciliation | SCALISE (`H0LA01087`) | $2.03M of 24K/24Z against weball's $187,000. **Unexplained.** Carried as a regression case on the ratio. If you work it out, write down what it was. |
| Stage 01b | `01b_totals.py` has never run | `FEC_API_KEY` is registered and verified. Run it, then ratchet `MIN_RECEIPTS_AGREEMENT` off the measured value instead of the provisional 0.90. |
| Gate | 2026 does not hard-gate | `_db.GATE_CYCLES`. 2026 lands at +5.16% against a 1.5% tolerance written for a closed cycle. Measure its own thresholds, then ratchet. |

## Known small defects

- ~~**`mesh 0 verts` in the perf line on a cold deep link.**~~ Fixed
  2026-09-24: the readout is written by `layout()`, after the mesh exists.
- **The prototypes carry the picking bug that v1 fixed.**
  `web/prototypes/shared/atlas.js` still decodes an antialiased colour buffer
  without arbitration. Left deliberately: the prototypes are the record of
  what was judged in round 2. Do not "fix" them into disagreeing with their
  own COMPARISON.md — but do not copy from them either.
