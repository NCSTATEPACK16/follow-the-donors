"""Stage 01b — the itemized/unitemized split, from OpenFEC.

This backs the invariant that follow-the-ppp's geo_precision is the structural
heir of: **itemized is never presented as total.** Contributions under $200 are
never itemized — they exist only as a lump sum on the committee's summary
filing — so a chart built from itemized rows alone describes a *different
candidate* and systematically flatters big-donor campaigns. For a grassroots
campaign the invisible mass is routinely 30-50% of everything raised.

Separate from 01_fetch.py on purpose: that stage is green and idempotent over
bulk files, and this one talks to a rate-limited API behind a credential.

WHY /candidates/totals/ AND NOT /committee/{id}/totals/
    The committee endpoint is the one that exposes
    `individual_unitemized_contributions` directly — but there are 20,938
    committees, it is one request each, and the free key allows 1,000/hour.
    That is a 21-hour sweep. /candidates/totals/ is ~54 pages per cycle at
    per_page=100. Two orders of magnitude cheaper.

WHY UNITEMIZED IS DERIVED RATHER THAN FETCHED
    /candidates/totals/ returns `individual_itemized_contributions` but no
    unitemized field. weball's `TTL_INDIV_CONTRIB` is itemized + unitemized by
    F3 construction (lines 11(a)(i) and 11(a)(ii)), so:

        unitemized = weball.TTL_INDIV_CONTRIB - api.individual_itemized

    Mixing two sources is only safe if they describe the same universe, so
    that is an acceptance check here rather than an assumption: `receipts` from
    the API is compared against weball's `TTL_RECEIPTS` per candidate. Spot-
    verified while writing this — H0AL01055 reports 2,246,839.19 in both, and
    its split is $757,652.83 itemized against $305,386.55 unitemized, i.e.
    28.7% of that candidate's individual money is invisible to itemized data.

BUILD TIME ONLY. Nothing fetched here reaches a deployed artifact; the API key
never leaves .env.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _fetch
from _db import CYCLES, DATA, GATE_CYCLES, connect, raw_path
from _report import Report, fmt_int, fmt_money, fmt_pct
from _totals import (count_negative_unitemized, count_receipts_agreement,
                     derive_candidate_totals, split_totals)
from fec_layouts import WEBALL

API = "https://api.open.fec.gov/v1/candidates/totals/"
CACHE = os.path.join(DATA, "raw", "openfec")
PER_PAGE = 100

#: Free registered key is 1,000 req/hr (7,200 available by emailing
#: APIinfo@fec.gov). A full two-cycle sweep is ~110 requests, so this sleep is
#: courtesy rather than necessity.
SLEEP = 0.2

#: Fields kept. Everything else on the response is candidate biography we
#: already have from cn.txt.
FIELDS = (
    "candidate_id", "cycle", "receipts",
    "individual_itemized_contributions",
    "other_political_committee_contributions",
    "transfers_from_other_authorized_committee",
    "coverage_start_date", "coverage_end_date", "last_file_date",
)

#: Agreement between the API's `receipts` and weball's `TTL_RECEIPTS` for the
#: same candidate. They are the same F3 line from the same filings, so this
#: should be near-total; anything less means the two sources are not describing
#: the same universe and the derived split cannot be trusted. Ratchet to the
#: achieved value after the first full run.
MIN_RECEIPTS_AGREEMENT = 0.90

#: unitemized = TTL_INDIV_CONTRIB - itemized should not be negative. A few will
#: be, from amendment timing between the bulk snapshot and the API. Measured,
#: capped, and named rather than silently clamped to zero.
MAX_NEGATIVE_UNITEMIZED = 0.05


def fetch_page(key, cycle, page):
    """One page of /candidates/totals/, cached to disk. Returns the payload."""
    path = os.path.join(CACHE, str(cycle), f"page_{page:04d}.json")
    if os.path.exists(path):
        with open(path) as fh:
            return json.load(fh)

    qs = urllib.parse.urlencode({
        "api_key": key, "cycle": cycle, "per_page": PER_PAGE,
        "page": page, "sort": "candidate_id",
    })
    for attempt in range(5):
        try:
            with _fetch._open(f"{API}?{qs}") as resp:
                payload = json.load(resp)
            break
        except urllib.error.HTTPError as exc:
            # 429 is the documented rate-limit response. Everything else at
            # this layer is a real error and should surface.
            if exc.code != 429 or attempt == 4:
                raise
            wait = 2 ** attempt * 5
            print(f"    rate limited, waiting {wait}s")
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(payload, fh)
    time.sleep(SLEEP)
    return payload


def sweep(key, cycle, max_pages=None):
    """Every page for a cycle. Returns (rows, pages_fetched, reported_count)."""
    first = fetch_page(key, cycle, 1)
    pages = first["pagination"]["pages"]
    count = first["pagination"]["count"]
    if max_pages:
        pages = min(pages, max_pages)

    rows, seen = [], 0
    for page in range(1, pages + 1):
        payload = first if page == 1 else fetch_page(key, cycle, page)
        for r in payload["results"]:
            rows.append({f: r.get(f) for f in FIELDS})
        seen += 1
        if seen % 10 == 0 or seen == pages:
            print(f"    {cycle}: page {seen}/{pages}")
    return rows, pages, count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample-pages", type=int, default=None,
                    help="stop after N pages per cycle. For validating the "
                         "code path against the 30/hr DEMO_KEY without "
                         "burning a real key's budget.")
    args = ap.parse_args()

    _fetch.load_env()
    key = os.environ.get("FEC_API_KEY")
    if not key:
        # Deliberately not a failure. The pipeline stays runnable end to end
        # without a credential; this stage's output is consumed by Phase 4.
        print("FEC_API_KEY is not set — skipping stage 01b.\n"
              "  Register a free key at https://api.data.gov/signup/ "
              "(email only, no card)\n"
              "  and add FEC_API_KEY=... to .env, which is gitignored.")
        return 0

    con = connect()
    all_rows = {}
    for cycle in CYCLES:
        print(f"  sweeping {cycle}")
        rows, pages, count = sweep(key, cycle, args.sample_pages)
        all_rows[cycle] = (rows, pages, count)

    # ---- load and join against weball --------------------------------------
    flat = [dict(r, cycle=cycle)
            for cycle, (rows, _, _) in all_rows.items() for r in rows]
    tmp = os.path.join(CACHE, "totals.json")
    with open(tmp, "w") as fh:
        json.dump(flat, fh)

    con.execute(f"""
        CREATE OR REPLACE TABLE api_totals AS
        SELECT candidate_id::VARCHAR          AS cand_id,
               cycle::VARCHAR                 AS cycle,
               receipts::DECIMAL(18,2)        AS api_receipts,
               individual_itemized_contributions::DECIMAL(18,2) AS itemized,
               coverage_start_date::VARCHAR   AS coverage_start,
               coverage_end_date::VARCHAR     AS coverage_end
        FROM read_json('{tmp}')
    """)

    cols = ", ".join(f"'{c}': 'VARCHAR'" for c in WEBALL)
    union = " UNION ALL ".join(
        f"""SELECT CAND_ID AS cand_id, '{c}' AS cycle,
                   TRY_CAST(TTL_RECEIPTS AS DECIMAL(18,2)) AS ttl_receipts,
                   TRY_CAST(TTL_INDIV_CONTRIB AS DECIMAL(18,2)) AS ttl_indiv
            FROM read_csv('{raw_path(c, f"weball{str(c)[2:]}.txt")}',
                          delim='|', header=false, names={list(WEBALL)},
                          types={{{cols}}}, ignore_errors=true)"""
        for c in CYCLES)
    con.execute(f"CREATE OR REPLACE TABLE weball AS {union}")

    derive_candidate_totals(con)

    matched = con.execute("SELECT count(*) FROM candidate_totals").fetchone()[0]
    agree, comparable = count_receipts_agreement(con)
    negative = count_negative_unitemized(con)
    split = split_totals(con)

    agreement = agree / comparable if comparable else 0
    negative_share = negative / matched if matched else 1
    unitemized_share = (split[1] / split[2]) if split[2] else 0

    # ---- report ------------------------------------------------------------
    r = Report("01b_totals", "Stage 01b — itemized/unitemized split (OpenFEC)")
    r.kv("Endpoint", "`/v1/candidates/totals/`")
    r.kv("Sample mode", str(args.sample_pages) if args.sample_pages else "full sweep")

    r.section("Sweep")
    r.table(["cycle", "pages fetched", "candidates reported", "rows kept"],
            [(c, fmt_int(p), fmt_int(n), fmt_int(len(rows)))
             for c, (rows, p, n) in all_rows.items()])

    r.section("The split")
    r.table(["measure", "value"], [
        ("candidates joined to weball", fmt_int(matched)),
        ("itemized", fmt_money(split[0])),
        ("unitemized (derived)", fmt_money(split[1])),
        ("total individual", fmt_money(split[2])),
        ("**unitemized share**", f"**{fmt_pct(unitemized_share)}**"),
    ])
    r.para(
        "That share is the whole point of the invariant. Money under $200 is "
        "never itemized, so any breakdown built from itemized rows alone omits "
        "it — and omits it unevenly, because the candidates who raise most of "
        "their money in small amounts are exactly the ones it hides. Every "
        "published total must carry this split and render the unitemized "
        "remainder as an explicit band.")

    r.section("Are the two sources the same universe?")
    r.para(
        "`unitemized` is derived by subtracting the API's itemized figure from "
        "weball's `TTL_INDIV_CONTRIB`, which is only valid if both describe the "
        "same filings. Checked directly rather than assumed, by comparing "
        "`receipts` against `TTL_RECEIPTS` per candidate (0.5% tolerance).")
    r.table(["measure", "value"], [
        ("receipts agree", f"{fmt_int(agree)} / {fmt_int(comparable)} "
                           f"({fmt_pct(agreement)})"),
        ("negative derived unitemized", f"{fmt_int(negative)} "
                                        f"({fmt_pct(negative_share)})"),
    ])

    r.check("receipts agreement with weball",
            agreement >= MIN_RECEIPTS_AGREEMENT,
            f"{fmt_pct(agreement)} (minimum {fmt_pct(MIN_RECEIPTS_AGREEMENT)})")
    r.check("negative derived unitemized within tolerance",
            negative_share <= MAX_NEGATIVE_UNITEMIZED,
            f"{fmt_pct(negative_share)} (maximum "
            f"{fmt_pct(MAX_NEGATIVE_UNITEMIZED)})")
    r.check("every gate cycle swept",
            all(c in all_rows and all_rows[c][0] for c in GATE_CYCLES),
            f"gate cycles {GATE_CYCLES}")

    con.close()
    return r.write()


if __name__ == "__main__":
    sys.exit(main())
