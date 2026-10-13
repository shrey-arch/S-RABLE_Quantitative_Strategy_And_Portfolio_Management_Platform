from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.enums import PositionStatus
from app.models import Position
from app.services.positions.position_service import PositionService


def test_create_position():
    db = MagicMock()
    service = PositionService(db)

    execution_id = uuid4()
    instrument_id = uuid4()
    broker_account_id = uuid4()
    last_updated_at = datetime.now(timezone.utc)

    position = MagicMock(spec=Position)
    service.repository.create = MagicMock(return_value=position)

    result = service.create_position(
        execution_id=execution_id,
        instrument_id=instrument_id,
        broker_account_id=broker_account_id,
        quantity=100,
        average_price=250.50,
        current_price=255.00,
        market_value=25500.00,
        realized_pnl=0.00,
        unrealized_pnl=450.00,
        position_status=PositionStatus.OPEN,
        last_updated_at=last_updated_at,
        closed_at=None,
    )

    assert result == position

    service.repository.create.assert_called_once_with(
        execution_id=execution_id,
        instrument_id=instrument_id,
        broker_account_id=broker_account_id,
        quantity=100,
        average_price=250.50,
        current_price=255.00,
        market_value=25500.00,
        realized_pnl=0.00,
        unrealized_pnl=450.00,
        position_status=PositionStatus.OPEN,
        last_updated_at=last_updated_at,
        closed_at=None,
    )


def test_list_positions():
    db = MagicMock()
    service = PositionService(db)

    positions = [
        MagicMock(spec=Position),
        MagicMock(spec=Position),
    ]

    service.repository.list = MagicMock(return_value=positions)

    result = service.list_positions()

    assert result == positions
    service.repository.list.assert_called_once()


def test_get_position():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position_id = uuid4()

    service.repository.get_by_id = MagicMock(return_value=position)

    result = service.get_position(
        position_id=position_id,
    )

    assert result == position

    service.repository.get_by_id.assert_called_once_with(
        position_id=position_id,
    )


def test_get_required_position_not_found():
    db = MagicMock()
    service = PositionService(db)

    position_id = uuid4()

    service.repository.get_by_id = MagicMock(return_value=None)

    with pytest.raises(ValueError, match="Position not found."):
        service.get_required_position(
            position_id=position_id,
        )


def test_update_closed_position_allows_zero_quantity():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.position_status = PositionStatus.OPEN
    position.closed_at = None

    service.repository.update = MagicMock(return_value=position)

    closed_at = datetime.now(timezone.utc)

    result = service.update_position(
        position=position,
        quantity=0,
        position_status=PositionStatus.CLOSED,
        closed_at=closed_at,
    )

    assert result is position
    service.repository.update.assert_called_once()

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 0
    assert kwargs["position_status"] == PositionStatus.CLOSED
    assert kwargs["closed_at"] == closed_at


def test_update_position():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)

    service.repository.update = MagicMock(return_value=position)

    broker_account_id = uuid4()
    last_updated_at = datetime.now(timezone.utc)
    closed_at = datetime.now(timezone.utc)

    result = service.update_position(
        position=position,
        broker_account_id=broker_account_id,
        quantity=150,
        average_price=252.00,
        current_price=260.00,
        market_value=39000.00,
        realized_pnl=500.00,
        unrealized_pnl=1200.00,
        position_status=PositionStatus.CLOSED,
        last_updated_at=last_updated_at,
        closed_at=closed_at,
    )

    assert result == position

    service.repository.update.assert_called_once_with(
        position=position,
        broker_account_id=broker_account_id,
        quantity=150,
        average_price=252.00,
        current_price=260.00,
        market_value=39000.00,
        realized_pnl=500.00,
        unrealized_pnl=1200.00,
        position_status=PositionStatus.CLOSED,
        last_updated_at=last_updated_at,
        closed_at=closed_at,
    )


def test_delete_position():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)

    service.repository.delete = MagicMock(return_value=None)

    result = service.delete_position(
        position=position,
    )

    assert result is None
    service.repository.delete.assert_called_once_with(
        position=position,
    )

def test_create_position_rejects_non_positive_quantity():
    db = MagicMock()
    service = PositionService(db)

    with pytest.raises(ValueError, match="Quantity must be greater than zero."):
        service.create_position(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_account_id=None,
            quantity=0,
            average_price=250.00,
            current_price=255.00,
            market_value=25500.00,
            realized_pnl=0.00,
            unrealized_pnl=500.00,
            position_status=PositionStatus.OPEN,
            last_updated_at=datetime.now(timezone.utc),
            closed_at=None,
        )


def test_create_position_rejects_non_positive_average_price():
    db = MagicMock()
    service = PositionService(db)

    with pytest.raises(ValueError, match="Average price must be greater than zero."):
        service.create_position(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_account_id=None,
            quantity=100,
            average_price=0,
            current_price=255.00,
            market_value=25500.00,
            realized_pnl=0.00,
            unrealized_pnl=500.00,
            position_status=PositionStatus.OPEN,
            last_updated_at=datetime.now(timezone.utc),
            closed_at=None,
        )


def test_create_position_rejects_non_positive_current_price():
    db = MagicMock()
    service = PositionService(db)

    with pytest.raises(ValueError, match="Current price must be greater than zero."):
        service.create_position(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_account_id=None,
            quantity=100,
            average_price=250.00,
            current_price=0,
            market_value=25500.00,
            realized_pnl=0.00,
            unrealized_pnl=500.00,
            position_status=PositionStatus.OPEN,
            last_updated_at=datetime.now(timezone.utc),
            closed_at=None,
        )


def test_create_position_rejects_negative_market_value():
    db = MagicMock()
    service = PositionService(db)

    with pytest.raises(ValueError, match="Market value cannot be negative."):
        service.create_position(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_account_id=None,
            quantity=100,
            average_price=250.00,
            current_price=255.00,
            market_value=-1.00,
            realized_pnl=0.00,
            unrealized_pnl=500.00,
            position_status=PositionStatus.OPEN,
            last_updated_at=datetime.now(timezone.utc),
            closed_at=None,
        )


def test_create_position_rejects_open_position_with_closed_at():
    db = MagicMock()
    service = PositionService(db)

    with pytest.raises(
        ValueError,
        match="Open position cannot have a closed timestamp.",
    ):
        service.create_position(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_account_id=None,
            quantity=100,
            average_price=250.00,
            current_price=255.00,
            market_value=25500.00,
            realized_pnl=0.00,
            unrealized_pnl=500.00,
            position_status=PositionStatus.OPEN,
            last_updated_at=datetime.now(timezone.utc),
            closed_at=datetime.now(timezone.utc),
        )


def test_create_position_rejects_closed_position_without_closed_at():
    db = MagicMock()
    service = PositionService(db)

    with pytest.raises(
        ValueError,
        match="Closed position must have a closed timestamp.",
    ):
        service.create_position(
            execution_id=uuid4(),
            instrument_id=uuid4(),
            broker_account_id=None,
            quantity=100,
            average_price=250.00,
            current_price=255.00,
            market_value=25500.00,
            realized_pnl=0.00,
            unrealized_pnl=500.00,
            position_status=PositionStatus.CLOSED,
            last_updated_at=datetime.now(timezone.utc),
            closed_at=None,
        )


def test_get_position_by_execution_and_instrument():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    execution_id = uuid4()
    instrument_id = uuid4()

    service.repository.get_by_execution_and_instrument = MagicMock(
        return_value=position,
    )

    result = service.get_position_by_execution_and_instrument(
        execution_id=execution_id,
        instrument_id=instrument_id,
    )

    assert result is position

    service.repository.get_by_execution_and_instrument.assert_called_once_with(
        execution_id=execution_id,
        instrument_id=instrument_id,
    )


def test_apply_trade_updates_unrealized_pnl_for_open_position():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.average_price = 250.00
    position.current_price = 280.00
    position.unrealized_pnl = 1000.00
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock(return_value=position)

    result = service.apply_trade_quantity(
        position=position,
        order_side="BUY",
        executed_quantity=25,
        executed_price=260.00,
    )

    assert result is position

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 125
    assert kwargs["average_price"] == pytest.approx(252.00)
    assert kwargs["unrealized_pnl"] == pytest.approx(3500.00)
    assert kwargs["last_updated_at"] is not None
    assert kwargs["last_updated_at"].tzinfo is not None


def test_apply_trade_updates_market_value_when_current_price_exists():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.average_price = 250.00
    position.current_price = 280.00
    position.market_value = 28000.00
    position.unrealized_pnl = 3000.00
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock(return_value=position)

    result = service.apply_trade_quantity(
        position=position,
        order_side="BUY",
        executed_quantity=25,
        executed_price=260.00,
    )

    assert result is position

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 125
    assert kwargs["market_value"] == pytest.approx(35000.00)
    assert kwargs["last_updated_at"] is not None


def test_apply_trade_buy_increases_position_quantity():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock(return_value=position)

    result = service.apply_trade_quantity(
        position=position,
        order_side="BUY",
        executed_quantity=25,
        executed_price=260.00,
    )

    assert result is position
    service.repository.update.assert_called_once()

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 125
    assert kwargs["last_updated_at"] is not None
    assert kwargs["last_updated_at"].tzinfo is not None


def test_apply_sell_trade_updates_market_value_for_remaining_position():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.average_price = 250.00
    position.current_price = 280.00
    position.market_value = 28000.00
    position.realized_pnl = 100.00
    position.unrealized_pnl = 3000.00
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock(return_value=position)

    result = service.apply_trade_quantity(
        position=position,
        order_side="SELL",
        executed_quantity=25,
        executed_price=270.00,
    )

    assert result is position

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 75
    assert kwargs["realized_pnl"] == pytest.approx(600.00)
    assert kwargs["unrealized_pnl"] == pytest.approx(2250.00)
    assert kwargs["market_value"] == pytest.approx(21000.00)
    assert kwargs["last_updated_at"] is not None


def test_apply_sell_trade_updates_unrealized_pnl_for_remaining_position():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.average_price = 250.00
    position.current_price = 280.00
    position.realized_pnl = 100.00
    position.unrealized_pnl = 3000.00
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock(return_value=position)

    result = service.apply_trade_quantity(
        position=position,
        order_side="SELL",
        executed_quantity=25,
        executed_price=270.00,
    )

    assert result is position

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 75
    assert kwargs["realized_pnl"] == pytest.approx(600.00)
    assert kwargs["unrealized_pnl"] == pytest.approx(2250.00)
    assert kwargs["last_updated_at"] is not None
    assert kwargs["last_updated_at"].tzinfo is not None


def test_apply_sell_trade_updates_realized_pnl():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.average_price = 250.00
    position.realized_pnl = 100.00
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock(return_value=position)

    result = service.apply_trade_quantity(
        position=position,
        order_side="SELL",
        executed_quantity=25,
        executed_price=270.00,
    )

    assert result is position

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 75
    assert kwargs["realized_pnl"] == pytest.approx(600.00)
    assert kwargs["last_updated_at"] is not None
    assert kwargs["last_updated_at"].tzinfo is not None


def test_apply_trade_sell_decreases_position_quantity():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock(return_value=position)

    result = service.apply_trade_quantity(
        position=position,
        order_side="SELL",
        executed_quantity=25,
        executed_price=260.00,
    )

    assert result is position
    service.repository.update.assert_called_once()

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 75
    assert kwargs["last_updated_at"] is not None
    assert kwargs["last_updated_at"].tzinfo is not None


def test_apply_trade_close_sets_market_value_to_zero():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.average_price = 250.00
    position.current_price = 280.00
    position.market_value = 28000.00
    position.realized_pnl = 100.00
    position.unrealized_pnl = 3000.00
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock(return_value=position)

    result = service.apply_trade_quantity(
        position=position,
        order_side="SELL",
        executed_quantity=100,
        executed_price=270.00,
    )

    assert result is position

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 0
    assert kwargs["realized_pnl"] == pytest.approx(2100.00)
    assert kwargs["unrealized_pnl"] == pytest.approx(0)
    assert kwargs["market_value"] == pytest.approx(0)
    assert kwargs["position_status"] == PositionStatus.CLOSED
    assert kwargs["closed_at"] is not None
    assert kwargs["last_updated_at"] is not None


def test_apply_trade_sell_closes_position_when_quantity_reaches_zero():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock(return_value=position)

    result = service.apply_trade_quantity(
        position=position,
        order_side="SELL",
        executed_quantity=100,
        executed_price=260.00,
    )

    assert result is position

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 0
    assert kwargs["position_status"] == PositionStatus.CLOSED
    assert kwargs["closed_at"] is not None
    assert kwargs["last_updated_at"] is not None
    assert kwargs["last_updated_at"].tzinfo is not None


def test_apply_trade_sell_rejects_quantity_greater_than_position():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock()

    with pytest.raises(
        ValueError,
        match="Sell quantity cannot exceed position quantity.",
    ):
        service.apply_trade_quantity(
            position=position,
            order_side="SELL",
            executed_quantity=101,
            executed_price=260.00,
        )

    service.repository.update.assert_not_called()


def test_apply_buy_trade_updates_weighted_average_price():
    db = MagicMock()
    service = PositionService(db)

    position = MagicMock(spec=Position)
    position.quantity = 100
    position.average_price = 250.00
    position.position_status = PositionStatus.OPEN

    service.repository.update = MagicMock(return_value=position)

    result = service.apply_trade_quantity(
        position=position,
        order_side="BUY",
        executed_quantity=50,
        executed_price=260.00,
    )

    assert result is position

    kwargs = service.repository.update.call_args.kwargs

    assert kwargs["position"] is position
    assert kwargs["quantity"] == 150
    assert kwargs["average_price"] == pytest.approx(253.3333333333)
