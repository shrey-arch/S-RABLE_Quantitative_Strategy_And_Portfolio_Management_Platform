from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.enums import Exchange, InstrumentType
from app.models import Instrument
from app.services.instruments.instrument_service import InstrumentService


def test_create_instrument():
    db = MagicMock()
    service = InstrumentService(db)

    instrument = MagicMock(spec=Instrument)
    service.repository.create = MagicMock(return_value=instrument)

    result = service.create_instrument(
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

    assert result == instrument

    service.repository.create.assert_called_once_with(
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


def test_list_instruments():
    db = MagicMock()
    service = InstrumentService(db)

    instruments = [
        MagicMock(spec=Instrument),
        MagicMock(spec=Instrument),
    ]

    service.repository.list = MagicMock(return_value=instruments)

    result = service.list_instruments(
        active_only=True,
    )

    assert result == instruments

    service.repository.list.assert_called_once_with(
        active_only=True,
    )


def test_get_instrument():
    db = MagicMock()
    service = InstrumentService(db)

    instrument = MagicMock(spec=Instrument)
    service.repository.get_by_id = MagicMock(
        return_value=instrument
    )

    instrument_id = uuid4()

    result = service.get_instrument(
        instrument_id=instrument_id,
    )

    assert result == instrument

    service.repository.get_by_id.assert_called_once_with(
        instrument_id=instrument_id,
    )


def test_update_instrument():
    db = MagicMock()
    service = InstrumentService(db)

    instrument = MagicMock(spec=Instrument)

    service.repository.update = MagicMock(
        return_value=instrument
    )

    result = service.update_instrument(
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

    service.repository.update.assert_called_once_with(
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


def test_delete_instrument():
    db = MagicMock()
    service = InstrumentService(db)

    instrument = MagicMock(spec=Instrument)

    service.repository.has_dependent_records = MagicMock(
        return_value=False
    )
    service.repository.delete = MagicMock(
        return_value=None
    )

    result = service.delete_instrument(
        instrument=instrument,
    )

    assert result is None

    service.repository.delete.assert_called_once_with(
        instrument=instrument,
    )


def test_create_instrument_rejects_duplicate():
    db = MagicMock()
    service = InstrumentService(db)

    from sqlalchemy.exc import IntegrityError

    service.repository.create = MagicMock(
        side_effect=IntegrityError(
            "duplicate",
            {},
            Exception("duplicate"),
        )
    )

    with pytest.raises(
        ValueError,
        match="trading symbol already exists",
    ):
        service.create_instrument(
            symbol="RELIANCE",
            trading_symbol="RELIANCE-EQ",
            name="Reliance Industries",
            exchange=Exchange.NSE,
            instrument_type=InstrumentType.EQUITY,
            isin=None,
            lot_size=1,
            tick_size=0.05,
            is_active=True,
        )

def test_get_required_instrument():
    db = MagicMock()
    service = InstrumentService(db)

    instrument = MagicMock(spec=Instrument)
    service.repository.get_by_id = MagicMock(
        return_value=instrument
    )

    instrument_id = uuid4()

    result = service.get_required_instrument(
        instrument_id=instrument_id,
    )

    assert result is instrument
    service.repository.get_by_id.assert_called_once_with(
        instrument_id=instrument_id,
    )


def test_get_required_instrument_not_found():
    db = MagicMock()
    service = InstrumentService(db)

    service.repository.get_by_id = MagicMock(
        return_value=None
    )

    instrument_id = uuid4()

    with pytest.raises(ValueError, match="Instrument not found\\."):
        service.get_required_instrument(
            instrument_id=instrument_id,
        )


def test_delete_instrument_in_use_is_refused():
    import pytest

    from app.services.instruments.instrument_service import InstrumentInUseError

    db = MagicMock()
    service = InstrumentService(db)
    instrument = MagicMock(spec=Instrument)

    service.repository.has_dependent_records = MagicMock(return_value=True)
    service.repository.delete = MagicMock()

    with pytest.raises(InstrumentInUseError, match="Deactivate it instead"):
        service.delete_instrument(instrument=instrument)

    service.repository.delete.assert_not_called()
