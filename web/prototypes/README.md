# Riso prototypes

Two rounds of complete, working answers, built against real data so the choice
can be made by looking. Read **`COMPARISON.md`** for the argument and for
everything building them turned up.

**Round 1** asked *what riso is for* — 2024 cycle, three answers, and **B
won**. **Round 2** asks *what the colour should mean* — 2026 cycle, three
answers built on B, plus the three things B could not do: a state blow-up, a
Senate layer, and motion.

```bash
cd web/prototypes && python3 -m http.server 8777
# then open http://127.0.0.1:8777/
```

| file | what it is |
|---|---|
| `index.html` | the chooser, with a difference matrix per round |
| **round 2 — 2026 cycle, live candidates** | |
| `d-threeplate.html` | D — money only, three plates, extended tonal range · **chosen** |
| `e-tilt.html` | E — bivariate; lightness is money, hue is party tilt |
| `f-sector.html` | F — four sector plates; the colour *is* the donor mix |
| **round 1 — 2024 cycle, settled** | |
| `a-broadside.html` | A — political poster; certainty = keyline registration |
| `b-plate.html` | B — WebGL2 halftone; certainty = screen frequency · **chosen** |
| `c-specimen.html` | C — banknote engraving; certainty = ruling convention |
| **shared** | |
| `shared/inks.js` | every validated ink value, with the check it passed, plus the plate-split maths |
| `shared/plate.js` | the press — one WebGL2 N-plate halftone engine, the screen scale, and the motion |
| `shared/view.js` | round-2 chrome: the two plates, the two layers, the band that never goes away |
| `shared/atlas.js` | data, projection, picking, sheet, table — identical in all six |
| `shared/screens.js` | Canvas2D halftone and ruling, shared so the rotation bug is fixed once |
| `shared/base.css` | the page shell, identical in all six |
| `export_data.py` | rebuilds `data/` from `data/fec.duckdb` (needs `npx mapshaper`) |
| `bake_texture.py` | rebuilds the three texture plates (no dependencies) |
| `check.mjs` | the verification harness — run it before believing anything |

Nothing here is wired into the pipeline or the build. It is a design
exploration; whichever prototype wins becomes tasks 4 and 5 of
`docs/superpowers/plans/2026-09-18-v1-launch.md`.

## Verifying

```bash
node web/prototypes/check.mjs
```

Every page × light/dark × 1440px/390px, checking for JS errors, failed
requests and horizontal overflow; that WebGL2 really initialised; that every
control can be exercised without breaking the page; that **the numbers on the
page agree with the database to the cent**, asserted through each page's own
module graph; that reduced motion moves nothing, asserted on the GL calls; and
that **the state blow-up is actually entered** — three states, with the
re-screen checked against the GPU uniform rather than against the label that
claims it.

That last one exists because the harness used to report the state picker as an
exercised control while never entering a state: it is a `<select>`, and
clicking a `<select>` fires no `change`. See `COMPARISON.md` §14.

It launches headless Chromium with `--use-gl=angle --use-angle=swiftshader
--enable-unsafe-swiftshader`. Those flags are not optional: without them
WebGL2 is unavailable, every shader prototype silently takes its fallback
path, and the harness passes while testing nothing.

## Rebuilding the data

```bash
.venv/bin/python web/prototypes/export_data.py        # both cycles
.venv/bin/python web/prototypes/export_data.py 2026   # just one
```

Writes, per cycle: `districts-CYCLE.geojson` (with the party split on each
feature), `sectors-CYCLE.json`, `states-CYCLE.geojson`, `senate-CYCLE.json`
and `meta-CYCLE.json` (which carries the cycle's own measured quantile breaks
and its reconciliation figure — neither is ever typed into a page).

## A note on `data/`

`web/prototypes/data/` is **not committed** — the repo's `.gitignore` excludes
every `data/` directory, a rule that exists for the multi-gigabyte FEC bulk
files. The artifacts here are small (~1.5 MB of simplified district GeoJSON
per cycle plus some small JSON), but they are derived, so the categorical rule
was left alone rather than quietly carved out.

The consequence: **a fresh clone cannot open these prototypes until you run
`export_data.py`**, and that needs `data/fec.duckdb`, i.e. the pipeline. If
these are going to be reviewed on another machine, commit the files or add a
narrower ignore rule — it is one line either way, and the call belongs to
whoever is reviewing, not to the exploration.
