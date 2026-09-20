"""Rules for attributing PAC money to a congressional district.

The base map is PAC dollars flowing IN to each district's representative, so
the question every row has to answer is "which district, if any?". Two things
make that harder than a join:

1. **Office.** FEC stores a Senate candidate's district as '00' — the same
   value an at-large House seat uses. Aggregating without filtering on office
   pours statewide Senate money into whichever single House district shares
   the code. Statewide and national money is not district money and gets no
   district here at all.

2. **Two encodings of a delegate seat.** FEC numbers the non-voting
   delegations 00; Census numbers them 98. Measured on the 2024 cycle,
   leaving that unmapped stranded $761,890 of the $954,234 that failed to
   join — most of the miss, across six jurisdictions.

What remains unmatched after both rules is candidates carrying a district
from a map that no longer exists (CA-53, PA-18, MT-00 before Montana regained
a second seat) — historical registrations still in cn.txt. That residue is
$192,344 of $421.8M, 0.046%, and it is measured and gated rather than
absorbed.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _districts import MAP_SUPERSEDED, STATE_FIPS_USPS

#: Only House candidates sit in a district. 'S' is statewide and 'P' national.
HOUSE = "H"

#: Census numbers the non-voting delegate seats 98; FEC numbers them 00.
#: Applied only to the 00 placeholder — MP has appeared with a real 01, and
#: rewriting that would invent a seat.
DELEGATE_CD = "98"
DELEGATIONS = frozenset({"AS", "DC", "GU", "MP", "PR", "VI"})

_USPS_FIPS = {usps: fips for fips, usps in STATE_FIPS_USPS.items()}


def district_key(office, state_usps, district):
    """(STATEFP, CD) for a candidate, or None when they sit in no district.

    None is a real answer, not a failure: Senate and presidential money is
    statewide and national, and saying so is the only way it stays out of the
    district choropleth.
    """
    if office != HOUSE:
        return None
    state = (state_usps or "").strip().upper()
    cd = (district or "").strip()
    if not state or not cd:
        return None
    statefp = _USPS_FIPS.get(state)
    if statefp is None:
        return None
    if state in DELEGATIONS and cd == "00":
        cd = DELEGATE_CD
    return statefp, cd


def district_geoid(office, state_usps, district):
    """STATEFP || CD, the key Census uses, or None.

    String concatenation, never arithmetic: '06' + '03' is California 3, and
    any integer round-trip on either half yields 603.
    """
    key = district_key(office, state_usps, district)
    return None if key is None else key[0] + key[1]


def comparable_across_cycles(map_status):
    """Can this district's 2024 and 2026 totals be put side by side?

    Only where the boundaries did not move. A superseded district is drawn on
    cd119 while its state votes on different lines, so the 2024 and 2026
    figures describe different places and charting them as a trend would be a
    false statement drawn as a line. A contested one is comparable: the
    redraw was blocked, so cd119 governed both cycles.
    """
    return map_status != MAP_SUPERSEDED
