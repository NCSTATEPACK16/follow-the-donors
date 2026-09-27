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
    "provenance_kind notes district_field")
#: Defaults are the conservative reading: an unstated provenance tier is the
#: weaker one, so a row can only ever understate what we can prove.
Override.__new__.__defaults__ = (PROVENANCE_DOCUMENTARY, "", "")

#: The cycles whose election a 2025-26 redraw governs. An override's geometry
#: is drawn for these and no others: 2024 was contested on cd119, and drawing
#: 2024 money on a 2026 map would make a 2024 TX-35 and a 2026 TX-35 look like
#: one place when they are not (user decision, 2026-09-27).
OVERRIDE_CYCLES = (2026,)

#: What an override's district_field may be called. It is interpolated into
#: SQL as a quoted identifier, so it is held to a shape that cannot close one.
_FIELD = re.compile(r"^[A-Za-z_][A-Za-z0-9_ ]{0,62}$")


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
                district_field=(row.get("district_field") or "").strip(),
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
    if ov.geometry_source and ov.provenance_kind != PROVENANCE_ENACTING:
        raise ValueError(
            f"{ov.state}: geometry_source is set but provenance_kind is "
            f"{ov.provenance_kind!r} — only enacting_authority is good enough "
            "to DRAW a map from; documentary is good enough to SAY it moved")
    if ov.geometry_source and not _FIELD.match(ov.district_field):
        raise ValueError(
            f"{ov.state}: geometry_source is set, so district_field must name "
            f"the attribute holding the district number (got "
            f"{ov.district_field!r}). It is read off the file, never guessed")


def map_status(state, overrides, cycle=None):
    """What to tell a visitor about the districts drawn for this state.

    Legal status decides what is operative, never what geometry we happen to
    hold: a blocked map's shapefile sitting on disk must not cause us to draw
    a map that is not the law.

    `cycle` is the plate being drawn. A cycle outside OVERRIDE_CYCLES is drawn
    on cd119 whatever we hold, so an applied override reads as superseded
    there — exactly what that cycle said before overrides carried geometry.
    None means the governing cycle.
    """
    ov = overrides.get((state or "").upper())
    if ov is None:
        return MAP_CURRENT
    if ov.legal_status != STATUS_IN_EFFECT:
        return MAP_CONTESTED
    if not ov.geometry_source:
        return MAP_SUPERSEDED
    if cycle is not None and int(cycle) not in OVERRIDE_CYCLES:
        return MAP_SUPERSEDED
    return MAP_OVERRIDE_APPLIED


def draws_override(state, overrides, cycle):
    """Whether this cycle's plate draws the state's enacted geometry. Defined
    as map_status() so that the label and the pixels cannot disagree."""
    return map_status(state, overrides, cycle) == MAP_OVERRIDE_APPLIED


_AT_LARGE = re.compile(r"^(?:al|at[- ]?large)$", re.I)
_CD = re.compile(r"^(?:(?:congressional\s+)?district|cd)?\s*(\d{1,2})$", re.I)


def normalise_cd(raw):
    """A district number as a legislature typed it -> the two-character `cd`.

    "1", "01", 1, "District 1" and "CD 1" are all "01"; "0", "AL" and
    "At-Large" are "00". Strings and ints only, and no int() cast on the way:
    a float, a bool or anything the patterns do not read raises, because a
    guessed number puts money on the wrong seat and passes every count.
    """
    if isinstance(raw, bool) or not isinstance(raw, (int, str)):
        raise ValueError(f"district number {raw!r}: not a string or int")
    s = str(raw).strip()
    if _AT_LARGE.match(s):
        return "00"
    m = _CD.match(s)
    if not m:
        raise ValueError(f"district number {raw!r}: cannot read it")
    return m.group(1).zfill(2)


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


# --- the district layer, per cycle -------------------------------------------
#
# SQL, but here rather than in 05_districts: the swap is the rule the tests
# pin, and `05_districts` is not an importable module name.

def _q(path):
    """A path as a SQL string literal."""
    return "'" + str(path).replace("'", "''") + "'"


def _crs(con, path):
    """'AUTH:CODE' off a layer's own metadata, or None. Read, never assumed."""
    row = con.execute(f"""
        SELECT layers[1].geometry_fields[1].crs.auth_name,
               layers[1].geometry_fields[1].crs.auth_code
        FROM ST_Read_Meta({_q(path)})""").fetchone()
    return f"{row[0]}:{row[1]}" if row and row[0] and row[1] else None


def load_override_geometry(con, ov, statefp, path, cd_crs, expected):
    """The enacted map for one state, as `override_<ST>` in districts_raw's
    shape: one dissolved row per seat, `congress = 'override'`.

    Raises on anything that would draw a plausible wrong map: an unknown CRS,
    a seat count that differs from cd119's (apportionment is fixed until 2032,
    so that is the wrong file), or two different labels for one seat.
    """
    src_crs = _crs(con, path)
    if not src_crs or not cd_crs:
        raise ValueError(
            f"{ov.state}: cannot read the CRS of {path} ({src_crs}) or of "
            f"cd119 ({cd_crs}); not reprojecting on a guess")
    field = ov.district_field.replace('"', "")
    raws = [r for (r,) in con.execute(
        f'SELECT DISTINCT "{field}" FROM ST_Read({_q(path)})').fetchall()]
    by_cd = {}
    for raw in raws:
        by_cd.setdefault(normalise_cd(raw), []).append(raw)
    twice = {cd: r for cd, r in by_cd.items() if len(r) > 1}
    if twice:
        raise ValueError(
            f"{ov.state}: the enacted map numbers a seat twice under different "
            f"labels {twice} — the wrong field, or the wrong file")
    if len(by_cd) != expected:
        raise ValueError(
            f"{ov.state}: the enacted map has {len(by_cd)} districts, cd119 "
            f"has {expected}. Apportionment is fixed until 2032; this is the "
            "wrong file, not a new map")
    con.execute(f"CREATE OR REPLACE TEMP TABLE override_map_{ov.state} "
                "(raw VARCHAR, cd VARCHAR)")
    con.executemany(f"INSERT INTO override_map_{ov.state} VALUES (?, ?)",
                    [(str(raw), cd) for cd, rs in by_cd.items() for raw in rs])
    geom = "o.geom" if src_crs == cd_crs else \
        f"ST_Transform(o.geom, '{src_crs}', '{cd_crs}', always_xy := true)"
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE override_{ov.state} AS
        SELECT '{statefp}' AS statefp, m.cd, '{statefp}' || m.cd AS district_geoid,
               coalesce(any_value(c.district_name),
                        'Congressional District ' || m.cd) AS district_name,
               'override' AS congress,
               ST_Union_Agg({geom}) AS geom
        FROM ST_Read({_q(path)}) o
        JOIN override_map_{ov.state} m ON m.raw = CAST(o."{field}" AS VARCHAR)
        LEFT JOIN cd119_raw c ON c.district_geoid = '{statefp}' || m.cd
        GROUP BY m.cd
    """)
    return f"override_{ov.state}"


def build_districts(con, cd_source, overrides, cycles, override_files):
    """`districts_raw_<cycle>` and `districts_<cycle>` for every cycle, plus
    `districts_raw` / `districts` for the governing (latest) one.

    Every cycle starts from cd119. A state is swapped for its enacted map in
    exactly the cycles where draws_override() says so — the same rule that
    writes map_status, so a district can never be labelled override_applied
    and drawn from cd119, or the reverse. Legal status is never re-tested
    here. The registry is applied in Python for the same reason: a CASE
    expression duplicating map_status() is the second code path that lets a
    stale value leak through the one nobody updated.

    `override_files` is {USPS: local path to the enacted geometry}. Returns
    the set of STATEFPs with no USPS code.
    """
    con.execute(f"""
        CREATE OR REPLACE TABLE cd119_raw AS
        SELECT STATEFP AS statefp, CD119FP AS cd, GEOID AS district_geoid,
               NAMELSAD AS district_name, CAST(CDSESSN AS VARCHAR) AS congress,
               geom
        FROM ST_Read({_q(cd_source)})
    """)
    per_state = dict(con.execute(
        "SELECT statefp, count(*) FROM cd119_raw GROUP BY 1").fetchall())
    fips = {usps: fp for fp, usps in STATE_FIPS_USPS.items()}
    cd_crs = None
    loaded = {}
    unmapped = set()
    for cycle in cycles:
        raw = f"districts_raw_{cycle}"
        con.execute(f"CREATE OR REPLACE TABLE {raw} AS SELECT * FROM cd119_raw")
        for usps in sorted(overrides):
            if not draws_override(usps, overrides, cycle):
                continue
            ov = overrides[usps]
            path = override_files.get(usps)
            if not path:
                raise ValueError(
                    f"{usps}: override_applied for {cycle} but no enacted "
                    "geometry file was supplied; refusing to draw cd119 "
                    "under that label")
            statefp = fips[usps]
            if usps not in loaded:
                if cd_crs is None:
                    cd_crs = _crs(con, cd_source)
                loaded[usps] = load_override_geometry(
                    con, ov, statefp, path, cd_crs, per_state.get(statefp, 0))
            con.execute(f"DELETE FROM {raw} WHERE statefp = ?", [statefp])
            con.execute(f"INSERT INTO {raw} SELECT * FROM {loaded[usps]}")

        rows = []
        for statefp, geoid in con.execute(
                f"SELECT DISTINCT statefp, district_geoid FROM {raw}").fetchall():
            usps = usps_of(statefp)
            if usps is None:
                unmapped.add(statefp)
                continue
            ov = overrides.get(usps)
            rows.append((
                geoid, usps, map_status(usps, overrides, cycle),
                ov.vintage if ov else "cd119 (119th Congress, Census 2025)",
                ov.enacted_date if ov else None,
                ov.legal_status if ov else None,
                ov.provenance_url if ov else None,
                ov.provenance_kind if ov else None,
                ov.notes if ov else None,
            ))
        con.execute(f"""
            CREATE OR REPLACE TABLE district_vintage_{cycle} (
                district_geoid VARCHAR, state_usps VARCHAR, map_status VARCHAR,
                map_vintage VARCHAR, enacted_date VARCHAR, legal_status VARCHAR,
                provenance_url VARCHAR, provenance_kind VARCHAR, notes VARCHAR)
        """)
        if rows:
            con.executemany(
                f"INSERT INTO district_vintage_{cycle} VALUES (?,?,?,?,?,?,?,?,?)",
                rows)
        con.execute(f"""
            CREATE OR REPLACE TABLE districts_{cycle} AS
            SELECT r.statefp, r.cd, r.district_geoid, r.district_name, r.congress,
                   v.state_usps, v.map_status, v.map_vintage, v.enacted_date,
                   v.legal_status, v.provenance_url, v.provenance_kind, v.notes
            FROM {raw} r
            JOIN district_vintage_{cycle} v USING (district_geoid)
        """)

    # The unsuffixed names answer for the map that governs now: the ZIP
    # crosswalk ("which district is this ZIP in") is a question about today.
    gov = max(cycles)
    con.execute(f"CREATE OR REPLACE TABLE districts_raw AS SELECT * FROM districts_raw_{gov}")
    con.execute(f"CREATE OR REPLACE TABLE districts AS SELECT * FROM districts_{gov}")
    con.execute(f"CREATE OR REPLACE TABLE district_vintage AS "
                f"SELECT * FROM district_vintage_{gov}")
    return unmapped
