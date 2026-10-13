from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

from app.enums import PositionStatus
from app.models import Position
from app.repositories.positions.position_repository import PositionRepository


def test_create():
    db = MagicMock()
    repository = PositionRepository(db)

    execution_id = uuid4()
    instrument_id = uuid4()
    broker_account_id = uuid4()
    last_updated_at = datetime.now(timezone.utc)

    position = repository.create(
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

    db.add.assert_called_once()
    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(position)

    assert position.execution_id == execution_id
    assert position.instrument_id == instrument_id
    assert position.broker_account_id == broker_account_id
    assert position.quantity == 100
    assert position.average_price == 250.50
    assert position.current_price == 255.00
    assert position.market_value == 25500.00
    assert position.realized_pnl == 0.00
    assert position.unrealized_pnl == 450.00
    assert position.position_status is PositionStatus.OPEN
    assert position.last_updated_at == last_updated_at
    assert position.closed_at is None


def test_list():
    db = MagicMock()
    repository = PositionRepository(db)

    first_position = MagicMock(spec=Position)
    second_position = MagicMock(spec=Position)

    db.scalars.return_value.all.return_value = [
        first_position,
        second_position,
    ]

    positions = repository.list()

    assert positions == [
        first_position,
        second_position,
    ]

    db.scalars.assert_called_once()


def test_get_by_id():
    db = MagicMock()
    repository = PositionRepository(db)

    position = MagicMock(spec=Position)
    db.scalar.return_value = position

    position_id = uuid4()

    result = repository.get_by_id(
        position_id=position_id,
    )

    assert result == position
    db.scalar.assert_called_once()


def test_update():
    db = MagicMock()
    repository = PositionRepository(db)

    position = MagicMock(spec=Position)

    broker_account_id = uuid4()
    last_updated_at = datetime.now(timezone.utc)
    closed_at = datetime.now(timezone.utc)

    result = repository.update(
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
    assert position.broker_account_id == broker_account_id
    assert position.quantity == 150
    assert position.average_price == 252.00
    assert position.current_price == 260.00
    assert position.market_value == 39000.00
    assert position.realized_pnl == 500.00
    assert position.unrealized_pnl == 1200.00
    assert position.position_status is PositionStatus.CLOSED
    assert position.last_updated_at == last_updated_at
    assert position.closed_at == closed_at

    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(position)


def test_delete():
    db = MagicMock()
    repository = PositionRepository(db)

    position = MagicMock(spec=Position)

    result = repository.delete(
        position=position,
    )

    assert result is None
    db.delete.assert_called_once_with(position)
    db.commit.assert_called_once()
