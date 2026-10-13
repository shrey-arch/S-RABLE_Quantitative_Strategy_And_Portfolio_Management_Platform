from datetime import datetime, timezone
from uuid import uuid4

from app.backtesting.broker import SimulatedBroker
from app.backtesting.execution import BacktestExecution
from app.enums import OrderSide, OrderStatus, OrderType
from app.models import Order


def make_order(order_type, side, quantity=10, price=100.0):
    return Order(
        execution_id=uuid4(),
        instrument_id=uuid4(),
        order_type=order_type,
        order_side=side,
        status=OrderStatus.PENDING,
        quantity=quantity,
        filled_quantity=0,
        price=price,
        average_fill_price=None,
        order_timestamp=datetime.now(timezone.utc),
    )


def test_market_order_fills():
    execution = BacktestExecution(SimulatedBroker())
    order = make_order(OrderType.MARKET, OrderSide.BUY)

    fill = execution.execute(
        order=order,
        market_price=105.0,
        timestamp=datetime.now(timezone.utc),
    )

    assert fill is not None
    assert fill.quantity == 10
    assert fill.price == 105.0
    assert order.status == OrderStatus.COMPLETED
    assert order.filled_quantity == 10
    assert order.average_fill_price == 105.0


def test_limit_buy_fills_when_low_reaches_limit():
    execution = BacktestExecution(SimulatedBroker())
    order = make_order(OrderType.LIMIT, OrderSide.BUY, price=100.0)

    fill = execution.execute(
        order=order,
        market_price=105.0,
        market_high=110.0,
        market_low=99.0,
        timestamp=datetime.now(timezone.utc),
    )

    assert fill is not None
    assert fill.price == 100.0
    assert order.status == OrderStatus.COMPLETED


def test_limit_buy_does_not_fill_above_limit():
    execution = BacktestExecution(SimulatedBroker())
    order = make_order(OrderType.LIMIT, OrderSide.BUY, price=100.0)

    fill = execution.execute(
        order=order,
        market_price=105.0,
        market_high=110.0,
        market_low=101.0,
        timestamp=datetime.now(timezone.utc),
    )

    assert fill is None
    assert order.status == OrderStatus.PENDING
    assert order.filled_quantity == 0


def test_limit_sell_fills_when_high_reaches_limit():
    execution = BacktestExecution(SimulatedBroker())
    order = make_order(OrderType.LIMIT, OrderSide.SELL, price=100.0)

    fill = execution.execute(
        order=order,
        market_price=95.0,
        market_high=101.0,
        market_low=90.0,
        timestamp=datetime.now(timezone.utc),
    )

    assert fill is not None
    assert fill.price == 100.0
    assert order.status == OrderStatus.COMPLETED


def test_limit_sell_does_not_fill_below_limit():
    execution = BacktestExecution(SimulatedBroker())
    order = make_order(OrderType.LIMIT, OrderSide.SELL, price=100.0)

    fill = execution.execute(
        order=order,
        market_price=95.0,
        market_high=99.0,
        market_low=90.0,
        timestamp=datetime.now(timezone.utc),
    )

    assert fill is None
    assert order.status == OrderStatus.PENDING
    assert order.filled_quantity == 0
