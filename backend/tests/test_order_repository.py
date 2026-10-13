from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

from app.enums import OrderSide, OrderStatus, OrderType
from app.models import Order
from app.repositories.orders.order_repository import OrderRepository


def test_create():
    db = MagicMock()
    repository = OrderRepository(db)

    execution_id = uuid4()
    instrument_id = uuid4()
    order_timestamp = datetime.now(timezone.utc)

    order = repository.create(
        execution_id=execution_id,
        instrument_id=instrument_id,
        broker_order_id="BROKER-123",
        order_type=OrderType.MARKET,
        order_side=OrderSide.BUY,
        status=OrderStatus.PENDING,
        quantity=100,
        filled_quantity=0,
        price=250.50,
        average_fill_price=None,
        order_timestamp=order_timestamp,
    )

    db.add.assert_called_once()
    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(order)

    assert order.execution_id == execution_id
    assert order.instrument_id == instrument_id
    assert order.broker_order_id == "BROKER-123"
    assert order.order_type == OrderType.MARKET
    assert order.order_side == OrderSide.BUY
    assert order.status == OrderStatus.PENDING
    assert order.quantity == 100
    assert order.filled_quantity == 0
    assert order.price == 250.50
    assert order.average_fill_price is None
    assert order.order_timestamp == order_timestamp


def test_list():
    db = MagicMock()
    repository = OrderRepository(db)

    first_order = MagicMock(spec=Order)
    second_order = MagicMock(spec=Order)

    db.scalars.return_value.all.return_value = [
        first_order,
        second_order,
    ]

    orders = repository.list()

    assert orders == [
        first_order,
        second_order,
    ]

    db.scalars.assert_called_once()


def test_get_by_id():
    db = MagicMock()
    repository = OrderRepository(db)

    order = MagicMock(spec=Order)
    db.scalar.return_value = order

    order_id = uuid4()

    result = repository.get_by_id(
        order_id=order_id,
    )

    assert result == order
    db.scalar.assert_called_once()


def test_update():
    db = MagicMock()
    repository = OrderRepository(db)

    order = MagicMock(spec=Order)
    order_timestamp = datetime.now(timezone.utc)

    result = repository.update(
        order=order,
        broker_order_id="BROKER-456",
        status=OrderStatus.OPEN,
        filled_quantity=25,
        average_fill_price=251.25,
        order_timestamp=order_timestamp,
    )

    assert result == order
    assert order.broker_order_id == "BROKER-456"
    assert order.status == OrderStatus.OPEN
    assert order.filled_quantity == 25
    assert order.average_fill_price == 251.25
    assert order.order_timestamp == order_timestamp

    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(order)


def test_delete():
    db = MagicMock()
    repository = OrderRepository(db)

    order = MagicMock(spec=Order)

    result = repository.delete(
        order=order,
    )

    assert result is None
    db.delete.assert_called_once_with(order)
    db.commit.assert_called_once()
