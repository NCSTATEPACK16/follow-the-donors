"""Unit tests for the hygiene rules. No data required."""

import _hygiene


def test_independent_expenditures_are_not_contributions():
    """The single largest correctness risk in the dataset. In pas2 2024 the
    IE types total $4.5bn against $514M of actual contributions — folding them
    together overstates money given to candidates by 8.7x. These two sets must
    never intersect."""
    assert not (set(_hygiene.CONTRIBUTION_TYPES)
                & set(_hygiene.INDEPENDENT_EXPENDITURE_TYPES))


def test_coordinated_and_communication_costs_are_not_contributions():
    """24C is a coordinated party expenditure and 24F a communication cost.
    Neither is money the candidate received either."""
    assert not (set(_hygiene.CONTRIBUTION_TYPES)
                & set(_hygiene.OTHER_NON_RECEIPT_TYPES))


def test_contribution_types_are_exactly_24k_and_24z():
    """Pinned deliberately. Widening this set is the single easiest way to
    silently inflate every figure on the site, so it should require editing a
    test that says so."""
    assert set(_hygiene.CONTRIBUTION_TYPES) == {"24K", "24Z"}


def test_type_list_renders_as_sql_tuple():
    assert _hygiene._types(("24K", "24Z")) == "('24K', '24Z')"
