from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.enums import OrderSide, OrderStatus, OrderType
from app.models import Order
from app.services.orders.order_service import OrderService


def test_create_order():
    db = MagicMock()
    service = OrderService(db)

    order = MagicMock(spec=Order)
    service.repository.create = MagicMock(return_value=order)

    execution_id = uuid4()
    instrument_id = uuid4()
    order_timestamp = datetime.now(timezone.utc)

    result = service.create_order(
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

    assert result == order

    service.repository.create.assert_called_once_with(
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


def test_list_orders():
    db = MagicMock()
    service = OrderService(db)

    orders = [
        MagicMock(spec=Order),
        MagicMock(spec=Order),
    ]

    service.repository.list = MagicMock(return_value=orders)

    result = service.list_orders()

    assert result == orders
    service.repository.list.assert_called_once_with()


def test_get_order():
    db = MagicMock()
    service = OrderService(db)

    order = MagicMock(spec=Order)
    service.repository.get_by_id = MagicMock(return_value=order)

    order_id = uuid4()

    result = service.get_order(
        order_id=order_id,
    )

    assert result == order

    service.repository.get_by_id.assert_called_once_with(
        order_id=order_id,
    )


def test_get_required_order():
    db = MagicMock()
    service = OrderService(db)

    order = MagicMock(spec=Order)
    service.repository.get_by_id = MagicMock(return_value=order)

    order_id = uuid4()

    result = service.get_required_order(
        order_id=order_id,
    )

    assert result is order

    service.repository.get_by_id.assert_called_once_with(
        order_id=order_id,
    )


def test_get_required_order_not_found():
    db = MagicMock()
    service = OrderService(db)

    service.repository.get_by_id = MagicMock(return_value=None)

    order_id = uuid4()

    with pytest.raises(ValueError, match="Order not found\\."):
        service.get_required_order(
            order_id=order_id,
        )


def test_update_order():
    db = MagicMock()
    service = OrderService(db)

    order = MagicMock(spec=Order)
    service.repository.update = MagicMock(return_value=order)

    order_timestamp = datetime.now(timezone.utc)

    result = service.update_order(
        order=order,
        broker_order_id="BROKER-456",
        status=OrderStatus.OPEN,
        filled_quantity=25,
        average_fill_price=251.25,
        order_timestamp=order_timestamp,
    )

    assert result == order

    service.repository.update.assert_called_once_with(
        order=order,
        broker_order_id="BROKER-456",
        status=OrderStatus.OPEN,
        filled_quantity=25,
        average_fill_price=251.25,
        order_timestamp=order_timestamp,
    )


def test_delete_order():
    db = MagicMock()
    service = OrderService(db)

    order = MagicMock(spec=Order)
    service.repository.delete = MagicMock(return_value=None)

    result = service.delete_order(
        order=order,
    )

    assert result is None

    service.repository.delete.assert_called_once_with(
        order=order,
    )

def test_create_order_rejects_non_positive_quantity():
    service = OrderService(MagicMock())

    with pytest.raises(ValueError, match="Quantity must be greater than zero."):
        service.create_order(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_order_id=None,
            order_type=OrderType.MARKET,
            order_side=OrderSide.BUY,
            status=OrderStatus.PENDING,
            quantity=0,
            filled_quantity=0,
            price=100,
            average_fill_price=None,
            order_timestamp=None,
        )


def test_create_order_rejects_negative_filled_quantity():
    service = OrderService(MagicMock())

    with pytest.raises(ValueError, match="Filled quantity cannot be negative."):
        service.create_order(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_order_id=None,
            order_type=OrderType.MARKET,
            order_side=OrderSide.BUY,
            status=OrderStatus.PENDING,
            quantity=100,
            filled_quantity=-1,
            price=100,
            average_fill_price=None,
            order_timestamp=None,
        )


def test_create_order_rejects_non_positive_price():
    service = OrderService(MagicMock())

    with pytest.raises(ValueError, match="Price must be greater than zero."):
        service.create_order(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_order_id=None,
            order_type=OrderType.MARKET,
            order_side=OrderSide.BUY,
            status=OrderStatus.PENDING,
            quantity=100,
            filled_quantity=0,
            price=0,
            average_fill_price=None,
            order_timestamp=None,
        )


def test_create_order_rejects_non_positive_average_fill_price():
    service = OrderService(MagicMock())

    with pytest.raises(
        ValueError,
        match="Average fill price must be greater than zero.",
    ):
        service.create_order(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_order_id=None,
            order_type=OrderType.MARKET,
            order_side=OrderSide.BUY,
            status=OrderStatus.PENDING,
            quantity=100,
            filled_quantity=0,
            price=100,
            average_fill_price=0,
            order_timestamp=None,
        )

def test_create_order_rejects_non_pending_status():
    service = OrderService(MagicMock())

    with pytest.raises(
        ValueError,
        match="Order must be created with PENDING status.",
    ):
        service.create_order(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_order_id=None,
            order_type=OrderType.MARKET,
            order_side=OrderSide.BUY,
            status=OrderStatus.OPEN,
            quantity=100,
            filled_quantity=0,
            price=100,
            average_fill_price=None,
            order_timestamp=None,
        )

def test_open_order_updates_status_and_timestamp():
    service = OrderService(MagicMock())

    order = MagicMock(spec=Order)
    order.status = OrderStatus.PENDING

    updated_order = MagicMock(spec=Order)
    service.repository.update = MagicMock(return_value=updated_order)

    result = service.open_order(order=order)

    assert result is updated_order

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["order"] is order
    assert kwargs["status"] is OrderStatus.OPEN
    assert kwargs["order_timestamp"] is not None
    assert kwargs["order_timestamp"].tzinfo is not None


def test_complete_order_updates_status_and_timestamp():
    service = OrderService(MagicMock())

    order = MagicMock(spec=Order)
    order.status = OrderStatus.OPEN

    updated_order = MagicMock(spec=Order)
    service.repository.update = MagicMock(return_value=updated_order)

    result = service.complete_order(order=order)

    assert result is updated_order

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["status"] is OrderStatus.COMPLETED
    assert kwargs["order_timestamp"] is not None


def test_cancel_order_updates_status_and_timestamp():
    service = OrderService(MagicMock())

    order = MagicMock(spec=Order)
    order.status = OrderStatus.OPEN

    updated_order = MagicMock(spec=Order)
    service.repository.update = MagicMock(return_value=updated_order)

    result = service.cancel_order(order=order)

    assert result is updated_order

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["status"] is OrderStatus.CANCELLED
    assert kwargs["order_timestamp"] is not None


def test_reject_order_updates_status_and_timestamp():
    service = OrderService(MagicMock())

    order = MagicMock(spec=Order)
    order.status = OrderStatus.OPEN

    updated_order = MagicMock(spec=Order)
    service.repository.update = MagicMock(return_value=updated_order)

    result = service.reject_order(order=order)

    assert result is updated_order

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["status"] is OrderStatus.REJECTED
    assert kwargs["order_timestamp"] is not None
