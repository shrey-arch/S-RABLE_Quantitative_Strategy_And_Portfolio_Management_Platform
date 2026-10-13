from decimal import Decimal

import pytest

from app.services.portfolio.allocation_service import PortfolioAllocationService


def test_allocates_capital_proportionally():
    result = PortfolioAllocationService.allocate(
        Decimal("1000.00"),
        {"momentum": 1.0, "mean_reversion": 3.0},
    )

    amounts = {item.strategy: item.amount for item in result}
    assert amounts == {
        "mean_reversion": Decimal("750.00"),
        "momentum": Decimal("250.00"),
    }
    assert sum(amounts.values()) == Decimal("1000.00")


def test_allocations_are_sorted_deterministically():
    result = PortfolioAllocationService.allocate(
        "100.00",
        {"z_strategy": 1, "a_strategy": 1},
    )

    assert [item.strategy for item in result] == ["a_strategy", "z_strategy"]
    assert sum(item.amount for item in result) == Decimal("100.00")


def test_rounding_remainder_preserves_total_capital():
    result = PortfolioAllocationService.allocate(
        "100.00",
        {"a": 1, "b": 1, "c": 1},
    )

    assert sum(item.amount for item in result) == Decimal("100.00")
    assert [item.amount for item in result] == [
        Decimal("33.33"),
        Decimal("33.33"),
        Decimal("33.34"),
    ]


def test_zero_score_receives_zero_capital():
    result = PortfolioAllocationService.allocate(
        "100.00",
        {"active": 1, "inactive": 0},
    )

    amounts = {item.strategy: item.amount for item in result}
    assert amounts["active"] == Decimal("100.00")
    assert amounts["inactive"] == Decimal("0.00")


@pytest.mark.parametrize("capital", [0, -1, True, "invalid", "NaN", "Infinity"])
def test_rejects_invalid_capital(capital):
    with pytest.raises(ValueError):
        PortfolioAllocationService.allocate(capital, {"momentum": 1})


@pytest.mark.parametrize(
    "scores",
    [
        {},
        {"momentum": -1},
        {"momentum": float("nan")},
        {"momentum": float("inf")},
        {"momentum": True},
        {"momentum": 0, "mean_reversion": 0},
        {"": 1},
    ],
)
def test_rejects_invalid_scores(scores):
    with pytest.raises(ValueError):
        PortfolioAllocationService.allocate("100.00", scores)


def test_rejects_non_mapping_scores():
    with pytest.raises(ValueError):
        PortfolioAllocationService.allocate("100.00", [("momentum", 1)])


def test_does_not_modify_input_scores():
    scores = {"momentum": 1, "mean_reversion": 2}
    original = scores.copy()

    PortfolioAllocationService.allocate("100.00", scores)

    assert scores == original
