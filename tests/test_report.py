"""Unit tests for the shared report helper.

Named for the reason each rule exists, not for the function under test: the
point of a test name is to say what breaks in the world if it fails.
"""

import decimal

import _report


def test_negative_money_keeps_its_sign():
    """FEC amounts are genuinely negative — refunds. A formatter that dropped
    the sign would render HALEY's -$1,129,532 as a positive contribution."""
    assert _report.fmt_money(-1129532) == "-$1,129,532"
    assert _report.fmt_money(514269264) == "$514,269,264"


def test_money_accepts_decimal_without_float_drift():
    """TRANSACTION_AMT is DECIMAL(14,2); DuckDB hands back decimal.Decimal.
    Routing that through float() would reintroduce the drift the column type
    exists to prevent."""
    assert _report.fmt_money(decimal.Decimal("1234.56")) == "$1,235"


def test_missing_values_render_as_a_dash_not_none():
    """A report that prints the literal string 'None' in a table reads as a
    bug to anyone reviewing the stage output."""
    assert _report.fmt_int(None) == "—"
    assert _report.fmt_money(None) == "—"
    assert _report.fmt_pct(None) == "—"
    assert "| — |" in _report.markdown_table(["a"], [(None,)])


def test_a_report_with_no_checks_fails(tmp_path):
    """A stage that cannot fail is not a gate. Registering no acceptance
    checks must not be indistinguishable from passing."""
    r = _report.Report("_t_none", "t")
    assert r.passed is True          # vacuously true over an empty set...
    assert r.write(tmp_path) == 1            # ...but the exit code must still be 1.


def test_one_failed_check_fails_the_stage(tmp_path):
    """Stages exit nonzero on acceptance failure; that is what makes the
    pipeline's numeric order meaningful."""
    r = _report.Report("_t_mixed", "t")
    r.check("ok", True).check("bad", False, "detail")
    assert r.write(tmp_path) == 1


def test_all_checks_passing_exits_zero(tmp_path):
    r = _report.Report("_t_ok", "t")
    r.check("ok", True, "detail")
    assert r.write(tmp_path) == 0


def test_table_renders_a_header_separator():
    """Without the separator row GitHub renders the table as a paragraph of
    pipes, which has happened and is easy to miss in a generated file."""
    out = _report.markdown_table(["a", "b"], [(1, 2)])
    assert out.splitlines()[1] == "|---|---|"
