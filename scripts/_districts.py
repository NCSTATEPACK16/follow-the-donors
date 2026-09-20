"""District map vintage and ZIP resolution rules.

Split out from the numbered stage for the same reason as _hygiene and
_committees: `05_districts` is not a legal module name, so anything that
deserves a test lives here.

Two problems, both inherited from spike 00c:

1. **Vintage.** Census `cd119` reflects none of the maps redrawn in 2025-26.
   Invariant 3 makes vintage, provenance and legal status first-class fields,
   so the registry in reference/district_overrides.csv names every state whose
   map moved, and map_status() turns that into what the UI tells a visitor.
   The distinction that matters is between a state that never redrew (cd119 is
   simply correct) and one that redrew in a way we cannot yet draw (cd119 is
   *out of date*). Both would otherwise report as "cd119_base".

2. **ZIPs without a ZCTA.** Only 85.12% of distinct 5-digit ZIPs in FEC cm.txt
   resolve: ZCTAs are Census approximations of ZIP codes and do not exist for
   PO-box-only or point ZIPs, which committees use heavily.
   reports/00c_district_spike.md requires the other 15% to be answered as
   something other than "no data", so resolve_zip() falls back to the ZIP3
   prefix and says that it did.
"""

import csv
import os
import re
from collections import namedtuple

REFERENCE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reference")
OVERRIDES_CSV = os.path.join(REFERENCE, "district_overrides.csv")

#: The redraw is law and governs the next election.
STATUS_IN_EFFECT = "in_effect"
#: Enacted then enjoined. cd119 remains operative.
STATUS_BLOCKED = "blocked"
#: Enacted and being challenged; not yet enjoined.
STATUS_IN_LITIGATION = "in_litigation"
LEGAL_STATUSES = (STATUS_IN_EFFECT, STATUS_BLOCKED, STATUS_IN_LITIGATION)

#: No known redraw — cd119 is the operative map and needs no caveat.
MAP_CURRENT = "cd119_current"
#: A redraw is in effect and we do not hold its geometry. What we draw for
#: this state is stale, and saying so is the entire point of the registry.
MAP_SUPERSEDED = "cd119_superseded"
#: A redraw is in effect and we drew it.
MAP_OVERRIDE_APPLIED = "override_applied"
#: Enacted but blocked or under challenge. cd119 is still the law.
MAP_CONTESTED = "cd119_contested"

#: The ZIP had a ZCTA and intersected districts directly.
RESOLVED_ZCTA = "zcta_intersection"
#: No ZCTA; answered from the districts its 3-digit prefix touches.
RESOLVED_ZIP3 = "zip3_prefix"
#: Not answerable at all. Distinct from "touches no district", which cannot
#: happen — every ZCTA in the crosswalk resolves to at least one.
RESOLVED_NONE = "unresolved"

#: The row cites the body that enacted the map — a legislature's bill record,
#: a secretary of state's canvass, or the court order itself. Required before
#: that state's geometry may be drawn.
PROVENANCE_ENACTING = "enacting_authority"
#: The row cites a secondary account. Enough to know a state redrew and to say
#: so in the UI; not enough to draw the new districts from.
PROVENANCE_DOCUMENTARY = "documentary"
PROVENANCE_KINDS = (PROVENANCE_ENACTING, PROVENANCE_DOCUMENTARY)

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ZIP5 = re.compile(r"^\d{5}$")

Override = namedtuple(
    "Override",
    "state vintage enacted_date legal_status provenance_url geometry_source "
    "provenance_kind notes")
#: Defaults are the conservative reading: an unstated provenance tier is the
#: weaker one, so a row can only ever understate what we can prove.
Override.__new__.__defaults__ = (PROVENANCE_DOCUMENTARY, "")


def load_overrides(path=OVERRIDES_CSV):
    """reference/district_overrides.csv -> {STATE: Override}.

    Committed and diffable rather than derived, like reference/sectors.csv:
    which map a state is under on a given date is a human research finding,
    not something any file Census publishes will tell us.

    Raises ValueError on a malformed row. This is hand-maintained data whose
    fields are rendered directly to visitors, so a typo has to stop the build
    rather than reach the UI as an unexplained string.
    """
    if not os.path.exists(path):
        return {}
    out = {}
    with open(path, newline="") as fh:
        rows = (line for line in fh if not line.lstrip().startswith("#"))
        for row in csv.DictReader(rows):
            state = (row.get("state") or "").strip().upper()
            if not state:
                continue
            ov = Override(
                state=state,
                vintage=(row.get("vintage") or "").strip(),
                enacted_date=(row.get("enacted_date") or "").strip(),
                legal_status=(row.get("legal_status") or "").strip(),
                provenance_url=(row.get("provenance_url") or "").strip(),
                geometry_source=(row.get("geometry_source") or "").strip(),
                provenance_kind=((row.get("provenance_kind") or "").strip()
                                 or PROVENANCE_DOCUMENTARY),
                notes=(row.get("notes") or "").strip(),
            )
            _validate(ov)
            out[state] = ov
    return out


def _validate(ov):
    if ov.legal_status not in LEGAL_STATUSES:
        raise ValueError(
            f"{ov.state}: legal_status {ov.legal_status!r} is not one of "
            f"{LEGAL_STATUSES}")
    if not _ISO_DATE.match(ov.enacted_date):
        raise ValueError(
            f"{ov.state}: enacted_date {ov.enacted_date!r} is not YYYY-MM-DD")
    if not ov.provenance_url.startswith(("http://", "https://")):
        raise ValueError(
            f"{ov.state}: provenance_url {ov.provenance_url!r} is missing or "
            "not a URL — an override we cannot cite is an assertion")
    if not ov.vintage:
        raise ValueError(f"{ov.state}: vintage is required")
    if ov.provenance_kind not in PROVENANCE_KINDS:
        raise ValueError(
            f"{ov.state}: provenance_kind {ov.provenance_kind!r} is not one "
            f"of {PROVENANCE_KINDS}")


def map_status(state, overrides):
    """What to tell a visitor about the districts drawn for this state.

    Legal status decides what is operative, never what geometry we happen to
    hold: a blocked map's shapefile sitting on disk must not cause us to draw
    a map that is not the law.
    """
    ov = overrides.get((state or "").upper())
    if ov is None:
        return MAP_CURRENT
    if ov.legal_status != STATUS_IN_EFFECT:
        return MAP_CONTESTED
    return MAP_OVERRIDE_APPLIED if ov.geometry_source else MAP_SUPERSEDED


def zip3_of(zip5):
    """First three digits, or None if this is not a 5-digit ZIP.

    Slicing, never arithmetic: int('01001') is 1001, a different ZIP in a
    different state.
    """
    zip5 = (zip5 or "").strip()
    return zip5[:3] if _ZIP5.match(zip5) else None


def resolve_zip(zip5, exact, prefix):
    """(districts, how) for a 5-digit ZIP.

    `exact` is {zip5: [district_geoid]} from the ZCTA intersection; `prefix`
    is {zip3: [district_geoid]} built from those same rows. The prefix answer
    is deliberately wider than the truth — it names every district the ZIP's
    neighbourhood touches — which is why it is labelled and never merged with
    an exact one.
    """
    zip5 = (zip5 or "").strip()
    if not _ZIP5.match(zip5):
        return [], RESOLVED_NONE
    if zip5 in exact:
        return exact[zip5], RESOLVED_ZCTA
    z3 = zip3_of(zip5)
    if z3 in prefix:
        return prefix[z3], RESOLVED_ZIP3
    return [], RESOLVED_NONE


def sourcing_gaps(overrides):
    """What Phase 3 still owes, as data rather than a comment.

    `geometry` is the gap that changes what a visitor sees: a map that is in
    effect and that we cannot draw, so those districts render stale. `blocked`
    and `in_litigation` states are absent from it by design — cd119 is the
    operative map there and there is nothing to draw.

    `provenance` is every row still resting on a secondary account. Neither
    list failing the build is deliberate: this is tracked work, not a defect,
    and a gate that fails on every run until all fifty states are perfect is a
    gate nobody reads.
    """
    geometry, provenance = [], []
    for state in sorted(overrides):
        ov = overrides[state]
        if ov.legal_status == STATUS_IN_EFFECT and not ov.geometry_source:
            geometry.append(state)
        if ov.provenance_kind != PROVENANCE_ENACTING:
            provenance.append(state)
    return {"geometry": geometry, "provenance": provenance}


#: STATEFP -> USPS. cb_2025_us_cd119 names states by FIPS only, while the
#: override registry is keyed by the postal code a human would type. Written
#: out rather than downloaded: these codes have not changed since 1970 and a
#: 56-row constant is a smaller liability than another shapefile. Keys are
#: strings with their leading zero, because FIPS is VARCHAR everywhere else
#: in this pipeline for exactly the reason ZIPs are.
STATE_FIPS_USPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
    "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
    "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
    "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
    "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
    "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
    "54": "WV", "55": "WI", "56": "WY",
    # Non-voting delegations, present in the shapefile and therefore in the
    # join. They elect delegates, not representatives, and no 2025-26 redraw
    # touches them — but dropping them would silently lose their districts.
    "60": "AS", "66": "GU", "69": "MP", "72": "PR", "78": "VI",
}


def usps_of(statefp):
    """STATEFP -> USPS code, or None. Exact string match, never padded here:
    a caller holding '6' has already lost the leading zero somewhere upstream
    and should find out rather than be quietly rescued."""
    return STATE_FIPS_USPS.get(statefp)
