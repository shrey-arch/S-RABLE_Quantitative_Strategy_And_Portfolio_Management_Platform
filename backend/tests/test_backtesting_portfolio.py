from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.backtesting.portfolio import Portfolio
from app.enums import PositionStatus


def test_buy_creates_open_position():
    instrument_id = uuid4()
    portfolio = Portfolio(100000)

    portfolio.apply_trade(
        instrument_id=str(instrument_id),
        side="BUY",
        quantity=10,
        price=100,
    )

    position = portfolio.positions[str(instrument_id)]

    assert position["quantity"] == 10
    assert position["average_price"] == 100.0
    assert position["realized_pnl"] == 0.0
    assert portfolio.cash == 99000.0


def test_sell_closes_long_position():
    instrument_id = uuid4()
    portfolio = Portfolio(100000)

    portfolio.apply_trade(
        instrument_id=str(instrument_id),
        side="BUY",
        quantity=10,
        price=100,
    )

    portfolio.apply_trade(
        instrument_id=str(instrument_id),
        side="SELL",
        quantity=10,
        price=120,
    )

    position = portfolio.closed_positions[str(instrument_id)]

    assert position["quantity"] == 0
    assert position["average_price"] == 100.0
    assert position["realized_pnl"] == 200.0
    assert portfolio.realized_pnl == 200.0
    assert portfolio.cash == 100200.0


def test_insufficient_cash_is_rejected():
    instrument_id = uuid4()
    portfolio = Portfolio(1000)

    with pytest.raises(ValueError, match="Insufficient cash"):
        portfolio.apply_trade(
            instrument_id=str(instrument_id),
            side="BUY",
            quantity=20,
            price=100,
        )


def test_equity_value_includes_open_position():
    instrument_id = uuid4()
    portfolio = Portfolio(100000)

    portfolio.apply_trade(
        instrument_id=str(instrument_id),
        side="BUY",
        quantity=10,
        price=100,
    )

    value = portfolio.calculate_value(
        prices={
            str(instrument_id): 110,
        }
    )

    assert value == 100100.0

def test_short_position_can_be_opened_and_closed():
    instrument_id = uuid4()
    portfolio = Portfolio(100000)

    portfolio.apply_trade(
        instrument_id=str(instrument_id),
        side="SELL",
        quantity=10,
        price=100,
    )

    position = portfolio.positions[str(instrument_id)]

    assert position["quantity"] == -10
    assert position["average_price"] == 100.0
    assert portfolio.cash == 101000.0

    portfolio.apply_trade(
        instrument_id=str(instrument_id),
        side="BUY",
        quantity=10,
        price=80,
    )

    closed_position = portfolio.closed_positions[str(instrument_id)]

    assert closed_position["quantity"] == 0
    assert closed_position["average_price"] == 100.0
    assert closed_position["realized_pnl"] == 200.0
    assert portfolio.realized_pnl == 200.0
    assert portfolio.cash == 100200.0


def test_partial_close_tracks_realized_pnl_incrementally():
    instrument_id = str(uuid4())
    portfolio = Portfolio(100000)

    portfolio.apply_trade(
        instrument_id=instrument_id,
        side="BUY",
        quantity=10,
        price=100,
    )

    portfolio.apply_trade(
        instrument_id=instrument_id,
        side="SELL",
        quantity=4,
        price=120,
    )

    position = portfolio.positions[instrument_id]

    assert position["quantity"] == 6
    assert position["average_price"] == 100.0
    assert position["realized_pnl"] == 80.0
    assert portfolio.realized_pnl == 80.0

    portfolio.apply_trade(
        instrument_id=instrument_id,
        side="SELL",
        quantity=6,
        price=90,
    )

    closed_position = portfolio.closed_positions[instrument_id]

    assert closed_position["quantity"] == 0
    assert closed_position["realized_pnl"] == 20.0
    assert portfolio.realized_pnl == 20.0


def test_apply_trade_with_result_reports_opening_fill():
    portfolio = Portfolio(100000)
    instrument_id = str(uuid4())

    result = portfolio.apply_trade_with_result(
        instrument_id=instrument_id,
        side="BUY",
        quantity=10,
        price=100,
    )

    assert result.realized_pnl == 0.0
    assert result.closed_quantity == 0
    assert result.opened_quantity == 10


def test_apply_trade_with_result_reports_partial_close():
    portfolio = Portfolio(100000)
    instrument_id = str(uuid4())

    portfolio.apply_trade(
        instrument_id=instrument_id,
        side="BUY",
        quantity=10,
        price=100,
    )

    result = portfolio.apply_trade_with_result(
        instrument_id=instrument_id,
        side="SELL",
        quantity=4,
        price=120,
    )

    assert result.realized_pnl == 80.0
    assert result.closed_quantity == 4
    assert result.opened_quantity == 0
    assert portfolio.positions[instrument_id]["quantity"] == 6


def test_apply_trade_with_result_reports_reversal():
    portfolio = Portfolio(100000)
    instrument_id = str(uuid4())

    portfolio.apply_trade(
        instrument_id=instrument_id,
        side="BUY",
        quantity=5,
        price=100,
    )

    result = portfolio.apply_trade_with_result(
        instrument_id=instrument_id,
        side="SELL",
        quantity=8,
        price=110,
    )

    assert result.realized_pnl == 50.0
    assert result.closed_quantity == 5
    assert result.opened_quantity == 3
    assert portfolio.positions[instrument_id]["quantity"] == -3


def test_selling_again_while_short_adds_to_the_short():
    portfolio = Portfolio(initial_capital=10000)

    portfolio.apply_trade(instrument_id="X", side="SELL", quantity=1, price=100)
    portfolio.apply_trade(instrument_id="X", side="SELL", quantity=2, price=110)

    position = portfolio.positions["X"]
    assert position["quantity"] == -3
    assert position["average_price"] == pytest.approx((100 + 2 * 110) / 3)

    # Buying 1 back closes 1 of the 3, at the average entry price.
    result = portfolio.apply_trade_with_result(
        instrument_id="X", side="BUY", quantity=1, price=90
    )
    assert result.closed_quantity == 1
    assert result.opened_quantity == 0
    assert portfolio.positions["X"]["quantity"] == -2
    assert result.realized_pnl == pytest.approx((100 + 2 * 110) / 3 - 90)
