"""Shared report writing for pipeline stages.

follow-the-ppp grew eight stages that each hand-rolled their own markdown
assembly and their own PASS/FAIL tail, and the plan named that duplication as
a gap to fix here rather than copy. This is that fix.

Two things it deliberately does NOT do:

1. **It does not depend on pandas.** follow-the-ppp reached for
   `DataFrame.to_markdown()`, which drags in pandas and tabulate for what is
   string formatting. requirements.txt here is duckdb + boto3 + pytest, and
   keeping it that short is worth forty lines of table formatting.

2. **It does not decide what passes.** A stage registers checks with
   `report.check(...)`; `write()` renders them and returns the process exit
   code. The threshold and its consequence stay in the stage, next to the
   measurement that produced them.
"""

import decimal
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTS = os.path.join(REPO, "reports")


def fmt_int(n):
    return "—" if n is None else f"{int(n):,}"


def fmt_money(n):
    """Whole dollars with a sign. FEC amounts are genuinely negative
    sometimes — refunds — and a formatter that hides that would be lying."""
    if n is None:
        return "—"
    n = decimal.Decimal(n)
    return f"-${abs(n):,.0f}" if n < 0 else f"${n:,.0f}"


def fmt_pct(x, places=2):
    return "—" if x is None else f"{x * 100:.{places}f}%"


def markdown_table(headers, rows):
    """A GitHub-flavoured table. Cells are str()'d; None renders as an em dash.

    Column widths are not padded. Padding looks tidy in a diff of the script
    and makes no difference at all to the rendered page, but it does make
    every report a churny diff when one number gets wider.
    """
    out = ["| " + " | ".join(str(h) for h in headers) + " |",
           "|" + "|".join("---" for _ in headers) + "|"]
    for row in rows:
        out.append("| " + " | ".join(
            "—" if c is None else str(c) for c in row) + " |")
    return "\n".join(out)


class Report:
    """Accumulates a stage's markdown, then writes it and yields an exit code.

    Usage:

        report = Report("03_hygiene", "Stage 03 — hygiene and reconciliation")
        report.kv("Cycles", "2024, 2026")
        report.section("Transaction type mix")
        report.table(["type", "rows"], rows)
        report.check("aggregate tolerance", abs(diff) <= TOL,
                     f"{diff:.2%} against a {TOL:.1%} gate")
        return report.write()
    """

    def __init__(self, slug, title):
        self.slug = slug
        self.title = title
        self.body = []
        self.meta = []
        self.checks = []

    # ---- content ---------------------------------------------------------

    def kv(self, label, value):
        """A header-block fact. Rendered above the first section."""
        self.meta.append(f"{label}: {value}")
        return self

    def section(self, heading, level=2):
        self.body.append(f"\n{'#' * level} {heading}\n")
        return self

    def para(self, text):
        self.body.append(text.strip() + "\n")
        return self

    def table(self, headers, rows):
        self.body.append(markdown_table(headers, rows) + "\n")
        return self

    # ---- acceptance ------------------------------------------------------

    def check(self, name, ok, detail=""):
        """Register an acceptance check. Any failure makes write() return 1."""
        self.checks.append((name, bool(ok), detail))
        return self

    @property
    def passed(self):
        return all(ok for _, ok, _ in self.checks)

    # ---- output ----------------------------------------------------------

    def write(self, dirpath=REPORTS):
        """Write <dirpath>/<slug>.md. Returns 0 when every check passed, else 1.

        A stage with no checks at all returns 1: a stage that cannot fail is
        not a gate, and silently passing would be the worse failure mode.
        """
        parts = [f"# {self.title}", ""]
        if self.meta:
            parts += self.meta + [""]
        parts += self.body

        parts += ["\n## Acceptance\n"]
        if self.checks:
            parts.append(markdown_table(
                ["check", "result", "detail"],
                [(n, "PASS" if ok else "**FAIL**", d)
                 for n, ok, d in self.checks]))
            parts.append("")
            parts.append(f"Result: **{'PASS' if self.passed else 'FAIL'}**")
        else:
            parts.append("**No acceptance checks registered — treated as a "
                         "failure.** A stage that cannot fail is not a gate.")

        os.makedirs(dirpath, exist_ok=True)
        path = os.path.join(dirpath, f"{self.slug}.md")
        with open(path, "w") as fh:
            fh.write("\n".join(parts).rstrip() + "\n")

        for name, ok, detail in self.checks:
            print(f"  [{'PASS' if ok else 'FAIL'}] {name}"
                  + (f" — {detail}" if detail else ""))
        print(f"wrote {os.path.relpath(path, REPO)}")
        return 0 if (self.checks and self.passed) else 1
