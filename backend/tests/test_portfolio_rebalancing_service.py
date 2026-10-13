from decimal import Decimal

import pytest

from app.services.portfolio.rebalancing_service import (
    PortfolioRebalancingService,
)


def test_proposes_buy_for_underweight_asset():
    result = PortfolioRebalancingService.propose(
        "500.00",
        {"AAA": (5, "10.00")},
        {"AAA": "100.00"},
        {"AAA": "10.00"},
    )

    assert [(t.asset, t.side, t.quantity) for t in result.trades] == [
        ("AAA", "BUY", 5)
    ]
    assert result.ending_cash == Decimal("450.00")


def test_proposes_sell_for_overweight_asset():
    result = PortfolioRebalancingService.propose(
        "0.00",
        {"AAA": (10, "10.00")},
        {"AAA": "50.00"},
        {"AAA": "10.00"},
    )

    assert [(t.asset, t.side, t.quantity) for t in result.trades] == [
        ("AAA", "SELL", 5)
    ]
    assert result.ending_cash == Decimal("50.00")


def test_unchanged_portfolio_produces_no_trades():
    result = PortfolioRebalancingService.propose(
        "100.00",
        {"AAA": (10, "10.00")},
        {"AAA": "100.00"},
        {"AAA": "10.00"},
    )

    assert result.trades == ()
    assert result.ending_cash == Decimal("100.00")


def test_empty_portfolio_can_propose_buys():
    result = PortfolioRebalancingService.propose(
        "100.00",
        {},
        {"AAA": "80.00"},
        {"AAA": "10.00"},
    )

    assert len(result.trades) == 1
    assert result.trades[0].quantity == 8
    assert result.ending_cash == Decimal("20.00")


def test_does_not_spend_more_cash_than_available():
    result = PortfolioRebalancingService.propose(
        "25.00",
        {},
        {"AAA": "100.00"},
        {"AAA": "10.00"},
    )

    assert result.trades[0].quantity == 2
    assert result.ending_cash == Decimal("5.00")


def test_minimum_trade_threshold_avoids_small_changes():
    result = PortfolioRebalancingService.propose(
        "100.00",
        {"AAA": (10, "10.00")},
        {"AAA": "95.00"},
        {"AAA": "10.00"},
        minimum_trade_value="10.00",
    )

    assert result.trades == ()


def test_can_remove_an_asset_from_target():
    result = PortfolioRebalancingService.propose(
        "0.00",
        {"AAA": (5, "10.00")},
        {},
        {"AAA": "10.00"},
    )

    assert result.trades[0].side == "SELL"
    assert result.trades[0].quantity == 5


@pytest.mark.parametrize(
    "cash,holdings,targets,prices",
    [
        ("NaN", {}, {}, {}),
        ("100", {"AAA": (-1, "10")}, {}, {"AAA": "10"}),
        ("100", {}, {"AAA": "-1"}, {"AAA": "10"}),
        ("100", {}, {"AAA": "50"}, {}),
        ("100", {}, {"AAA": "50"}, {"AAA": "0"}),
    ],
)
def test_rejects_invalid_inputs(cash, holdings, targets, prices):
    with pytest.raises(ValueError):
        PortfolioRebalancingService.propose(
            cash, holdings, targets, prices
        )


def test_empty_targets_sell_existing_holdings():
    result = PortfolioRebalancingService.propose(
        "20.00",
        {"AAA": (2, "10.00")},
        {},
        {"AAA": "10.00"},
    )

    assert result.trades[0].side == "SELL"
    assert result.ending_cash == Decimal("40.00")
