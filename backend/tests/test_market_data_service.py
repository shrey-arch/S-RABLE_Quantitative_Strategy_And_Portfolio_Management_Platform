from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.enums import Timeframe
from app.models import Instrument, MarketData
from app.schemas.market_data import CreateMarketDataRequest
from app.services.market_data import MarketDataService


def test_create_market_data():
    db = MagicMock()
    service = MarketDataService(db)

    instrument = MagicMock(spec=Instrument)
    market_data = MagicMock(spec=MarketData)

    instrument_id = uuid4()
    timestamp = datetime.now(timezone.utc)

    service.instrument_service.get_required_instrument = MagicMock(
        return_value=instrument
    )
    service.repository.create = MagicMock(
        return_value=market_data
    )

    data = CreateMarketDataRequest(
        instrument_id=instrument_id,
        timestamp=timestamp,
        timeframe=Timeframe.ONE_DAY,
        open=100,
        high=110,
        low=95,
        close=105,
        volume=1000,
    )

    result = service.create_market_data(data=data)

    assert result is market_data

    service.instrument_service.get_required_instrument.assert_called_once_with(
        instrument_id=instrument_id,
    )

    service.repository.create.assert_called_once_with(
        instrument_id=instrument_id,
        timestamp=timestamp,
        timeframe=Timeframe.ONE_DAY,
        open=100.0,
        high=110.0,
        low=95.0,
        close=105.0,
        volume=1000,
    )


def test_create_market_data_rejects_missing_instrument():
    db = MagicMock()
    service = MarketDataService(db)

    instrument_id = uuid4()

    service.instrument_service.get_required_instrument = MagicMock(
        side_effect=ValueError("Instrument not found.")
    )
    service.repository.create = MagicMock()

    data = CreateMarketDataRequest(
        instrument_id=instrument_id,
        timestamp=datetime.now(timezone.utc),
        timeframe=Timeframe.ONE_DAY,
        open=100,
        high=110,
        low=95,
        close=105,
        volume=1000,
    )

    with pytest.raises(ValueError, match="Instrument not found\\."):
        service.create_market_data(data=data)

    service.repository.create.assert_not_called()


def test_list_market_data():
    db = MagicMock()
    service = MarketDataService(db)

    instrument_id = uuid4()
    market_data = [
        MagicMock(spec=MarketData),
        MagicMock(spec=MarketData),
    ]

    start_timestamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end_timestamp = datetime(2026, 1, 31, tzinfo=timezone.utc)

    service.instrument_service.get_required_instrument = MagicMock()
    service.repository.list = MagicMock(
        return_value=market_data
    )

    result = service.list_market_data(
        instrument_id=instrument_id,
        start_timestamp=start_timestamp,
        end_timestamp=end_timestamp,
        timeframe=Timeframe.ONE_DAY,
    )

    assert result == market_data

    service.instrument_service.get_required_instrument.assert_called_once_with(
        instrument_id=instrument_id,
    )

    service.repository.list.assert_called_once_with(
        instrument_id=instrument_id,
        start_timestamp=start_timestamp,
        end_timestamp=end_timestamp,
        timeframe=Timeframe.ONE_DAY,
    )


def test_get_market_data():
    db = MagicMock()
    service = MarketDataService(db)

    market_data_id = uuid4()
    market_data = MagicMock(spec=MarketData)

    service.repository.get_by_id = MagicMock(
        return_value=market_data
    )

    result = service.get_market_data(
        market_data_id=market_data_id,
    )

    assert result is market_data

    service.repository.get_by_id.assert_called_once_with(
        market_data_id=market_data_id,
    )
