# follow-the-donors — handoff

Written 2026-09-16, end of Phase 0. Read this before touching anything.
`CLAUDE.md` holds the rules; this holds the *reasoning*, which is the part that
does not survive in code.

---

## The direction, in one paragraph

This is `follow-the-ppp`'s architecture pointed at federal campaign finance:
DuckDB does every expensive thing offline, the output is immutable static files
on R2, a 97-line Worker serves them, and **there is no database and no backend
in production**. The organizing unit is the congressional district. The subject
is **political committee money — PACs, Super PACs, party and candidate
committees — named in full.** Individual contributors appear only as
aggregates, never named. That last point is not editorial taste; it follows
from the site carrying ads, and it is the decision everything else hangs off.

## Why PAC-centric (do not relitigate this)

52 U.S.C. § 30111(a)(4) bars using FEC contributor information "for commercial
purposes." An ad-supported site is a commercial purpose. But the FEC's own
gloss carves out exactly what we need:

> "This restriction applies only to the use of individual contributor
> information. **Any person may compile and sell the names of political
> committees.**"

So: committees get full named detail, individuals are aggregate-only with
suppression below 5 donors, and there is never a bulk donor export. Stripping
addresses while keeping individual names is a gray area we deliberately do not
enter. This also has a happy side effect — it deleted the single largest
subsystem we would otherwise have inherited (see "What we are not building").

## What is done

| | |
|---|---|
| Plan (approved) | `~/.claude/plans/i-am-looking-elegant-emerson.md` |
| Invariants | `CLAUDE.md` — every rule cites the measurement that produced it |
| Phase 0 spike | `reports/00_feasibility.md`. Verdict: **Go**, with 4 corrections, all applied |
| Stage 01 | `scripts/01_fetch.py` — passing, idempotent, `reports/01_fetch.md` |
| Summary-file layouts | `scripts/fec_layouts.py` (FEC publishes no header CSV for these) |
| Deps | `requirements.txt`, pinned. venv at `.venv/` |
| **Phase 1 + Phase 2** | **Complete 2026-09-17.** Spike 00c, stages 01b/02/03/04. See `docs/superpowers/specs/2026-09-17-phase-1-2-implementation.md` |
| **Phase 3** | **Mechanism complete 2026-09-18.** `05_districts.py`, `reference/district_overrides.csv`, 7 acceptance checks. See `docs/superpowers/specs/2026-09-18-phase-3-districts.md` |
| **Phase 4** | **Stage 06 complete 2026-09-18.** Base map, + the ccl fan-out fix. See `docs/superpowers/specs/2026-09-18-phase-4-aggregation.md` |
| Repo | Public at `github.com/NCSTATEPACK16/follow-the-donors`, MIT, CI on push/PR |

Local footprint 1.0 GB. **Nothing is deployed, nothing is pushed, no git
remote, no commits, no cloud credentials exist in this repo.**

## Measured facts — do not re-derive these

All from the 2024 cycle, in `reports/00_feasibility.md`:

- **Independent expenditures are 8.7x the contributions.** `24A`+`24E` =
  $4,497,565,949 vs `24K`+`24Z` = $514,269,264. Summing `pas2` without
  splitting by transaction type is the largest available error, and the
  research document never mentions it.
- **The bulk files already supersede amendments.** `SUB_ID` is unique across
  all 703,597 rows; only 600 (0.085%) collide across `AMNDT_IND`. The widely
  repeated "drop N where an A exists" filter would delete 16,098 rows /
  $36,836,573 — 27x more than exist. **It destroys data. Do not implement it.**
- **Join through the recipient, not the donor's claim.** `pas2.OTHER_ID` ->
  `ccl.CMTE_ID` -> `CAND_ID` reconciles at **-0.72%**; `pas2`'s own `CAND_ID`
  column reconciles at **-6.79%**. 99.95% of rows resolve.
- **But `ccl` is not unique on `CMTE_ID`.** 190 committees (2024) link to two
  or more `CAND_ID`s, so joining on `CMTE_ID` alone double-counted $2,545,768
  across 9,972 rows. Found in Phase 4 — the visible symptom was BIDEN and
  HARRIS reporting an identical $818,886, their shared committee credited to
  both. Fixed 2026-09-18; the aggregate moved -0.61% -> -0.72% (it had been
  flattered by the duplicates) and coverage 44.04% -> 44.47%.
- `24T` (earmark conduit) **does not occur in pas2 at all** — it is an
  individual-file phenomenon.
- `ccl` contains only **22** leadership-PAC (`D`) links, so filtering on
  `CMTE_DSGN` will *not* enforce the leadership-PAC/JFC separation. Enforce on
  committee type directly.
- `TRANS_FROM_AUTH` must **not** be added to the reconciliation target; it
  makes agreement go from -0.6% to -73.8%.

## The reconciliation gate, and why it has three parts

Computed PAC contributions per candidate, checked against FEC's own published
`weball` totals (`OTHER_POL_CMTE_CONTRIB + POL_PTY_CONTRIB`). This is what
makes the hygiene *checkable* rather than asserted, and it is the spine of the
pipeline's correctness story.

Aggregate reconciles to -0.61%. **Per-candidate does not**: median relative
error 6.17%, p90 80%. The errors net out nationally and are large individually.
A strict per-candidate tolerance would fail on every run and teach us to ignore
the gate, so it is instead:

1. aggregate tolerance <= 1.5%
2. coverage floor: >= 44.0% of candidates within 5%, ratcheted
   (the plan's 45.2% is not reproducible — see CLAUDE.md)
3. a named-outlier list carried as parametrized regression cases

**Unresolved, deliberately:** SCALISE (`H0LA01087`) — principal committee shows
$2.07M of 24K/24Z against weball's $187,000 on $14.7M total receipts. Recorded,
not explained. Do not normalise it away to make a number look better; if you
work it out, write down what it was.

## Traps that will bite you

- **Never extract `itcont.txt`.** `indivYY.zip` carries a byte-identical
  `by_date/` re-slicing, so `unzip` writes 20.6 GB. The machine has ~20 GB
  free. Use `stream_member()` in `01_fetch.py`. The individual file is opt-in
  via `--with-individuals` and Phases 1-2 do not need it.
- **duckdb 1.4.x has no cp314 wheel.** pip silently falls back to a source
  build that takes tens of minutes and looks like a hang. Pinned to 1.5.5.
- **Fresh clone + full files + empty manifest = HTTP 416.** Resuming from EOF
  asks for a range the server cannot satisfy. `download()` does a `HEAD` first;
  do not remove it.
- **`weball`/`webk`/`webl` have no published header file** — they 404. Layouts
  live in `scripts/fec_layouts.py`, transcribed with their source URL.
  `GEN_ELECTION_PRECENT` is FEC's own misspelling and is kept verbatim: the
  published layout is the contract.
- Inherited from follow-the-ppp and still true: **a 429 from r2.dev is not a
  missing object**, and in the Worker the 200-vs-206 decision must key off the
  *client's* `Range` header, never off `obj.range` being populated.

## What we are not building (and why the temptation will recur)

- **No Cloudflare D1, Workflows or KV.** The research document
  (`~/Downloads/Political Donation Tracker Architecture.md`) specifies them.
  D1's free tier is 500 MB per database and 100,000 row-writes/day — loading
  one cycle of individual contributions would take 580 days. It is disqualified
  by arithmetic, not preference.
- **No DuckDB-WASM.** It exists in follow-the-ppp only to serve 11.5M-row name
  search. With no global name search, candidate/committee search is a few
  thousand names in a ~200 KB static JSON. The 6.8 MB wasm engine, the 499 MB
  Parquet index, the 59 state shards and the prewarm dance all drop out.
- **No point map.** FEC itemized data has no street address — the finest
  honest geography is ZIP+4. Choropleths only, z0-9.
- **No OpenSecrets / catcodes, no FollowTheMoney, no HUD ZIP crosswalk.** All
  three are license-incompatible with an ad-supported site (CC BY-NC-SA, and
  HUD's is government/non-profit only). Build the sector table from FEC's own
  `ORG_TP` + `CONNECTED_ORG_NM`. This will be tempting to "just quickly" reach
  for. Don't.

## Cost boundary — a standing instruction

The user's rule: **no cost without explicit approval, per action.** Nothing has
been spent and nothing is committed. Phases 0-3 touch no network service except
fec.gov and census.gov. The first cloud action in the entire plan is
`11_upload_r2.py`, deliberately last. Do not create a bucket, deploy a Worker,
upload an object, push a repo, or register a domain without asking first.

Verified: Workers free plan returns Error 1027 rather than billing on overage.
**Unverified:** whether R2 storage overage auto-bills and whether a hard spend
cap exists — the pricing page is silent. Projected usage is ~100 MB against a
10 GB tier already holding follow-the-ppp's 1.89 GB, so the margin is ~5x.

Also latent: Phase 6's scheduled rebuild uses GitHub Actions, free and
unlimited for **public** repos but 2,000 min/month for private — so repo
visibility is quietly a cost decision. GitHub runners also have ~14 GB disk,
which may be too tight for the individual-file path.

## Next step

Phase 3's *mechanism* is done and its remaining work is data sourcing, which
is tracked in the stage's own report rather than in prose here.

**Phase 4 continues at `07_tiles.py`.** `06_aggregate.py` is done: the base
map exists and its five-way partition sums to the hygiene total to the cent.
Three things are still owed inside Phase 4, all recorded in that stage's spec:
independent expenditures (fetched but never loaded), individual aggregates
(need `itcont.txt` and the k>=5 rule), and the itemized/unitemized split
(blocked on `FEC_API_KEY`).

Read `docs/superpowers/specs/2026-09-18-phase-4-aggregation.md` first — it
records a double-counting defect found in Phase 1-2's ccl join and fixed here,
which moved the reconciliation figures every other document quotes.

## What Phase 3 settled

- **39.23% of districts are stale, and the number is now rendered rather than
  discovered.** 173 of 441 districts sit in the nine states voting on new
  lines in 2026 whose geometry we do not hold. `map_status` separates
  `cd119_superseded` (a redraw is in effect and we cannot draw it) from
  `cd119_current` (no redraw happened). Collapsing those two — which is what
  the spike's single `cd119_base` label did — states something false about two
  districts in five.

- **`legal_status` answers which map governs, not whether anyone is suing.**
  This corrects the approved plan, which listed TN and LA as "in litigation"
  and MO as "blocked". Measured against the record: TX, TN and LA are all
  under active challenge and all three maps are **in effect** for 2026; MO and
  VA were enacted and then struck down, so `cd119` is operative there. A
  status that conflated the two would have drawn the wrong map for three
  states.

- **The 15% ZIP shortfall is closed to 0.24%.** The ZIP3 prefix fallback takes
  answerable FEC committee ZIPs from 85.12% to **99.76%**. The prefix answer
  names every district the ZIP's three-digit neighbourhood touches — wider
  than the truth on purpose — and `resolution` records which kind of answer
  each row is so the UI can never silently equate them.

## What Phase 3 still owes

Both lists are printed by `_districts.sourcing_gaps()` into
`reports/05_districts.md` on every run, and neither fails the build: this is
tracked work, not a defect, and a gate that fails on every run until fifty
states are perfect is a gate nobody reads.

1. **Geometry for nine states** — AL, CA, FL, LA, NC, OH, TN, TX, UT. Until
   each arrives, those districts render as `cd119_superseded`. Adding one is a
   data change: drop the shapefile in and name it in `geometry_source`.
2. **Provenance for all eleven** is still `documentary` — the facts were read
   from the Wikipedia 2025-26 redistricting article on 2026-09-18, which is
   enough to *say* a state redrew and not enough to *draw* from. Ballotpedia
   was tried first and is bot-blocked, so its pages could not be read and were
   not cited. Replace each with the enacting legislature's bill record, the
   canvass, or the court order, and flip `provenance_kind` to
   `enacting_authority`.

**Two loose ends carried forward, deliberately:**

1. `FEC_API_KEY` is not registered. `01b_totals.py` skips cleanly without it,
   so the pipeline runs end to end, but its live sweep is unvalidated and
   `MIN_RECEIPTS_AGREEMENT` is a provisional 0.90. Register free at
   api.data.gov, put it in `.env`, run the stage, ratchet the constant.
2. SCALISE (`H0LA01087`) is still unexplained. Carried as a regression case
   asserting the ratio stays above 5x, so a change that quietly normalises it
   fails loudly. If you work it out, write down what it was.
