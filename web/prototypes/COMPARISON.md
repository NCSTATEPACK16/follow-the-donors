# Six riso prototypes — what each one argues, and what building them turned up

Live at `web/prototypes/index.html` (serve the directory; `python3 -m
http.server` is enough). Two rounds: **round 1 — A, B, C** asks what riso is
*for*, and is below; **round 2 — D, E, F** asks what the colour should *mean*,
and is at the end of this file. Nothing is mocked in either.

---

# Round 1 — A, B, C · what riso is for

Written 2026-09-19. All three render the **same** data: 441 congressional
districts, $420,315,216 of PAC money placed in a district in the 2024 cycle,
real `map_status` from stage 05.

> **Read §8 of round 2 before trusting the ramp values in this half.** Every
> ramp here was validated as a *swatch*; the map is drawn by overprinting the
> *plates*, and the two are not the same colour. B's printed ramp fails the
> checks its declared ramp passes. The prototypes are left exactly as the user
> judged them; the claim about them is corrected.

---

## The disagreement they exist to settle

| | position |
|---|---|
| **v1 plan** (`docs/superpowers/plans/2026-09-18-v1-launch.md`) | Registration quality encodes certainty. An off-register fill with open halftone means "approximate". |
| **Research paper** (`~/Downloads/Risograph Map Implementation Research.md`) | Misregistration is optically unsound for this. Use **screen frequency (LPI)** instead. |
| **Neither** | That the right idiom might not be the printing process at all, but the subject. |

Each prototype takes one position all the way down.

### The paper's critique is right about one thing and wrong about its scope

The paper's strongest objection: districts share exact borders, so shifting
TX-35's fill 1.5px right puts TX-35's ink inside TX-34 and states that money
is somewhere it is not. **That is correct and it kills the plan as written.**

But it only applies to the *fill*. What is uncertain about a superseded
district is its **boundary** — the money is fine, the line is stale. So
prototype A misregisters the **keyline only**: the fill stays perfectly
clipped, and the line doubles and shifts. No ink crosses a border, no false
polygon, no moiré (there is only one screen), and the contrast of the fill is
untouched — all three of the paper's objections answered while keeping the
visual variable. The paper does not consider this case.

The paper's other two objections are weaker than stated: **moiré** requires
overlapping screens, which a single flat plate does not have; and **contrast
destruction** assumed the misregistered thing is halftoned.

---

## The three

### A — Broadside · `a-broadside.html`
Political poster riso on warm stock. Flat validated inks, three baked texture
plates, misregistration on the keyline.

- **Certainty:** keyline registration. Superseded districts get a doubled,
  offset line in `--stale`; contested get a dashed line.
- **Tone:** a flat step from a single-ink ramp.
- **Renderer:** SVG + CSS. 1,500 paths, ~250ms to first paint, zero per-frame work.
- **MapLibre port:** trivial. `fill` + `line`, plus a second `line` layer
  filtered on `map_status` with `line-translate`. No custom layer, no shader,
  no stencil risk.
- **Weakness:** it is the most conventional of the three. Turn the texture off
  and it is an ordinary blue choropleth. The riso is doing less work here than
  the thesis claims.

### B — Plate · `b-plate.html`
The research paper's recommendation, executed. A real halftone in a fragment
shader, two drums, Kubelka-Munk overprint.

- **Certainty:** screen frequency. 3.6px cell (current) / 5.6px (contested) /
  8.4px (superseded). Registration stays perfect.
- **Tone:** halftone dot area. The green plate inks up over the bottom half of
  the range, the blue plate lays on top over the upper half, so the dark end
  is an **overprint**, not a picked swatch.
- **Renderer:** WebGL2, one draw call over a mesh triangulated once on layout
  (193,752 verts), plus a Canvas2D pass for keylines. ~430ms to first paint.
- **MapLibre port:** the expensive one. `CustomLayerInterface`, `projectTile()`,
  and the stencil buffer has to be restored or district lines and labels drop
  out.
- **Weakness:** the screen competes with the money for attention, and the
  duotone ramp (green → teal → navy) is harder to read at a glance than A's
  single hue. It is the best-looking and the least legible.

### C — Specimen · `c-specimen.html`
The banknote. Intaglio line engraving, guilloche, Bodoni.

- **Certainty:** the engraving convention. Clean parallel ruling where the map
  governs, cross-hatching where it does not. Cross-hatch has meant shadow and
  doubt for four centuries.
- **Tone:** engraved line weight, one ink.
- **Renderer:** Canvas2D, one static pass. ~260ms to first paint.
- **MapLibre port:** middling. Either pattern images baked per (vintage × step)
  — 18 of them — or a custom layer like B.
- **Strength:** the only one whose visual language is about the **subject**
  rather than the process, and the only one whose certainty encoding survives
  greyscale, print and colour-vision deficiency without hue.
- **Weakness:** a site about money in politics that dresses itself as currency
  risks reading as celebration rather than scrutiny. That is a judgement call,
  not a measurement.

---

## What building them turned up

### 1. The plan's validated ink set fails for a map

The plan records the categorical set as validated. It is — **on adjacent
pairs**, which is the right pairlist for a bar chart. A choropleth and a
sector legend are not bar charts: any two inks can end up side by side, so the
pairlist is `all`. Under `--pairs all`:

```
#2F4B9B,#FF48B0,#1F7A4D,#C2410C,#7E5BB0  --pairs all
  [FAIL] Normal-vision floor   #7E5BB0↔#2F4B9B ΔE 13.4 — below the 15 floor
  [WARN] CVD separation        #7E5BB0↔#FF48B0 ΔE 7.2 (protan)
  [WARN] Contrast vs surface   #FF48B0 at 2.76:1 on warm paper
```

Re-snapped, holding the hues and moving only lightness and chroma:

```
#3F6FD8,#F03D96,#2E7A50,#B34A0C,#6E2BA8  --pairs all --surface #F6F2E9
  → ALL CHECKS PASS   (CVD worst ΔE 8.6 deutan · normal worst ΔE 16.9)
```

### 2. The plan's ramp is invisible on riso paper

The plan's ramp was validated against `#fcfcfb`. Against actual warm stock its
palest step `#E8EDF7` reads **1.05:1** — it disappears. Every ramp in
`shared/inks.js` is now validated against **its own paper**, and chroma is the
*lowest* that still passes rather than the highest that separates: a ramp
snapped for maximum separation lands on the gamut edge and reads as a
dashboard, not as ink.

### 3. Sector order in the plan is wrong

The plan lists `Corporate, Labor, Trade Association, Membership, Party`.
Measured from `district_sector_2024`, the top five by dollars are
**Corporate ($142.9M), Trade Association ($75.6M), Leadership PAC ($48.4M),
Labor ($45.7M), Membership ($39.9M)**. Party is $1.6M — 13th. Fixed.

### 4. Kubelka-Munk has no dark mode

Subtractive ink math assumes a reflective substrate: ink removes light the
paper would have returned. On a dark ground there is nothing to remove and
every overprint collapses to black, which is exactly what B's first dark
render did. Dark mode composites **additively** and says so in the shader
comment — it is no longer ink on paper, it is light through a screen. If B is
chosen, this is a permanent two-model split, not a tuning problem.

### 5. Full coverage silently disables B's certainty encoding

At coverage 1.0 the halftone dots close up and the cell disappears, so the
screen becomes a flat solid — meaning the certainty encoding stops working on
exactly the districts with the most money. The first render printed the whole
top bucket solid and 173 coarse-screen districts showed no screen at all.
Coverage is now capped at **0.88**. That cap is load-bearing, not taste.

### 6. d3-geo winds polygons the opposite way to GeoJSON

mapshaper emits RFC 7946 (counterclockwise exteriors). d3-geo is spherical and
reads a counterclockwise ring as *the complement* — the whole sphere minus the
polygon. Measured on TX-21 before the fix: `d3.geoArea` returned **12.5660**
steradians against a whole sphere of 12.5664, and the centroid came back at
(81.1°E, 30.0°S), in the Indian Ocean. After reversing every ring: 0.000404 sr,
centroid (98.9°W, 30.0°N).

The symptom is misleading — stroked outlines still draw correctly, so the map
looks nearly right while every fill is the clip rectangle. `export_data.py`
now rewinds. **This affects d3-geo only**; tippecanoe and MapLibre work in
planar tile coordinates and are indifferent, so stage 07 will not need it.

### 7. Five delegations cannot be drawn, and silently vanish if you let them

`geoAlbersUsa` covers the 50 states and DC and nothing else. AS, GU, MP, PR and
VI do not merely fail to project — each clips against the composite's clip
rectangle and comes back as **the full rectangle**, painting over the entire
map. They also poison `fitExtent`, so fitting before testing rejects every
feature.

They received **$610,740** in the 2024 cycle (DC, which does project, adds
$148,750). They are partitioned out with a plain unfitted projection, rendered
as labelled chips beside the map, and included in the table. A map that
silently loses them is the same class of error as one that renders a
superseded district as current.

---

## A note on the fonts

- **Instrument Serif / Instrument Sans** — OFL, self-hosted, used for display
  and UI as requested.
- **Bodoni Moda** — OFL. Used for amounts and for C's denominational display.
  This is the honest substitute for "the Treasury font": the Bureau of
  Engraving and Printing does **not** release the faces on US currency — the
  numerals are custom engravings, not a licensable typeface. Bodoni is the
  didone family that 19th-century US banknote engraving actually drew on, so
  it is the closest legitimate answer rather than a lookalike.
- **Xanh Mono** — OFL. Serials, tabular figures, filing-period strings.

Latin subsets only, deduplicated, **192 KB total**, self-hosted so nothing
render-blocking is fetched from a third party.

---

## Cost summary

| | A Broadside | B Plate | C Specimen |
|---|---|---|---|
| Renderer | SVG + CSS | WebGL2 + Canvas2D | Canvas2D |
| First paint | ~250 ms | ~430 ms | ~260 ms |
| Per-frame work | none | none (static mesh) | none |
| Needs WebGL | no | **yes** | no |
| MapLibre port | trivial | custom layer + stencil | 18 pattern images, or custom layer |
| Texture bytes | 27 KB (3 PNGs) | 16 KB (1 PNG) | 25 KB (2 PNGs) |
| Dark mode | ramp reversed, validated | **separate additive model** | ramp reversed, validated |
| Survives greyscale/CVD | partly (vintage is hue-coded) | yes | yes |

Shared cost for all three: 1.44 MB district GeoJSON (16.6 MB raw, simplified
with shared-boundary topology so contiguous borders stay contiguous), 192 KB
fonts, 53 KB vendored d3-geo/d3-array/earcut.

---

## What is not decided here

The prototypes resolve the **aesthetic and the encoding**. They do not resolve
the MapLibre port, which is task 5 of the v1 plan and carries its own risk —
deliberately, because resolving the look first and cheaply is what a prototype
is for. A and C port without a custom WebGL layer; B does not.

---

# Round 2 — D, E, F · what the colour should mean

Written 2026-09-19, same day as round 1. Round 1 settled **what riso is for**
and B won. Round 2 keeps B's press and asks the next question — **what the
colour should mean** — over the **2026** cycle: $328,788,436 of PAC money in
441 districts, $80,871,118 to Senate candidates. It also adds the three things
B could not do: a state blow-up, a Senate layer, and motion.

| | D — Three-Plate | E — Tilt | F — Sector Plates |
|---|---|---|---|
| Colour means | the money, nothing else | the recipient's party tilt | the donor mix |
| Plates | 3, sequential build | 3 — REP / neutral / DEM | 4 — Corporate / Trade / Labor / other |
| Money axis | **passes** light + dark | **passes at every tilt**, light + dark | **passes at every mix**, light + dark |
| Second channel readable | n/a | **147 of 441 districts** | **nowhere** |
| Greyscale | yes | partly | no |

## What building them turned up

Numbering continues round 1's. Every figure below is measured, and the scripts
that measured them are the ones in `shared/inks.js`.

### 8. The ramp was TYPED, not printed — so the legend showed a different map

Round 1 validated each prototype's `ramp` array and recorded the check it
passed. But the map is not drawn from `ramp`: the shader overprints the
`plates` and the reader sees the composite. Nobody had ever compared the two.

Prototype B, its own numbers:

```
declared   #95b59f #779b82 #5d8069 #486552 #374a3d #27302a
printed    #9cc4ae #60a482 #248456 #166f4c #145d4a #114a49
dark declared  #32503c #31764d #2f9d61 #3fc47b #67e89c #c8fed9
dark printed   #224134 #295d45 #307a57 #3a9079 #45a4a0 #50b8c7
```

Re-validated against what it prints, B's light ramp **fails**: pale end
1.73:1 against its paper (floor 2:1) and two adjacent steps under the ΔL gate.
Its dark ramp fails too, at 1.60:1. The round-1 result "ordinal PASS · pale
end #95b59f at 2.02:1" is true of a swatch nobody can see.

The fix is structural rather than a re-type: `plateTone()` is a JS port of the
shader's own Kubelka-Munk (and additive-dark) composite, and every round-2
`ramp` is **derived from the plates at load**. A legend that disagrees with the
map is no longer expressible. Round 1's B is deliberately left as it is — it is
the artifact the user already judged — but it is no longer described as
validated.

### 9. The coverage cap was moved to the composite; the floor was left on a plate

Round 1's correction #5 capped coverage at 0.88 so the halftone cell never
closes. Round 2 moved that cap to the composite, where it can actually hold
across N plates. **The floor at the other end of the range was not moved with
it.** So the bottom step put 0.115 of a cell of ink down where the design said
0.20 — the palest districts printed at 57% of their intended weight.

Both ends now live on the composite, and the sequential build and the
proportional mix became one function (`splitInk`) with different weights.
"Total ink is the money" is now true by construction in all three prototypes
rather than nearly true in two.

### 10. Six steps and a visible pale end are in direct conflict — and it is arithmetic

A halftone cell at coverage *c* over paper of luminance *L* averages at best
`(1-c)·L`, whatever the ink: the paper showing through sets a ceiling on how
dark a light screen can read. Against `#F5F3EE` that makes **2:1 unreachable
below c ≈ 0.53 even with a pure black ink.** A 20% screen cannot clear the pale
-end floor and no choice of ink will rescue it.

Raising the floor buys the pale end and spends the step gaps: the whole ramp
now lives in a shorter stretch of lightness, and six quantile classes at
ΔL ≥ 0.06 need 0.30 of it. Measured, at a floor of 0.50 the light end passes
and adjacent steps start colliding.

What resolves it is **spacing the six steps equally in perceived lightness
instead of equally in coverage** — the coverage for each step is ours to
choose, and linear coverage wastes the gaps at exactly the pale end where they
are scarcest. Each system therefore carries a measured `table` of six
coverages, and that table (not a formula) is the money encoding.

### 11. Iso-lightness has to be measured on the printed tone, not on the ink

E and F both claim lightness is the money and hue is the second variable. That
claim is only true if the plates are equal in lightness — otherwise a
district's tone moves when its *mix* moves, and the money axis is not an axis.

Setting the inks to a common OKLab L does not do it. Kubelka-Munk mixes per
channel, so a saturated red and a neutral gray at the same L print at
different lightnesses once the paper is in the loop, and the per-mix ramps
diverged by enough to fail the ΔL gate. Each ink is now solved for **the
lightness its own full coverage prints at**, which makes every mix's money
ramp agree.

### 12. A bivariate riso map dims its second variable exactly where the first is smallest

E's tilt hue, REP ↔ DEM, measured on the printed composite at each money step:

| step | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| normal ΔE | 6.5 | 9.1 | 11.9 | 14.6 | **17.7** | **20.9** |
| CVD ΔE | 5.4 | 7.5 | 9.8 | 11.9 | **14.4** | **17.1** |

It clears the 15 / 8 floors at the top two steps only: **147 of 441 districts
(33.3%), holding $197.4M of $328.8M (60.0%)**. On the other 294 the hue is
present and is not readable.

This is not a palette that can be fixed. Lightness encodes money by putting
*less ink* on a poorer district, and less ink is less hue. The chroma in E is
the **highest** that still passes the money axis — the reverse of round 1's
correction #3, and deliberately: there chroma was decoration, here it is the
data.

### 13. F's premise is refuted by its own plates

Corporate ↔ Trade ↔ Labor, same measurement:

| step | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| normal ΔE | 4.7 | 6.6 | 8.2 | 10.0 | 11.5 | 13.0 |
| CVD ΔE | 1.7 | 2.4 | 3.0 | 3.7 | 4.2 | 4.6 |

The normal-vision floor (15, a hard gate that secondary encoding does not
excuse) is never cleared, and the CVD floor is never approached. A search over
hue triples does not rescue it: the best available — abandoning the semantic
blue/orange/green for blue/olive/magenta — reaches CVD 8.4 and normal 13.7,
and only at the very top step. So F keeps the semantic hues, because neither
set passes and the semantic one is at least honest about what it means.

The cause is the medium: an overprint is muted by the paper under it, so three
screens at a shared coverage land far closer together than the three inks are.
**F is a beautiful object that cannot be read.** That is a result, not a bug,
and it is what a prototype round is for.

### 14. The harness reported an exercised control that was never exercised

`check.mjs` clicked every `.ctl` and reported "5 control(s) exercised". The
state picker is one of the five — and it is a `<select>`. Clicking a `<select>`
in headless Chromium opens no menu and fires no `change`, so **the state
blow-up, the headline feature of round 2, was never once entered** while the
harness passed. `selectOption` fires the event; `click` does not.

Same shape as the GL-flags trap already written at the top of that file: a
check that runs, reports a pass, and tests nothing. `checkStateView` now enters
three states — TX (38 districts, all superseded), MD (the DC→MD Senate
correction, money banked), PR (a territory, undrawable on Albers USA and
therefore only ever a map here) — and asserts the district count, the money,
the Senate figure, the re-screen **on the GPU uniform rather than on its own
label**, that the press one-shot runs, that reduced motion moves nothing at the
moment of entry, and that going back restores 436 districts plus five chips.

## The verdict

**D — Three-Plate**, chosen 2026-09-19. Money only: three plates, green →
teal → navy, an extended tonal range and no second variable. E and F are not
carried forward. §§12-13 are why, and they are the round's real finding: a
bivariate riso map dims its second variable exactly where its first is
smallest, so E could show tilt on a third of the districts and F could show
its donor mix on none.

D becomes tasks 4 and 5 of `docs/superpowers/plans/2026-09-18-v1-launch.md`.

## What round 2 did not decide

Whether a map may encode a second variable it can only show on a third of its
districts, and whether F's unreadability disqualifies it or is simply the price
of the most riso-true answer. Both are the user's call, which is why the
numbers are here rather than a recommendation.
