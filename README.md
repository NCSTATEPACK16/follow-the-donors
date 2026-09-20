# follow-the-donors

A static public map of federal **political committee** money, organised by
congressional district. Sibling to [follow-the-ppp][ppp]: same architecture,
different data.

DuckDB does every expensive thing offline; the output is immutable static
JSON and GeoJSON; the map is a risograph-style halftone drawn by a WebGL2
shader on a canvas. **There is no database and no backend in production**, and
no map library either — MapLibre, PMTiles and tippecanoe were all dropped when
round 2 settled on discrete zoom (`docs/superpowers/plans/2026-09-19-v1-canvas-launch.md`).

[ppp]: https://github.com/NCSTATEPACK16/follow-the-ppp

## Status

**v1 is live at [follow-the-donors.netlify.app][live].** Stages 01–10 build the
artifacts; the app renders 436 districts plus five unprojectable territory
delegations, a Senate layer, per-state blow-ups, search, ZIP lookup and a
per-district sheet.

`ROADMAP.md` is what is left. `docs/HANDOFF.md` holds the reasoning behind the
design and `CLAUDE.md` the invariants — each one cites the measurement that
produced it.

Verification is `pytest` (104), `npm test` in `web/` (5), and
`node web/check.mjs` (80 browser checks against the built bundle, WebGL2
forced on). The last of these is the one that matters: it found three picking
bugs that every screenshot had passed over.

[live]: https://follow-the-donors.netlify.app

## Pipeline

Run `scripts/` in numeric order. Each stage is idempotent, ends in an
acceptance check that exits nonzero on failure, and writes `reports/NN_name.md`.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/01_fetch.py
```

`data/`, `tiles/` and `*.duckdb` are gitignored: the FEC bulk files are
gigabytes and are fully reproducible from `01_fetch.py`'s manifest.

## Data provenance

| source | licence |
|---|---|
| [FEC bulk data][fec] and the OpenFEC API | US Government work, public domain |
| [US Census Bureau][census] cartographic boundary and block-assignment files | US Government work, public domain |

[fec]: https://www.fec.gov/data/browse-data/?tab=bulk-data
[census]: https://www.census.gov/geographies/mapping-files.html

Three otherwise-obvious sources are **deliberately excluded** because their
licences are incompatible with an ad-supported site: OpenSecrets bulk data and
CRP catcodes (CC BY-NC-SA), FollowTheMoney/NIMSP (same), and the HUD USPS ZIP
crosswalk (sublicensed to governmental entities and registered non-profits
only). Sector classification is built from FEC's own `ORG_TP` and
`CONNECTED_ORG_NM` instead.

## Individual contributors are never named

52 U.S.C. § 30111(a)(4) bars using information copied from FEC reports "for the
purpose of soliciting contributions or for commercial purposes." The FEC's own
gloss is explicit about the carve-out:

> This restriction applies only to the use of individual contributor
> information. **Any person may compile and sell the names of political
> committees.**

This site carries advertising, which is a commercial purpose. Therefore
political committees — PACs, Super PACs, party and candidate committees —
appear in full named detail, and **individual contributors appear only as
aggregates, suppressed below 5 donors, with no bulk export, ever.** No name,
employer, occupation, city or individual row reaches any published artifact.

## Not an official source

Not affiliated with, endorsed by, or approved by the Federal Election
Commission. Figures are derived from FEC bulk data, which is live and subject
to amendment; every published figure names the filing period it covers.
For the authoritative record, see [fec.gov](https://www.fec.gov/data/).

## Licence

Code is MIT (see `LICENSE`). The underlying data is public domain; the
restrictions above attach to its *use*, not its copyright.
