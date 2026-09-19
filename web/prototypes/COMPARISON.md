# Three riso prototypes — what each one argues, and what building them turned up

Written 2026-09-19. Live at `web/prototypes/index.html` (serve the directory;
`python3 -m http.server` is enough). All three render the **same** data: 441
congressional districts, $420,315,216 of PAC money placed in a district in the
2024 cycle, real `map_status` from stage 05. Nothing is mocked.

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
