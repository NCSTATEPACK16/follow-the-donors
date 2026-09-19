"""Export the shared prototype dataset.

The riso prototypes are evaluated against REAL districts, REAL money and REAL
map_status — an aesthetic judged on lorem-ipsum geometry is a judgement about
lorem ipsum. Output is WGS84 GeoJSON; projection happens in the browser so all
three prototypes share one file and differ only in ink.

Run:  .venv/bin/python web/prototypes/export_data.py
"""

import json
import os
import subprocess
import sys

import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "web", "prototypes", "data")
CYCLE = "2024"


def rewind_for_d3(path):
    """Reverse every ring, because d3-geo winds the opposite way to GeoJSON.

    RFC 7946 says an exterior ring is counterclockwise, and mapshaper emits
    exactly that. d3-geo is SPHERICAL and reads a counterclockwise ring as the
    complement — the whole sphere minus the polygon. Measured on TX-21 before
    the fix: d3.geoArea returned 12.5660 steradians against a whole sphere of
    12.5664, and the centroid came back at (81.1E, 30.0S), in the Indian Ocean.
    After reversing: 0.000404 sr, centroid (98.9W, 30.0N), central Texas.

    The symptom is not subtle but it IS misleading: the stroked outlines still
    draw correctly, so the map looks nearly right while every fill is the
    clip rectangle. Reversing all rings flips exteriors and holes together,
    which preserves their relative orientation.

    This matters only for d3-geo. Tippecanoe and MapLibre work in planar tile
    coordinates and are indifferent to winding, so stage 07 will not need it.
    """
    with open(path) as fh:
        gj = json.load(fh)
    n = 0
    for f in gj["features"]:
        geom = f["geometry"]
        polys = ([geom["coordinates"]] if geom["type"] == "Polygon"
                 else geom["coordinates"])
        for poly in polys:
            for ring in poly:
                ring.reverse()
                n += 1
    with open(path, "w") as fh:
        json.dump(gj, fh, separators=(",", ":"))
    print(f"rewind {n} rings reversed for d3-geo")


def main():
    os.makedirs(OUT, exist_ok=True)
    con = duckdb.connect(os.path.join(ROOT, "data", "fec.duckdb"), read_only=True)
    con.execute("INSTALL spatial; LOAD spatial;")

    # One feature per district. Money is integer cents for the same reason the
    # tiles carry cents (plan task 1): floats round differently between encoders.
    rows = con.execute(f"""
        SELECT d.district_geoid,
               t.state_usps, t.cd, t.district_name,
               t.map_status, t.map_vintage, t.legal_status,
               CAST(t.pac_dollars * 100 AS BIGINT) AS pac_cents,
               t.contributions, t.candidates, t.donor_committees,
               ST_AsGeoJSON(d.geom) AS gj
        FROM districts_raw d
        JOIN district_totals_{CYCLE} t USING (district_geoid)
        ORDER BY d.district_geoid
    """).fetchall()

    features = []
    for (geoid, st, cd, name, status, vintage, legal,
         cents, contribs, cands, donors, gj) in rows:
        features.append({
            "type": "Feature",
            "properties": {
                "geoid": geoid, "state": st, "cd": cd, "name": name,
                "map_status": status, "map_vintage": vintage,
                "legal_status": legal, "pac_cents": int(cents),
                "contributions": int(contribs), "candidates": int(cands),
                "donor_committees": int(donors),
            },
            "geometry": json.loads(gj),
        })

    raw = os.path.join(OUT, "_districts.raw.geojson")
    with open(raw, "w") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh)
    print(f"raw  {len(features)} features  {os.path.getsize(raw)/1e6:.1f} MB")

    # Shared-boundary simplification. Per-geometry ST_Simplify opens slivers
    # between neighbouring districts; mapshaper simplifies the shared arc once,
    # so contiguous borders stay contiguous. That matters here specifically:
    # a gap between two districts would read as misregistration, which in this
    # design system MEANS something.
    out = os.path.join(OUT, "districts-2024.geojson")
    subprocess.run([
        "npx", "--yes", "mapshaper@0.6.102", raw,
        "-simplify", "visvalingam", "weighted", "10%", "keep-shapes",
        "-clean",
        "-o", "precision=0.0001", "format=geojson", out,
    ], check=True, cwd=ROOT)
    print(f"simp {os.path.getsize(out)/1e6:.2f} MB")
    os.remove(raw)
    rewind_for_d3(out)

    # Sector breakdown, for the legend/sheet in each prototype.
    sect = con.execute(f"""
        SELECT district_geoid, sector, CAST(pac_dollars * 100 AS BIGINT)
        FROM district_sector_{CYCLE}
        WHERE pac_dollars > 0
        ORDER BY district_geoid, pac_dollars DESC
    """).fetchall()
    by_district = {}
    for geoid, sector, cents in sect:
        by_district.setdefault(geoid, []).append([sector, int(cents)])
    with open(os.path.join(OUT, "sectors-2024.json"), "w") as fh:
        json.dump(by_district, fh)
    print(f"sect {len(by_district)} districts")

    # National context, so a prototype can state the honesty numbers out loud
    # rather than hardcode them.
    tot, stale = con.execute(f"""
        SELECT SUM(pac_dollars),
               SUM(CASE WHEN map_status = 'cd119_superseded'
                        THEN pac_dollars ELSE 0 END)
        FROM district_totals_{CYCLE}
    """).fetchone()
    meta = {
        "cycle": CYCLE,
        "filing_period": "2023-01-01 through 2024-12-31 (FEC bulk pas2, as filed)",
        "district_dollars": float(tot),
        "superseded_dollars": float(stale),
        "superseded_share": float(stale) / float(tot),
        "status_counts": dict(con.execute(f"""
            SELECT map_status, COUNT(*) FROM district_totals_{CYCLE} GROUP BY 1
        """).fetchall()),
    }
    with open(os.path.join(OUT, "meta-2024.json"), "w") as fh:
        json.dump(meta, fh, indent=2)
    print(f"meta {meta['superseded_share']:.2%} of dollars on a superseded map")


if __name__ == "__main__":
    sys.exit(main())
