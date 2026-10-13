from decimal import Decimal

import pytest

from app.services.portfolio.orchestrator import PortfolioOrchestrator
from app.services.portfolio.risk_service import PortfolioRiskLimits
from app.services.strategies.strategy_selection_service import StrategyCandidate


def momentum(asset="AAA", score=1.0):
    return StrategyCandidate(
        strategy="momentum",
        asset=asset,
        factors={
            "trend_strength": score,
            "relative_momentum": score,
            "volatility_suitability": 0.8,
        },
    )


def mean_reversion(asset="BBB"):
    return StrategyCandidate(
        strategy="mean_reversion",
        asset=asset,
        factors={
            "price_deviation": 0.5,
            "trend_suitability": 0.8,
            "volatility_suitability": 0.8,
        },
    )


def test_builds_target_portfolio_from_multiple_strategies():
    target = PortfolioOrchestrator.build_target(
        "1000.00",
        [momentum(), mean_reversion()],
    )

    assert len(target.positions) == 2
    assert target.invested_capital == Decimal("1000.00")
    assert sum(item.amount for item in target.positions) == Decimal("1000.00")


def test_applies_cash_reserve():
    target = PortfolioOrchestrator.build_target(
        "1000.00",
        [momentum(), mean_reversion()],
        limits=PortfolioRiskLimits(cash_reserve=Decimal("200.00")),
    )

    assert target.invested_capital <= Decimal("800.00")
    assert target.cash_reserve >= Decimal("200.00")


def test_selects_highest_scoring_candidate_per_strategy():
    target = PortfolioOrchestrator.build_target(
        "1000.00",
        [momentum("ZZZ", 0.2), momentum("AAA", 0.9)],
    )

    assert len(target.positions) == 1
    assert target.positions[0].asset == "AAA"


def test_applies_regime_filter():
    candidates = [
        StrategyCandidate(
            strategy="momentum",
            asset="AAA",
            factors={
                "trend_strength": 0.8,
                "relative_momentum": 0.8,
                "volatility_suitability": 0.8,
            },
            compatible_regimes=("bull",),
        ),
        StrategyCandidate(
            strategy="mean_reversion",
            asset="BBB",
            factors={
                "price_deviation": 0.5,
                "trend_suitability": 0.8,
                "volatility_suitability": 0.8,
            },
            compatible_regimes=("bear",),
        ),
    ]

    target = PortfolioOrchestrator.build_target(
        "1000.00",
        candidates,
        regime="bull",
    )

    assert [item.strategy for item in target.positions] == ["momentum"]


def test_rejects_no_eligible_opportunities():
    with pytest.raises(ValueError, match="No eligible"):
        PortfolioOrchestrator.build_target(
            "1000.00",
            [
                StrategyCandidate(
                    strategy="momentum",
                    factors={
                        "trend_strength": 0.8,
                        "relative_momentum": 0.8,
                        "volatility_suitability": 0.8,
                    },
                    compatible_regimes=("bull",),
                )
            ],
            regime="bear",
        )


def test_records_regime():
    target = PortfolioOrchestrator.build_target(
        "100.00",
        [momentum()],
        regime="bull",
    )

    assert target.regime == "bull"
