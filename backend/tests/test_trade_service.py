from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.models import Trade
from app.services.trades.trade_service import TradeService


def test_create_trade():
    service = TradeService(MagicMock())
    trade = MagicMock(spec=Trade)

    service.repository.create = MagicMock(return_value=trade)

    order_id = uuid4()
    trade_timestamp = datetime.now(timezone.utc)

    result = service.create_trade(
        order_id=order_id,
        broker_trade_id="TRADE-123",
        executed_quantity=40,
        executed_price=250.50,
        brokerage=10.00,
        total_charges=12.50,
        trade_timestamp=trade_timestamp,
    )

    assert result is trade

    service.repository.create.assert_called_once_with(
        order_id=order_id,
        broker_trade_id="TRADE-123",
        executed_quantity=40,
        executed_price=250.50,
        brokerage=10.00,
        total_charges=12.50,
        trade_timestamp=trade_timestamp,
    )


def test_execute_trade_updates_position_from_order():
    db = MagicMock()
    service = TradeService(db)

    trade = MagicMock(spec=Trade)

    order = MagicMock()
    order.execution_id = uuid4()
    order.instrument_id = uuid4()
    order.order_side = "BUY"

    position = MagicMock()

    service.repository.create = MagicMock(return_value=trade)

    service.order_service = MagicMock()
    service.order_service.get_required_order = MagicMock(
        return_value=order,
    )

    service.position_service = MagicMock()
    service.position_service.get_position_by_execution_and_instrument = MagicMock(
        return_value=position,
    )

    result = service.execute_trade(
        order_id=uuid4(),
        broker_trade_id="TRD-001",
        executed_quantity=25,
        executed_price=260.00,
        brokerage=10.00,
        total_charges=12.50,
        trade_timestamp=None,
    )

    assert result is trade

    service.position_service.apply_trade_quantity.assert_called_once_with(
        position=position,
        order_side=order.order_side,
        executed_quantity=25,
        executed_price=260.00,
    )


def test_execute_trade_rejects_missing_position():
    db = MagicMock()
    service = TradeService(db)

    trade = MagicMock(spec=Trade)

    order = MagicMock()
    order.execution_id = uuid4()
    order.instrument_id = uuid4()
    order.order_side = "BUY"

    service.repository.create = MagicMock(return_value=trade)

    service.order_service = MagicMock()
    service.order_service.get_required_order = MagicMock(
        return_value=order,
    )

    service.position_service = MagicMock()
    service.position_service.get_position_by_execution_and_instrument = MagicMock(
        return_value=None,
    )

    with pytest.raises(
        ValueError,
        match="Position not found.",
    ):
        service.execute_trade(
            order_id=uuid4(),
            broker_trade_id="TRD-002",
            executed_quantity=25,
            executed_price=260.00,
            brokerage=10.00,
            total_charges=12.50,
            trade_timestamp=None,
        )

    service.position_service.apply_trade_quantity.assert_not_called()


def test_list_trades():
    service = TradeService(MagicMock())

    first_trade = MagicMock(spec=Trade)
    second_trade = MagicMock(spec=Trade)

    service.repository.list = MagicMock(
        return_value=[first_trade, second_trade],
    )

    result = service.list_trades()

    assert result == [first_trade, second_trade]
    service.repository.list.assert_called_once_with()


def test_get_trade():
    service = TradeService(MagicMock())
    trade = MagicMock(spec=Trade)
    trade_id = uuid4()

    service.repository.get_by_id = MagicMock(return_value=trade)

    result = service.get_trade(
        trade_id=trade_id,
    )

    assert result is trade

    service.repository.get_by_id.assert_called_once_with(
        trade_id=trade_id,
    )


def test_get_required_trade():
    service = TradeService(MagicMock())
    trade = MagicMock(spec=Trade)
    trade_id = uuid4()

    service.repository.get_by_id = MagicMock(return_value=trade)

    result = service.get_required_trade(
        trade_id=trade_id,
    )

    assert result is trade


def test_get_required_trade_not_found():
    service = TradeService(MagicMock())
    trade_id = uuid4()

    service.repository.get_by_id = MagicMock(return_value=None)

    with pytest.raises(
        ValueError,
        match="Trade not found.",
    ):
        service.get_required_trade(
            trade_id=trade_id,
        )


def test_update_trade():
    service = TradeService(MagicMock())
    trade = MagicMock(spec=Trade)
    trade_timestamp = datetime.now(timezone.utc)

    service.repository.update = MagicMock(return_value=trade)

    result = service.update_trade(
        trade=trade,
        broker_trade_id="TRADE-456",
        executed_quantity=60,
        executed_price=251.25,
        brokerage=11.00,
        total_charges=13.50,
        trade_timestamp=trade_timestamp,
    )

    assert result is trade

    service.repository.update.assert_called_once_with(
        trade=trade,
        broker_trade_id="TRADE-456",
        executed_quantity=60,
        executed_price=251.25,
        brokerage=11.00,
        total_charges=13.50,
        trade_timestamp=trade_timestamp,
    )


def test_delete_trade():
    service = TradeService(MagicMock())
    trade = MagicMock(spec=Trade)

    service.repository.delete = MagicMock(return_value=None)

    result = service.delete_trade(
        trade=trade,
    )

    assert result is None

    service.repository.delete.assert_called_once_with(
        trade=trade,
    )
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.trades.trade_service import TradeService


def make_service():
    service = TradeService.__new__(TradeService)
    service.repository = MagicMock()
    return service


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        (
            "executed_quantity",
            0,
            "Executed quantity must be greater than zero.",
        ),
        (
            "executed_quantity",
            -1,
            "Executed quantity must be greater than zero.",
        ),
        (
            "executed_price",
            0,
            "Executed price must be greater than zero.",
        ),
        (
            "executed_price",
            -1,
            "Executed price must be greater than zero.",
        ),
        (
            "brokerage",
            -1,
            "Brokerage cannot be negative.",
        ),
        (
            "total_charges",
            -1,
            "Total charges cannot be negative.",
        ),
    ],
)
def test_create_trade_rejects_invalid_numeric_fields(
    field,
    value,
    message,
):
    service = make_service()

    values = {
        "executed_quantity": 25,
        "executed_price": 251.50,
        "brokerage": 10.00,
        "total_charges": 12.50,
    }

    values[field] = value

    with pytest.raises(ValueError, match=message):
        service.create_trade(
            order_id=uuid4(),
            broker_trade_id="TRD-001",
            executed_quantity=values["executed_quantity"],
            executed_price=values["executed_price"],
            brokerage=values["brokerage"],
            total_charges=values["total_charges"],
            trade_timestamp=None,
        )

    service.repository.create.assert_not_called()


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        (
            "executed_quantity",
            0,
            "Executed quantity must be greater than zero.",
        ),
        (
            "executed_price",
            0,
            "Executed price must be greater than zero.",
        ),
        (
            "brokerage",
            -1,
            "Brokerage cannot be negative.",
        ),
        (
            "total_charges",
            -1,
            "Total charges cannot be negative.",
        ),
    ],
)
def test_update_trade_rejects_invalid_numeric_fields(
    field,
    value,
    message,
):
    service = make_service()
    trade = MagicMock()

    values = {
        "executed_quantity": None,
        "executed_price": None,
        "brokerage": None,
        "total_charges": None,
    }

    values[field] = value

    with pytest.raises(ValueError, match=message):
        service.update_trade(
            trade=trade,
            executed_quantity=values["executed_quantity"],
            executed_price=values["executed_price"],
            brokerage=values["brokerage"],
            total_charges=values["total_charges"],
        )

    service.repository.update.assert_not_called()
