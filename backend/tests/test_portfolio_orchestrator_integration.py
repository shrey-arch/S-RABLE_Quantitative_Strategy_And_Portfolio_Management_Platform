from decimal import Decimal

import pytest

from app.services.portfolio.orchestrator import PortfolioOrchestrator
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


def test_build_rebalance_generates_buy_proposal():
    plan = PortfolioOrchestrator.build_rebalance(
        [momentum()],
        cash="1000.00",
        holdings={},
        prices={"AAA": "10.00"},
    )

    assert plan.current_state.total_equity == Decimal("1000.00")
    assert plan.target.target_values() == {"AAA": Decimal("1000.00")}
    assert len(plan.rebalancing.trades) == 1
    assert plan.rebalancing.trades[0].side == "BUY"
    assert plan.rebalancing.trades[0].quantity == 100
    assert plan.rebalancing.ending_cash == Decimal("0.00")


def test_build_rebalance_proposes_no_trade_for_already_targeted_holding():
    plan = PortfolioOrchestrator.build_rebalance(
        [momentum()],
        cash="0.00",
        holdings={"AAA": (100, "10.00")},
        prices={"AAA": "10.00"},
    )

    assert plan.rebalancing.trades == ()
    assert plan.rebalancing.ending_cash == Decimal("0.00")


def test_build_rebalance_respects_cash_reserve():
    from app.services.portfolio.risk_service import PortfolioRiskLimits

    plan = PortfolioOrchestrator.build_rebalance(
        [momentum()],
        cash="1000.00",
        holdings={},
        prices={"AAA": "10.00"},
        limits=PortfolioRiskLimits(cash_reserve=Decimal("200.00")),
    )

    assert plan.target.invested_capital == Decimal("800.00")
    assert plan.rebalancing.trades[0].quantity == 80
    assert plan.rebalancing.ending_cash == Decimal("200.00")


def test_build_rebalance_rejects_missing_target_price():
    with pytest.raises(ValueError, match="Missing prices"):
        PortfolioOrchestrator.build_rebalance(
            [momentum()],
            cash="1000.00",
            holdings={},
            prices={},
        )

def test_build_rebalance_aggregates_shared_asset_targets():
    from app.services.portfolio.risk_service import PortfolioRiskLimits

    candidates = [
        momentum("AAA", 0.9),
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

    plan = PortfolioOrchestrator.build_rebalance(
        candidates,
        cash="1000.00",
        holdings={},
        prices={"AAA": "10.00"},
        limits=PortfolioRiskLimits(max_asset_weight=Decimal("0.40")),
    )

    assert plan.target.target_values()["AAA"] <= Decimal("400.00")
    assert plan.target.cash_reserve >= Decimal("600.00")
    assert sum(
        position.amount for position in plan.target.positions
    ) == plan.target.invested_capital


def test_build_rebalance_does_not_spend_reserved_cash():
    from app.services.portfolio.risk_service import PortfolioRiskLimits

    plan = PortfolioOrchestrator.build_rebalance(
        [momentum()],
        cash="100.00",
        holdings={},
        prices={"AAA": "10.00"},
        limits=PortfolioRiskLimits(cash_reserve=Decimal("50.00")),
    )

    assert plan.rebalancing.ending_cash >= Decimal("50.00")
