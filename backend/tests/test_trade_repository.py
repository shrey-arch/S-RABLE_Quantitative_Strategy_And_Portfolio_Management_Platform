from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

from app.enums import OrderSide, OrderStatus, OrderType
from app.models import Trade
from app.repositories.trades.trade_repository import TradeRepository


def test_create():
    db = MagicMock()
    repository = TradeRepository(db)

    order_id = uuid4()
    trade_timestamp = datetime.now(timezone.utc)

    trade = repository.create(
        order_id=order_id,
        broker_trade_id="TRADE-123",
        executed_quantity=40,
        executed_price=250.50,
        brokerage=10.00,
        total_charges=12.50,
        trade_timestamp=trade_timestamp,
    )

    db.add.assert_called_once()
    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(trade)

    assert trade.order_id == order_id
    assert trade.broker_trade_id == "TRADE-123"
    assert trade.executed_quantity == 40
    assert trade.executed_price == 250.50
    assert trade.brokerage == 10.00
    assert trade.total_charges == 12.50
    assert trade.trade_timestamp == trade_timestamp


def test_list():
    db = MagicMock()
    repository = TradeRepository(db)

    first_trade = MagicMock(spec=Trade)
    second_trade = MagicMock(spec=Trade)

    db.scalars.return_value.all.return_value = [
        first_trade,
        second_trade,
    ]

    trades = repository.list()

    assert trades == [
        first_trade,
        second_trade,
    ]

    db.scalars.assert_called_once()


def test_get_by_id():
    db = MagicMock()
    repository = TradeRepository(db)

    trade = MagicMock(spec=Trade)
    db.scalar.return_value = trade

    trade_id = uuid4()

    result = repository.get_by_id(
        trade_id=trade_id,
    )

    assert result == trade
    db.scalar.assert_called_once()


def test_update():
    db = MagicMock()
    repository = TradeRepository(db)

    trade = MagicMock(spec=Trade)
    trade_timestamp = datetime.now(timezone.utc)

    result = repository.update(
        trade=trade,
        broker_trade_id="TRADE-456",
        executed_quantity=60,
        executed_price=251.25,
        brokerage=11.00,
        total_charges=13.50,
        trade_timestamp=trade_timestamp,
    )

    assert result == trade
    assert trade.broker_trade_id == "TRADE-456"
    assert trade.executed_quantity == 60
    assert trade.executed_price == 251.25
    assert trade.brokerage == 11.00
    assert trade.total_charges == 13.50
    assert trade.trade_timestamp == trade_timestamp

    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(trade)


def test_delete():
    db = MagicMock()
    repository = TradeRepository(db)

    trade = MagicMock(spec=Trade)

    result = repository.delete(
        trade=trade,
    )

    assert result is None
    db.delete.assert_called_once_with(trade)
    db.commit.assert_called_once()
