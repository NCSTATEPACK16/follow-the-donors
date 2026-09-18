# Phase 0 feasibility spike — cycle 2024

## Load

| table | source | rows |
|---|---|---|
| cn | cn.txt | 9,798 |
| cm | cm.txt | 20,938 |
| ccl | ccl.txt | 8,619 |
| weball | weball24.txt | 3,856 |
| pas2 | itpas2.txt | 703,597 |

## Q3 — Is amendment supersession already applied in the bulk file?

- pas2 rows: **703,597**
- distinct SUB_ID: **703,597**
- duplicate SUB_IDs: **0**

| AMNDT_IND | rows | dollars |
|---|---|---|
| N | 622,874 | $3,261,135,971 |
| A | 79,365 | $1,831,359,533 |
| T | 1,358 | $17,073,624 |

## Transaction type mix (pas2)

| TRANSACTION_TP | rows | dollars |
|---|---|---|
| 24A | 19,243 | $2,554,991,126 |
| 24E | 58,611 | $1,942,574,823 |
| 24K | 621,349 | $512,548,692 |
| 24C | 1,094 | $90,575,928 |
| 24F | 708 | $7,101,055 |
| 24Z | 2,501 | $1,720,572 |
| 24N | 91 | $56,932 |

## MEMO_CD mix (pas2)

| MEMO_CD | rows | dollars |
|---|---|---|
| (null) | 687,932 | $5,029,112,010 |
| X | 15,665 | $80,457,118 |


## Q3b — Does the bulk file retain superseded originals?

The research doc asserts bulk files keep both the original (N) and the
amended (A) record, and prescribes grouping by committee+report+year to
supersede. Testing that directly: does the same economic transaction
(same donor committee, recipient candidate, date, amount, type) appear
under BOTH an N and an A indicator?

- transaction groups appearing under more than one AMNDT_IND: **193**
- rows involved: **600**

## What the doc's prescribed amendment filter would do

Dropping N-records whose (committee, report type) has any A-record would
delete **16,098 rows / $36,836,573**.

## The reconciliation gate

Only 24K (contribution to non-affiliated committee) and 24Z (in-kind) are
contributions TO a candidate. 24A/24E are independent expenditures —
money spent about a candidate, never received by them. 24C is a
coordinated party expenditure and 24F a communication cost; neither is a
candidate receipt either.

Target: weball's OTHER_POL_CMTE_CONTRIB + POL_PTY_CONTRIB, which is what
the candidate's own committees reported receiving from committees.

- candidates matched on CAND_ID: **1,623**
- computed from pas2 (24K+24Z, memo-filtered): **$501,931,511**
- reported by candidates in weball: **$538,476,018**
- difference: **$-36,544,507** (-6.79%)

Per-candidate agreement (candidates with reported > 0, n=1,256):

| band | candidates | share |
|---|---|---|
| within 1% | 214 | 17.0% |
| within 5% | 514 | 40.9% |
| within 20% | 808 | 64.3% |
| median relative error | | 7.83% |


## Reconciliation, corrected join

The first attempt summed on pas2's donor-reported `CAND_ID` and landed at
-6.79%. Resolving the recipient committee instead — `pas2.OTHER_ID` joined
through `ccl` to `CAND_ID` — lands at **-0.61%**. 633,717 of 634,012 rows
(99.95%) resolve. The donor-reported CAND_ID field is not trustworthy; the
recipient committee is.

Rejected alternatives, measured:

| target definition | aggregate | within 5% | median | p90 |
|---|---|---|---|---|
| PAC + party contributions | **-0.64%** | 45.2% | 6.17% | 80.34% |
| + transfers from authorized | -73.80% | 24.1% | 23.55% | 94.44% |
| restricted to principal-committee links | -0.89% | 44.9% | 6.22% | 79.67% |

Adding `TRANS_FROM_AUTH` is badly wrong: those are mostly a candidate's own
inter-committee movements, which never appear in pas2. Restricting the ccl
join by `CMTE_DSGN` changes almost nothing, because only 22 leadership-PAC
(`D`) links exist in the whole file — leadership PACs are largely absent from
ccl, so invariant 6 must be enforced on committee type directly, not by
assuming ccl excludes them.

## The finding that shapes the gate

**Aggregate reconciles to within 1%. Per-candidate does not** — median
relative error 6.17%, p90 80%. The errors net out nationally but are large
individually. A strict per-candidate tolerance would therefore fail
constantly and teach us to ignore it.

Gate design that follows from this:

1. **Aggregate tolerance** — |computed - reported| / reported <= 1.5%.
2. **Coverage floor** — share of candidates within 5% must not regress below
   the achieved 45.2%, ratcheted the way follow-the-ppp ratchets MIN_MATCHED.
3. **A named outlier list**, below, carried as parametrized regression cases
   the way tests/test_county_join_acceptance.py carries its counties.

### Named outliers at time of spike

| candidate | computed | reported | gap |
|---|---|---|---|
| SCALISE, STEVE MR (`H0LA01087`) | $2,034,269 | $187,000 | $1,847,269 |
| MCCORMICK, DAVE (`S2PA00661`) | $2,233,016 | $1,066,344 | $1,166,672 |
| HALEY, NIKKI (`P40010977`) | $-1,129,532 | $32,800 | $-1,162,332 |
| MCCARTHY, KEVIN (`H6CA22125`) | $1,257,813 | $292,500 | $965,313 |
| SCOTT, TIMOTHY E. (`S4SC00240`) | $-135,072 | $730,400 | $-865,472 |
| CRUZ, RAFAEL EDWARD  TED (`S2TX00312`) | $444,911 | $1,268,020 | $-823,109 |
| BIDEN, JOSEPH R JR (`P80000722`) | $818,886 | $154,412 | $664,474 |
| HARRIS, KAMALA (`P00009423`) | $818,886 | $154,412 | $664,474 |
| SINEMA, KYRSTEN (`S8AZ00197`) | $286,385 | $818,655 | $-532,270 |
| BROWN, SAM (`S2NV00308`) | $613,707 | $1,131,536 | $-517,829 |

Scalise is the instructive one: his *principal* committee received $2.07M of
24K/24Z per pas2, while weball reports $187K of PAC contributions against
$14.7M total receipts. Unexplained as of the spike. It is recorded rather
than resolved, because an unexplained 10x gap on a House leader is exactly
the kind of thing that must not be silently normalised away.

## Hygiene filters, measured separately (pas2, 2024)

| filter | effect |
|---|---|
| `TRANSACTION_TP='24T'` (earmark conduit) | **0 rows.** Does not occur in pas2 at all — it is an individual-file phenomenon. |
| `MEMO_CD='X'` on 24K/24Z | removes $4,053,118 |
| amendment supersession | 600 rows / 0.085% genuinely collide (see Q3b) |

### The filter the research document does not mention, and it is the largest

Independent expenditures (24A against, 24E for) total **$4,497,565,949** in pas2,
against **$514,269,264** of actual contributions (24K + 24Z). Summing pas2
without splitting by transaction type overstates PAC money given to
candidates by **8.7x**.

That is an order of magnitude larger than any of the three double-counts the
research document analyses, and it is a category error rather than a
duplication: an independent expenditure is money spent *about* a candidate,
which by law may not be coordinated with them and never enters their account.

**This becomes an invariant**: independent expenditures are never added to
contributions, and are never described as money a candidate received.

## Scale

| quantity | value |
|---|---|
| pas2 rows, 2024 | 703,597 |
| candidates in weball | 3,856 |
| committees (cm) | 20,938 |
| candidate-committee links (ccl) | 8,619 |
| raw input, PAC core | 26 MB zipped / 121 MB extracted |

The PAC core is small enough that the entire Phase 1-2 pipeline runs in
seconds on a laptop. Only the individual-contribution aggregate path touches
multi-gigabyte data.

## Disk constraint discovered during the spike

The build machine has **20 GB free**. `itcont.txt` for 2024 is 10.28 GB
extracted, and `indivYY.zip` additionally contains a byte-identical
`by_date/` re-slicing, so a naive `unzip` writes 20.6 GB and fills the disk.
`01_fetch.py` must extract `itcont.txt` only, and the aggregate pass should
stream rather than materialise.

## Verdict

**Go.** The architecture holds:

- The reconciliation gate is real, at aggregate level, at -0.61%.
- The primary fact table is 703,597 rows — trivially within every budget.
- Two plan corrections are required before Phase 1 (below).

### Corrections to the approved plan

1. **Drop the prescribed amendment-supersession filter.** Measured: it would
   delete 16,098 rows / $36.8M while only 600 rows genuinely collide. The
   bulk file already supersedes. Invariant 5 must be rewritten to say so.
2. **Add the transaction-type invariant.** Independent expenditures (24A/24E)
   must never be summed with contributions (24K/24Z). This is the single
   largest correctness risk found, and it is absent from the research doc.
3. **Resolve candidates via `pas2.OTHER_ID` -> `ccl`,** never via pas2's own
   `CAND_ID` column. Measured difference: -0.61% vs -6.79%.
4. **The gate is aggregate + coverage floor + named outliers,** not a strict
   per-candidate tolerance.

