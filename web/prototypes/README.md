# Riso prototypes

Three complete answers to "what is riso for on this map", built against real
data so the choice can be made by looking. Read **`COMPARISON.md`** for the
argument and for the seven things building them turned up.

```bash
cd web/prototypes && python3 -m http.server 8777
# then open http://127.0.0.1:8777/
```

| file | what it is |
|---|---|
| `index.html` | the chooser, with a difference matrix |
| `a-broadside.html` | A — political poster riso; certainty = keyline registration |
| `b-plate.html` | B — WebGL2 halftone; certainty = screen frequency |
| `c-specimen.html` | C — banknote engraving; certainty = ruling convention |
| `shared/inks.js` | every validated ink value, with the check it passed |
| `shared/atlas.js` | data, projection, picking, sheet, table — identical in all three |
| `shared/screens.js` | Canvas2D halftone and ruling, shared so the rotation bug is fixed once |
| `shared/base.css` | the page shell, identical in all three |
| `export_data.py` | rebuilds `data/` from `data/fec.duckdb` (needs `npx mapshaper`) |
| `bake_texture.py` | rebuilds the three texture plates (no dependencies) |

Nothing here is wired into the pipeline or the build. It is a design
exploration; whichever prototype wins becomes tasks 4 and 5 of
`docs/superpowers/plans/2026-09-18-v1-launch.md`.

## A note on `data/`

`web/prototypes/data/` is **not committed** — the repo's `.gitignore` excludes
every `data/` directory, a rule that exists for the multi-gigabyte FEC bulk
files. The three artifacts here are small (1.44 MB of simplified district
GeoJSON plus two small JSON files), but they are derived, so the categorical
rule was left alone rather than quietly carved out.

The consequence: **a fresh clone cannot open these prototypes until you run
`export_data.py`**, and that needs `data/fec.duckdb`, i.e. the pipeline. If
these are going to be reviewed on another machine, commit the three files or
add a narrower ignore rule — it is one line either way, and the call belongs
to whoever is reviewing, not to the exploration.
