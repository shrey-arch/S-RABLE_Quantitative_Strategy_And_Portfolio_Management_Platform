from decimal import Decimal

import pytest

from app.services.portfolio.portfolio_state import PortfolioStateService


def test_calculates_cash_holdings_and_total_equity():
    state = PortfolioStateService.create(
        "250.00",
        {"AAA": (5, "20.00"), "BBB": (2, "25.00")},
    )

    assert state.cash == Decimal("250.00")
    assert state.invested_value == Decimal("150.00")
    assert state.total_equity == Decimal("400.00")


def test_calculates_allocation_weights():
    state = PortfolioStateService.create(
        "200.00",
        {"AAA": (5, "20.00"), "BBB": (2, "25.00")},
    )

    assert state.allocation_weights() == {
        "AAA": Decimal("0.285714"),
        "BBB": Decimal("0.142857"),
    }


def test_returns_deterministically_sorted_holdings():
    state = PortfolioStateService.create(
        "100.00",
        {"ZZZ": (1, "10.00"), "AAA": (2, "5.00")},
    )

    assert [holding.asset for holding in state.holdings] == ["AAA", "ZZZ"]


def test_accepts_empty_holdings():
    state = PortfolioStateService.create("100.00", {})

    assert state.invested_value == Decimal("0.00")
    assert state.total_equity == Decimal("100.00")
    assert state.allocation_weights() == {}


@pytest.mark.parametrize("cash", [-1, True, "NaN", "invalid"])
def test_rejects_invalid_cash(cash):
    with pytest.raises(ValueError):
        PortfolioStateService.create(cash, {})


@pytest.mark.parametrize(
    "holdings",
    [
        {"AAA": (-1, "10.00")},
        {"AAA": (True, "10.00")},
        {"AAA": (1, "-10.00")},
        {"AAA": (1, "NaN")},
        {"": (1, "10.00")},
        {"AAA": [1, "10.00"]},
    ],
)
def test_rejects_invalid_holdings(holdings):
    with pytest.raises(ValueError):
        PortfolioStateService.create("100.00", holdings)


def test_rejects_zero_price_for_positive_quantity():
    with pytest.raises(ValueError, match="positive price"):
        PortfolioStateService.create("100.00", {"AAA": (1, "0")})
