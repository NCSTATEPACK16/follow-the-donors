# Phase 4 — aggregation (stage 06)

Implemented 2026-09-18. The base map exists: PAC dollars flowing in to each
district's representative, by donor tier and sector, carrying the district's
map vintage.

## What shipped

| file | purpose |
|---|---|
| `scripts/_aggregate.py` | district attribution rules — office filter, delegate encoding, cross-cycle comparability |
| `scripts/06_aggregate.py` | the stage: the five-way partition, three outputs, six acceptance checks |
| `tests/test_aggregate.py` | 13 unit tests |

Outputs per cycle (gitignored, `data/interim/`): `district_totals_*.parquet`,
`district_sector_*.parquet`, `candidate_totals_*.parquet`.

## The spine is a partition, not a filter

Every contribution dollar lands in exactly one of five buckets — `district`,
`statewide`, `national`, `unassignable`, `unresolved` — and the five are
asserted to sum back to the hygiene total **to the cent**. That is what makes
"PAC money in this district" checkable rather than asserted, the role
03_hygiene's reconciliation plays one stage earlier. A join that fans out, a
filter that drops rows, a Senate race leaking into an at-large district: each
breaks the sum. That is the point, and it is how the defect below was caught.

2024, after the fix:

| bucket | contributions | dollars | share |
|---|---|---|---|
| `district` | 418,411 | $420,315,216 | 82.46% |
| `statewide` | 174,625 | $89,745,312 | 17.61% |
| `unassignable` | 129 | $194,744 | 0.04% |
| `unresolved` | 1 | $3,300 | 0.00% |
| `national` | 23,617 | -$549,034 | -0.11% |

The national bucket is **negative**: presidential committees refunded more PAC
money in the 2024 cycle than they netted. Refunds are real rows with negative
amounts (220,517 of them, -$32.7M, across the whole cycle), not an error, and
they are never suppressed — a bucket that could only be positive would be
hiding them.

## Two encodings that would have gone wrong quietly

**Senate money is not district money.** FEC stores a Senate candidate's
district as `00` — the same code an at-large House seat uses. Aggregating
without filtering on office pours every Senate dollar in Wyoming into
Wyoming's only House district. Gated: no statewide or national row may carry
a district.

**Delegate seats are numbered differently by each source.** FEC numbers the
six non-voting delegations `00`; Census numbers them `98`. Mapping that alone
recovered **$761,890 of the $954,234** that was failing to join. The residue
after both rules is $194,744 (0.046%) — candidates carrying a district from a
map that no longer exists (CA-53, PA-18, MT-00 before Montana regained a
second seat), still registered in `cn.txt`. Measured and gated, not absorbed.

## The headline

**$148,861,248 — 35.42% of 2024 district PAC money — sits in districts drawn
from a map that is no longer the law.** That is the dollar-weighted version of
the 39.23% of districts stage 05 measured, and it is the number the UI has to
state. `comparable_across_cycles` marks those rows so Phase 5 cannot chart
2024 against 2026 for a district whose boundaries moved between them.

## The defect this stage found

`_hygiene.py` joined `ccl` on `CMTE_ID` alone. **`ccl` is not unique on
`CMTE_ID`** — 190 committees in 2024 and 262 in 2026 link to more than one
`CAND_ID` — so one pas2 row became two contributions: **9,972 duplicated rows,
$2,545,768 double-counted**, inflating every downstream figure by ~0.5% and
manufacturing `SUB_ID` collisions the bulk file does not have.

The visible symptom, spotted while sanity-checking the national bucket's
implausible $8.89 average contribution: **BIDEN and HARRIS reported an
identical $818,886 across an identical 6,748 contributions.** Their 2024
committee is linked in `ccl` to both candidate IDs, because it was
redesignated when Harris replaced Biden, and the join credited its receipts to
each of them.

### The fix, and why it is shaped this way

Resolve only through a candidate's **own authorized committees** (`CMTE_DSGN`
in `P`, `A`), taking the most recent registration by `FEC_ELECTION_YR` with
`LINKAGE_ID` as a deterministic tiebreak.

- **164 of the 190** are one person with two registrations — Grayson ran for
  Senate in 2016 and again in 2024 on the same committee. The current
  candidacy is the one receiving the money.
- **The rest are joint fundraising committees**, which link to every candidate
  they raise for; one links to 16. Attributing a JFC's receipts to all of them
  multiplies the money, and to one of them invents a recipient. Money to a JFC
  is JFC money — invariant 8 already keeps that tier separate, and this is the
  same rule applied at the resolution step.
- **The restriction costs nothing.** Measured: every 24K/24Z recipient in pas2
  is already `P` or `A`, so no dollars leave the set. It closes the hole
  structurally rather than by filtering symptoms.
- **A deterministic tiebreak is not fussiness.** An arbitrary one moves money
  between candidates from one rebuild to the next.

### What re-baselining moved

| figure | before | after | why |
|---|---|---|---|
| 2024 aggregate agreement | -0.61% | **-0.72%** | it had been flattered by duplicate rows |
| coverage within 5% | 44.04% | **44.47%** | removing duplicates moved candidates INTO agreement |
| 2024 contribution total | $512,255,306 | **$509,709,538** | the $2.5M double-count removed |

`MIN_COVERAGE_WITHIN_5PCT` ratcheted 0.44 → 0.444. The aggregate gate holds at
±1.5%.

**The outlier roster caught the change, which is what it is for.** BIDEN
(`P80000722`) left the top fifteen once his committee's receipts went to
Harris alone; RAMASWAMY (`P40011082`) entered at tenth. On a closed cycle a
new name can only mean our logic changed — it did, deliberately, and both
moves are recorded in `tests/test_reconciliation_acceptance.py` rather than
quietly absorbed.

## Acceptance

Six checks on 2024, all passing. The double-count check was written **before**
the fix and watched fail on the real data (9,972 rows, $2,545,768) — a gate
proven failable by the defect it was written for.

## Verification

```bash
source .venv/bin/activate
python scripts/03_hygiene.py && python scripts/04_committees.py
python scripts/05_districts.py && python scripts/06_aggregate.py
pytest
```

79 tests pass.

## Open, deliberately

- **Independent expenditures are not loaded.** The bulk IE CSV is fetched by
  stage 01 but no stage reads it, so there is no per-race IE aggregate yet.
  ⚠️ When it is added: the bulk IE file (73,449 rows for 2024) is a *narrower
  universe* than the OpenFEC `schedule_e` endpoint (156,863). Pick one and say
  which.
- **Individual aggregates are not computed.** They need `itcont.txt`
  (`--with-individuals`, 10.28 GB streamed, never extracted) and the k>=5
  suppression rule, which must be applied at computation time so a suppressed
  cell cannot leak through a second code path.
- **The itemized/unitemized split is still unavailable**, because
  `FEC_API_KEY` is unregistered and `01b_totals.py` skips. Invariant 2 needs
  it before any breakdown is rendered.
