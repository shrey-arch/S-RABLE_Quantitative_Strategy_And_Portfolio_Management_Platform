from datetime import datetime, timezone

import pytest

from app.backtesting.broker import SimulatedBroker


def test_market_buy_without_slippage():
    broker = SimulatedBroker()

    fill = broker.execute_market_order(
        side="BUY",
        quantity=10,
        market_price=100.0,
        timestamp=datetime.now(timezone.utc),
    )

    assert fill.quantity == 10
    assert fill.price == 100.0
    assert fill.brokerage == 0.0
    assert fill.total_charges == 0.0


def test_market_order_applies_slippage():
    broker = SimulatedBroker(slippage_bps=10.0)

    timestamp = datetime.now(timezone.utc)

    buy_fill = broker.execute_market_order(
        side="BUY",
        quantity=10,
        market_price=100.0,
        timestamp=timestamp,
    )

    sell_fill = broker.execute_market_order(
        side="SELL",
        quantity=10,
        market_price=100.0,
        timestamp=timestamp,
    )

    assert buy_fill.price == pytest.approx(100.1)
    assert sell_fill.price == pytest.approx(99.9)


def test_market_order_applies_brokerage():
    broker = SimulatedBroker(brokerage_rate=0.001)

    fill = broker.execute_market_order(
        side="BUY",
        quantity=10,
        market_price=100.0,
        timestamp=datetime.now(timezone.utc),
    )

    assert fill.price == 100.0
    assert fill.brokerage == pytest.approx(1.0)
    assert fill.total_charges == pytest.approx(1.0)


def test_market_order_rejects_invalid_inputs():
    broker = SimulatedBroker()
    timestamp = datetime.now(timezone.utc)

    with pytest.raises(ValueError):
        broker.execute_market_order(
            side="BUY",
            quantity=0,
            market_price=100.0,
            timestamp=timestamp,
        )

    with pytest.raises(ValueError):
        broker.execute_market_order(
            side="BUY",
            quantity=10,
            market_price=0.0,
            timestamp=timestamp,
        )

    with pytest.raises(ValueError):
        broker.execute_market_order(
            side="INVALID",
            quantity=10,
            market_price=100.0,
            timestamp=timestamp,
        )


def test_limit_order_uses_limit_price():
    broker = SimulatedBroker(brokerage_rate=0.001)

    fill = broker.execute_limit_order(
        side="BUY",
        quantity=10,
        limit_price=95.0,
        timestamp=datetime.now(timezone.utc),
    )

    assert fill.quantity == 10
    assert fill.price == 95.0
    assert fill.brokerage == pytest.approx(0.95)
    assert fill.total_charges == pytest.approx(0.95)
