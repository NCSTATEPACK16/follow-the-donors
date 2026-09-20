# follow-the-donors

Static public map of federal PAC money by congressional district. Sibling to
follow-the-ppp; same architecture, different data.

## Invariants — do not violate

Each rule names the measurement or incident that produced it. Numbers cite
`reports/00_feasibility.md` (2024 cycle, measured 2026-09-16).

- **No individual is ever named.** Not a name, employer, occupation, city, or
  row — not in the UI, a JSON artifact, a tile, or any downloadable file.
  Individual money exists only as aggregates, suppressed below 5 donors. The
  site carries ads, which makes this statutory rather than editorial:
  52 U.S.C. § 30111(a)(4) bars using contributor information for commercial
  purposes, and the FEC's carve-out is explicit that it "applies only to the
  use of individual contributor information. Any person may compile and sell
  the names of political committees." `NAME` from `itcont.txt` reaching any
  published artifact is a release blocker.

- **Independent expenditures are never contributions.** In pas2 2024, 24A
  (against) + 24E (for) total **$4,497,565,949** against **$514,269,264** of
  actual contributions (24K + 24Z). Summing pas2 without splitting by
  transaction type overstates money given to a candidate by **8.7x**. This is a
  category error, not a duplication: an independent expenditure may not legally
  be coordinated with the candidate and never enters their account. Never add
  the two; never describe an IE as money a candidate received.
  Contribution types are `24K` (to non-affiliated committee) and `24Z`
  (in-kind). `24C` is a coordinated party expenditure and `24F` a communication
  cost; neither is a candidate receipt either.

- **Resolve the candidate through the recipient committee, never through
  pas2's own `CAND_ID`.** Join `pas2.OTHER_ID` -> `ccl.CMTE_ID` -> `CAND_ID`.
  Measured: the donor-reported `CAND_ID` column reconciles at **-6.79%**; the
  recipient-committee join reconciles at **-0.72%**, with 99.95% of rows
  resolving. The donor's own attribution is not trustworthy.

- **`ccl` is not unique on `CMTE_ID`, and joining as if it were double-counts
  money.** 190 committees in 2024 (262 in 2026) link to more than one
  `CAND_ID`, so a join on `CMTE_ID` alone turned **9,972 pas2 rows into two
  contributions each and double-counted $2,545,768** — manufacturing `SUB_ID`
  collisions the bulk file does not have, directly against the invariant
  above. Resolve only through a candidate's own authorized committees
  (`CMTE_DSGN` in `P`, `A`) and take the most recent registration
  (`FEC_ELECTION_YR`, then `LINKAGE_ID` to break ties deterministically —
  an arbitrary tiebreak moves money between candidates from one rebuild to
  the next). 164 of those 190 are one person with two registrations; the rest
  are joint fundraising committees, which link to every candidate they raise
  for (one links to 16) and whose receipts therefore belong to no single
  candidate. Measured, no 24K or 24Z in pas2 is received by a committee
  outside `P`/`A`, so the restriction costs nothing. See
  `_hygiene.candidate_link_sql()`.

- **Do not de-duplicate amendments. The bulk files already supersede.**
  `SUB_ID` is unique across all 703,597 pas2 rows, and only **600 rows
  (0.085%)** genuinely appear under more than one `AMNDT_IND`. The widely
  repeated prescription — drop `N` records where an `A` exists for the same
  committee and report type — would delete **16,098 rows / $36,836,573**, i.e.
  27x more than actually collide. It is a data-destroying filter. Measured, not
  assumed.

- **`MEMO_CD='X'` is excluded from sums.** Itemized sub-transactions restate
  money already counted in their parent line. Removes $4,053,118 from 24K/24Z
  in 2024. (`24T` earmark conduits do **not** occur in pas2 at all — that is an
  individual-file phenomenon.)

- **Itemized is never presented as total.** Contributions under $200 are never
  itemized; they exist only as a lump sum on the committee's summary filing.
  For a grassroots campaign that invisible mass can be 30-50% of everything
  raised, so itemized-only charts describe a different candidate and
  systematically flatter big-donor campaigns. Every total carries its
  itemized/unitemized split; every breakdown renders the unitemized remainder
  as an explicit visual band.

- **Leadership PAC and JFC money is a separate tier**, never merged into a
  campaign total. Note that `ccl` will not enforce this for you: the 2024 file
  contains only 22 leadership-PAC (`D`) links, so filtering on `CMTE_DSGN` is
  not sufficient. Enforce on committee type directly.

- **Every district geometry carries its map vintage.** Eleven states redrew
  congressional maps in 2025-26 and Census `cd119` reflects none of them. A
  2024 contribution to "TX-35" and a 2026 one are not the same place. Vintage,
  provenance and legal status are first-class fields, rendered, never inferred.
  Measured by `05_districts.py`: **173 of 441 districts (39.23%) are drawn
  from a map that is no longer the law** — nine states are voting on new lines
  in 2026 and we do not yet hold their geometry. `map_status` distinguishes
  the four cases and they are never collapsed:
  `cd119_current` (no redraw — the map we draw is the law), `cd119_superseded`
  (a redraw is in effect and we cannot draw it, so these districts are stale),
  `cd119_contested` (enacted then blocked; cd119 still governs), and
  `override_applied`. Reporting a superseded district as current states
  something false about 2 districts in 5.

- **`legal_status` answers which map governs, never whether anyone is suing.**
  Texas, Tennessee and Louisiana are all under active challenge and all three
  of their new maps are `in_effect`. Missouri's and Virginia's were enacted
  and then blocked, so `cd119` is operative there. Geometry we happen to hold
  never decides this: a blocked map's shapefile on disk must not cause us to
  draw a map that is not the law.

- **An exact ZIP answer and a prefix answer are never equated.** ZCTAs do not
  exist for PO-box-only or point ZIPs and committees use PO boxes heavily, so
  only **85.12%** of the 5-digit ZIPs in FEC's `cm.txt` resolve by
  intersection. The ZIP3 prefix fallback lifts that to **99.76%**, but it
  answers with every district the ZIP's three-digit neighbourhood touches —
  deliberately wider than the truth. Every row records which it is
  (`zcta_intersection` vs `zip3_prefix`) and the UI renders them differently.
  This is the structural heir to follow-the-ppp's `geo_precision`, same as the
  itemized/unitemized split.

- **The crosswalk is an area approximation, not population-weighted.** Census
  publishes no CD119 block equivalency file — spike 00c proved it by deriving
  the vintage rather than assuming it (Texas: 36 districts in `baf2020`, 38 in
  `cb_2025_us_cd119`). A ZCTA split 50/50 by area may be split 90/10 by
  people. `derivation` records this on every row. Do not quietly upgrade the
  claim.

- **All IDs and ZIPs are VARCHAR.** `CMTE_ID`, `CAND_ID`, `SUB_ID`, `TRAN_ID`,
  `ZIP_CODE`, FIPS, district numbers. Never int: leading zeros matter, `SUB_ID`
  exceeds 2^53, and FEC's `ZIP_CODE` is ragged free text (4-, 5- and 9-digit
  values occur in the same column).

- **Every published figure names the filing period it covers.** This data is
  live and amended, the opposite of follow-the-ppp's frozen dataset.

- **Barred sources — license-incompatible with an ad-supported site.**
  OpenSecrets bulk data and CRP catcodes (CC BY-NC-SA; NonCommercial bars us,
  ShareAlike would infect our derived work; API discontinued 2025-04-15),
  FollowTheMoney/NIMSP (same license), and the HUD USPS ZIP crosswalk
  (sublicensed to governmental entities and registered non-profits only).
  Use Census public-domain files instead. Listed here with reasons so nobody
  re-adds one.

- **$0 infrastructure.** The 10 GB R2 free tier is shared with follow-the-ppp
  (1.89 GB used), leaving ~8.1 GB. Overage would be $0.015/GB-month, but the
  published artifact set is ~100 MB, so this is not close to binding. Check at
  the end of every rebuild anyway.

## Disk

The build machine has ~17 GB free. `itcont.txt` is 10.28 GB extracted, and
`indivYY.zip` additionally contains a byte-identical `by_date/` re-slicing —
so a naive `unzip` writes 20.6 GB and fills the disk. **Never extract
`itcont.txt`.** `01_fetch.py` streams the member; the aggregate pass consumes
it in chunks. Peak disk is the compressed zip only.

## Pipeline

Run `scripts/` in numeric order. Each is idempotent, ends in an acceptance
check that exits nonzero on failure, and writes `reports/NN_name.md`.

## The reconciliation gate

Computed PAC contributions per candidate, checked against the FEC's own
published totals in `weball` (`OTHER_POL_CMTE_CONTRIB + POL_PTY_CONTRIB`).
This is what makes the hygiene checkable rather than asserted.

Aggregate reconciles to **-0.72%**, but per-candidate does not: median relative
error 6.17%, p90 80%. Errors net out nationally and are large individually, so
the gate is three parts, never a strict per-candidate tolerance (which would
fail constantly and train us to ignore it):

1. Aggregate tolerance: |computed - reported| / reported <= 1.5%.
   Achieved **-0.72%** for 2024. (Was -0.61% until 2026-09-18, when the ccl
   fan-out fix removed $2,545,768 of double-counted money — the figure got
   slightly worse because it had been flattered by duplicate rows.)
2. Coverage floor: share of candidates within 5% must not regress below the
   achieved **44.4%**, ratcheted the way follow-the-ppp ratchets `MIN_MATCHED`.
   Measured 44.47% after the ccl fan-out fix, up from 44.04% before it:
   removing the duplicate rows moved candidates INTO agreement.

   *Corrected 2026-09-17.* This previously read 45.2%, taken from the Phase 0
   spike's "rejected alternatives" table. That figure is **not reproducible**
   and the constant would have failed on every run. What does reproduce, to
   the dollar, is everything else in that spike: the aggregate for the adopted
   ccl join (-0.61% against its -0.64%), the aggregate for the
   principal-committee variant (-0.87% against its -0.89%), the donor-CAND_ID
   join's whole first section (40.9% within 5%, median 7.83%), and all ten
   named outliers with identical amounts. So the join is right and the
   aggregate is right; the spike's distribution row was computed over a
   different candidate set than its aggregate row. The spike was explicitly
   throwaway and is not in the repo, so the inconsistency cannot be traced
   further. Recorded rather than normalised away.
3. A named-outlier list carried as parametrized regression cases
   (`tests/test_reconciliation_acceptance.py`), asserted on **membership and
   ratio, never exact dollars** — FEC data is amended continuously and pinned
   dollars would fail on every routine amendment. Top current outlier:
   SCALISE, STEVE (`H0LA01087`) — principal committee shows $2.03M of 24K/24Z
   against weball's $187,000 on $14.7M total receipts. **Unexplained.**
   Recorded rather than normalised away.

Only **2024 hard-gates.** `weball26` is a mid-cycle snapshot with partial
filing periods and small denominators; measured, 2026 lands at **+5.16%**
(re-measured 2026-09-19; a prior pass on this repo recorded +5.08%, which the
database no longer reproduces and should not be trusted over this figure),
which a 1.5% tolerance would fail on every run. 2026 computes the identical
numbers into `reports/03_hygiene.md` and never fails the build until its own
thresholds are measured and ratcheted. See `_db.GATE_CYCLES`.

## Publishing

R2 objects are `immutable, max-age=31536000`. A corrected file takes a NEW
name; overwriting reaches nobody who already visited. Only the small
unversioned JSON sidecars (1-hour cache) may be overwritten in place. The
upload manifest must stay in step with `web/src/lib/config.ts` or the frontend
404s in production and nowhere else. Run `--verify` after any deploy; a 429 is
not a missing object.
