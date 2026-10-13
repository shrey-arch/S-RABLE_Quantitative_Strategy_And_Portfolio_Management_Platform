from unittest.mock import MagicMock
from uuid import uuid4

from app.enums import Exchange, InstrumentType
from app.models import Instrument
from app.repositories.instruments.instrument_repository import (
    InstrumentRepository,
)


def test_create():
    db = MagicMock()
    repository = InstrumentRepository(db)

    instrument = repository.create(
        symbol="RELIANCE",
        trading_symbol="RELIANCE-EQ",
        name="Reliance Industries",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin="INE002A01018",
        lot_size=1,
        tick_size=0.05,
        is_active=True,
    )

    db.add.assert_called_once()
    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(instrument)

    assert instrument.symbol == "RELIANCE"
    assert instrument.trading_symbol == "RELIANCE-EQ"
    assert instrument.name == "Reliance Industries"
    assert instrument.exchange == Exchange.NSE
    assert instrument.instrument_type == InstrumentType.EQUITY


def test_list():
    db = MagicMock()
    repository = InstrumentRepository(db)

    first_instrument = MagicMock(spec=Instrument)
    second_instrument = MagicMock(spec=Instrument)

    db.scalars.return_value.all.return_value = [
        first_instrument,
        second_instrument,
    ]

    instruments = repository.list()

    assert instruments == [
        first_instrument,
        second_instrument,
    ]

    db.scalars.assert_called_once()


def test_list_active_only():
    db = MagicMock()
    repository = InstrumentRepository(db)

    active_instrument = MagicMock(spec=Instrument)

    db.scalars.return_value.all.return_value = [
        active_instrument,
    ]

    instruments = repository.list(active_only=True)

    assert instruments == [active_instrument]
    db.scalars.assert_called_once()


def test_get_by_id():
    db = MagicMock()
    repository = InstrumentRepository(db)

    instrument = MagicMock(spec=Instrument)
    db.scalar.return_value = instrument

    instrument_id = uuid4()

    result = repository.get_by_id(
        instrument_id=instrument_id,
    )

    assert result == instrument
    db.scalar.assert_called_once()


def test_update():
    db = MagicMock()
    repository = InstrumentRepository(db)

    instrument = MagicMock(spec=Instrument)

    result = repository.update(
        instrument=instrument,
        symbol="TCS",
        trading_symbol="TCS-EQ",
        name="Tata Consultancy Services",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin="INE467B01029",
        lot_size=1,
        tick_size=0.05,
        is_active=False,
    )

    assert result == instrument
    assert instrument.symbol == "TCS"
    assert instrument.trading_symbol == "TCS-EQ"
    assert instrument.name == "Tata Consultancy Services"
    assert instrument.exchange == Exchange.NSE
    assert instrument.instrument_type == InstrumentType.EQUITY
    assert instrument.isin == "INE467B01029"
    assert instrument.lot_size == 1
    assert instrument.tick_size == 0.05
    assert instrument.is_active is False

    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(instrument)


def test_delete():
    db = MagicMock()
    repository = InstrumentRepository(db)

    instrument = MagicMock(spec=Instrument)

    result = repository.delete(
        instrument=instrument,
    )

    assert result is None
    db.delete.assert_called_once_with(instrument)
    db.commit.assert_called_once()
