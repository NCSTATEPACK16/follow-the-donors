"""Shared DuckDB connection, paths, and the cycle list.

Stages 02 onward all read and write one persistent database,
`data/fec.duckdb`, each stage CREATE OR REPLACE-ing its own tables and reading
its predecessor's. The alternative — every stage re-parsing the raw .txt —
would duplicate the explicit VARCHAR typing contract in three places, and that
contract is precisely where a ZIP with a leading zero quietly becomes an int.
So the typing is asserted once, in 02_normalize.py, and everything downstream
inherits it.

`CYCLES` lives here rather than in 01_fetch.py so that adding 2028 is a
one-line change in one file, which is what "cycle-parameterised from day one"
was supposed to buy.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data")
FEC = os.path.join(DATA, "raw", "fec")
HEADERS_DIR = os.path.join(FEC, "headers")
MANIFEST_PATH = os.path.join(FEC, "MANIFEST.json")
DB_PATH = os.path.join(DATA, "fec.duckdb")
REFERENCE = os.path.join(REPO, "reference")

#: The single place an election cycle is named. Everything downstream loops
#: over this and carries the value in a `cycle` VARCHAR column.
CYCLES = (2024, 2026)

#: 2024 is a closed cycle with a complete weball, so it hard-gates. 2026 is a
#: mid-cycle snapshot: totals are partial and small, which makes percentage
#: tolerances behave badly on tiny denominators. It computes the identical
#: numbers into the report and never fails the build. Promote it to a hard
#: gate once its own thresholds have been measured and ratcheted.
GATE_CYCLES = (2024,)


def raw_path(cycle, filename):
    """data/raw/fec/<cycle>/<filename>."""
    return os.path.join(FEC, str(cycle), filename)


def header_path(name):
    """FEC's published header CSV for a bulk file, as fetched by 01_fetch."""
    return os.path.join(HEADERS_DIR, f"{name}_header_file.csv")


def read_header_columns(name):
    """The published column list for a bulk file, in order.

    The bulk .txt files are pipe-delimited with NO header row — the header is
    a separate CSV that has to be joined in. This is the schema contract
    02_normalize.py gates against.
    """
    with open(header_path(name)) as fh:
        return [c.strip() for c in fh.read().strip().split(",")]


def connect(path=DB_PATH, read_only=False):
    """Open the pipeline database with the tuning follow-the-ppp settled on.

    `preserve_insertion_order=false` is the one that matters: it lets DuckDB
    stream a large CSV scan instead of buffering to keep row order nobody
    needs. The memory limit is deliberately below machine RAM so DuckDB spills
    to temp_directory rather than being OOM-killed — the PAC core is 703K rows
    and will never come near it, but the individual-contribution path is 58M.
    """
    import duckdb

    os.makedirs(DATA, exist_ok=True)
    os.makedirs(os.path.join(DATA, "tmp"), exist_ok=True)
    con = duckdb.connect(path, read_only=read_only)
    if not read_only:
        con.execute(f"PRAGMA temp_directory='{os.path.join(DATA, 'tmp')}'")
        con.execute("SET preserve_insertion_order=false")
        con.execute("SET memory_limit='8GB'")
    return con


def table_exists(con, name):
    return con.execute(
        "SELECT count(*) FROM duckdb_tables() WHERE table_name = ?",
        [name],
    ).fetchone()[0] > 0


def scalar(con, sql, params=None):
    """First column of the first row, or None when there are no rows."""
    row = con.execute(sql, params or []).fetchone()
    return None if row is None else row[0]
