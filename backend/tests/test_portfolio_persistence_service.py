from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import MagicMock

import pytest

from app.models import Portfolio
from app.services.portfolio.portfolio_persistence_service import (
    PortfolioPersistenceService,
)
from app.services.portfolio.portfolio_state import PortfolioStateService


def make_portfolio(user_id=None, holdings=None):
    return SimpleNamespace(
        id=uuid4(),
        user_id=user_id or uuid4(),
        cash_balance=Decimal("1000.00"),
        holdings=list(holdings or []),
    )


def make_holding(asset, quantity, average_price, current_price):
    return SimpleNamespace(
        asset=asset,
        quantity=quantity,
        average_price=Decimal(str(average_price)),
        current_price=Decimal(str(current_price)),
    )


def make_db(portfolio):
    db = MagicMock()
    db.scalar.return_value = portfolio
    return db


def test_load_returns_persisted_cash_and_holdings():
    user_id = uuid4()
    portfolio = make_portfolio(
        user_id=user_id,
        holdings=[
            make_holding("AAA", 5, "18.00", "20.00"),
            make_holding("BBB", 2, "24.00", "25.00"),
        ],
    )
    db = make_db(portfolio)

    state = PortfolioPersistenceService.load(
        db, portfolio.id, user_id
    )

    assert state.cash == Decimal("1000.00")
    assert state.invested_value == Decimal("150.00")
    assert state.total_equity == Decimal("1150.00")
    assert {h.asset: h.quantity for h in state.holdings} == {
        "AAA": 5,
        "BBB": 2,
    }


def test_load_hides_missing_or_foreign_portfolios():
    db = make_db(None)

    with pytest.raises(ValueError, match="Portfolio not found"):
        PortfolioPersistenceService.load(
            db, uuid4(), uuid4()
        )


def test_save_updates_cash_and_existing_holding():
    user_id = uuid4()
    holding = make_holding("AAA", 2, "15.00", "18.00")
    portfolio = make_portfolio(user_id, [holding])
    db = make_db(portfolio)

    state = PortfolioStateService.create(
        "500.00", {"AAA": (4, "22.00")}
    )

    saved = PortfolioPersistenceService.save(
        db, portfolio.id, user_id, state
    )

    assert portfolio.cash_balance == Decimal("500.00")
    assert holding.quantity == 4
    assert holding.current_price == Decimal("22.00")
    # Buying 2 more at 22.00 blends the average cost: (2 x 15 + 2 x 22) / 4.
    assert holding.average_price == Decimal("18.50")
    assert saved.cash == Decimal("500.00")
    db.commit.assert_called_once()


def test_save_adds_new_holding_and_removes_omitted_holding():
    user_id = uuid4()
    old_holding = make_holding("OLD", 3, "10.00", "11.00")
    portfolio = make_portfolio(user_id, [old_holding])
    db = make_db(portfolio)

    state = PortfolioStateService.create(
        "200.00", {"NEW": (2, "25.00")}
    )

    PortfolioPersistenceService.save(
        db, portfolio.id, user_id, state
    )

    assert [h.asset for h in portfolio.holdings] == ["NEW"]
    new_holding = portfolio.holdings[0]
    assert new_holding.quantity == 2
    assert new_holding.average_price == Decimal("25.00")
    assert new_holding.current_price == Decimal("25.00")
    db.commit.assert_called_once()


def test_save_rolls_back_when_commit_fails():
    user_id = uuid4()
    portfolio = make_portfolio(user_id)
    db = make_db(portfolio)
    db.commit.side_effect = RuntimeError("database failure")

    state = PortfolioStateService.create("500.00", {})

    with pytest.raises(RuntimeError, match="database failure"):
        PortfolioPersistenceService.save(
            db, portfolio.id, user_id, state
        )

    db.rollback.assert_called_once()
