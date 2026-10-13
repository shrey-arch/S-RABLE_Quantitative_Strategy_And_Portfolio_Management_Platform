from decimal import Decimal

import pytest

from app.services.portfolio.risk_service import (
    PortfolioRiskLimits,
    PortfolioRiskService,
)


def test_preserves_cash_reserve():
    result = PortfolioRiskService.constrain(
        "1000.00",
        {"momentum": "700.00", "mean_reversion": "300.00"},
        PortfolioRiskLimits(cash_reserve=Decimal("200.00")),
    )

    assert result.invested_capital == Decimal("800.00")
    assert result.cash_reserve == Decimal("200.00")


def test_caps_strategy_allocation():
    result = PortfolioRiskService.constrain(
        "1000.00",
        {"momentum": "900.00", "mean_reversion": "100.00"},
        PortfolioRiskLimits(max_strategy_weight=Decimal("0.50")),
    )

    assert {item.strategy: item.amount for item in result.allocations} == {
        "mean_reversion": Decimal("100.00"),
        "momentum": Decimal("500.00"),
    }


def test_scales_allocations_to_available_capital():
    result = PortfolioRiskService.constrain(
        "1000.00",
        {"a": "800.00", "b": "800.00"},
    )

    assert result.invested_capital == Decimal("1000.00")
    assert sum(item.amount for item in result.allocations) == Decimal("1000.00")


def test_applies_maximum_invested_capital():
    result = PortfolioRiskService.constrain(
        "1000.00",
        {"a": "600.00", "b": "400.00"},
        PortfolioRiskLimits(max_invested_capital=Decimal("500.00")),
    )

    assert result.invested_capital == Decimal("500.00")
    assert result.cash_reserve == Decimal("500.00")


def test_returns_deterministic_sorted_allocations():
    result = PortfolioRiskService.constrain(
        "100.00",
        {"z": "20.00", "a": "30.00"},
    )

    assert [item.strategy for item in result.allocations] == ["a", "z"]


@pytest.mark.parametrize("capital", [0, -1, True, "NaN", "invalid"])
def test_rejects_invalid_capital(capital):
    with pytest.raises(ValueError):
        PortfolioRiskService.constrain(capital, {"a": 10})


@pytest.mark.parametrize(
    "limits",
    [
        PortfolioRiskLimits(cash_reserve=Decimal("101")),
        PortfolioRiskLimits(max_strategy_weight=Decimal("1.1")),
        PortfolioRiskLimits(max_asset_weight=Decimal("-0.1")),
        PortfolioRiskLimits(max_invested_capital=Decimal("-1")),
    ],
)
def test_rejects_invalid_limits(limits):
    with pytest.raises(ValueError):
        PortfolioRiskService.constrain("100.00", {"a": "10.00"}, limits)


@pytest.mark.parametrize(
    "allocations",
    [{}, {"a": -1}, {"a": "NaN"}, {"": 10}, {"a": True}],
)
def test_rejects_invalid_allocations(allocations):
    with pytest.raises(ValueError):
        PortfolioRiskService.constrain("100.00", allocations)


def test_rejects_empty_allocation_input():
    with pytest.raises(ValueError):
        PortfolioRiskService.constrain("100.00", {})


def test_reserve_equal_to_capital_leaves_no_investable_cash():
    result = PortfolioRiskService.constrain(
        "100.00",
        {"a": "50.00"},
        PortfolioRiskLimits(cash_reserve=Decimal("100.00")),
    )

    assert result.invested_capital == Decimal("0.00")
    assert result.cash_reserve == Decimal("100.00")

def test_caps_combined_exposure_for_strategies_sharing_an_asset():
    result = PortfolioRiskService.constrain(
        "1000.00",
        {"momentum": "400.00", "mean_reversion": "400.00"},
        PortfolioRiskLimits(max_asset_weight=Decimal("0.50")),
        strategy_assets={
            "momentum": "AAA",
            "mean_reversion": "AAA",
        },
    )

    amounts = {item.strategy: item.amount for item in result.allocations}
    assert sum(amounts.values()) == Decimal("500.00")
    assert all(amount <= Decimal("500.00") for amount in amounts.values())
    assert result.invested_capital == Decimal("500.00")
    assert result.cash_reserve == Decimal("500.00")


def test_asset_cap_preserves_cash_reserve():
    result = PortfolioRiskService.constrain(
        "1000.00",
        {"momentum": "700.00", "mean_reversion": "300.00"},
        PortfolioRiskLimits(
            cash_reserve=Decimal("200.00"),
            max_asset_weight=Decimal("0.40"),
        ),
        strategy_assets={
            "momentum": "AAA",
            "mean_reversion": "BBB",
        },
    )

    assert result.invested_capital <= Decimal("800.00")
    assert result.cash_reserve >= Decimal("200.00")
    assert result.cash_reserve == (
        Decimal("1000.00") - result.invested_capital
    )


def test_asset_cap_is_applied_to_orchestrated_target():
    from app.services.portfolio.orchestrator import PortfolioOrchestrator
    from app.services.strategies.strategy_selection_service import StrategyCandidate

    candidates = [
        StrategyCandidate(
            strategy="momentum",
            asset="AAA",
            factors={
                "trend_strength": 0.9,
                "relative_momentum": 0.9,
                "volatility_suitability": 0.8,
            },
        ),
        StrategyCandidate(
            strategy="mean_reversion",
            asset="AAA",
            factors={
                "price_deviation": 0.8,
                "trend_suitability": 0.8,
                "volatility_suitability": 0.8,
            },
        ),
    ]

    target = PortfolioOrchestrator.build_target(
        "1000.00",
        candidates,
        limits=PortfolioRiskLimits(max_asset_weight=Decimal("0.40")),
    )

    assert target.target_values()["AAA"] <= Decimal("400.00")
    assert target.cash_reserve >= Decimal("600.00")
