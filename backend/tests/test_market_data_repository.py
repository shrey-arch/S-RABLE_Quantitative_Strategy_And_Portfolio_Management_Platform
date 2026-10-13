from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

from app.enums import Timeframe
from app.models import MarketData
from app.repositories.market_data import MarketDataRepository


def test_create():
    db = MagicMock()
    repository = MarketDataRepository(db)

    instrument_id = uuid4()
    timestamp = datetime.now(timezone.utc)

    market_data = repository.create(
        instrument_id=instrument_id,
        timestamp=timestamp,
        timeframe=Timeframe.ONE_DAY,
        open=100.00,
        high=110.00,
        low=95.00,
        close=105.00,
        volume=1000,
    )

    db.add.assert_called_once()
    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(market_data)

    assert market_data.instrument_id == instrument_id
    assert market_data.timestamp == timestamp
    assert market_data.timeframe is Timeframe.ONE_DAY
    assert market_data.open == 100.00
    assert market_data.high == 110.00
    assert market_data.low == 95.00
    assert market_data.close == 105.00
    assert market_data.volume == 1000


def test_list():
    db = MagicMock()
    repository = MarketDataRepository(db)

    first_market_data = MagicMock(spec=MarketData)
    second_market_data = MagicMock(spec=MarketData)

    db.scalars.return_value.all.return_value = [
        first_market_data,
        second_market_data,
    ]

    instrument_id = uuid4()
    start_timestamp = datetime(
        2026,
        1,
        1,
        tzinfo=timezone.utc,
    )
    end_timestamp = datetime(
        2026,
        1,
        31,
        tzinfo=timezone.utc,
    )

    result = repository.list(
        instrument_id=instrument_id,
        start_timestamp=start_timestamp,
        end_timestamp=end_timestamp,
        timeframe=Timeframe.ONE_DAY,
    )

    assert result == [
        first_market_data,
        second_market_data,
    ]

    db.scalars.assert_called_once()


def test_get_by_id():
    db = MagicMock()
    repository = MarketDataRepository(db)

    market_data = MagicMock(spec=MarketData)
    db.scalar.return_value = market_data

    market_data_id = uuid4()

    result = repository.get_by_id(
        market_data_id=market_data_id,
    )

    assert result == market_data
    db.scalar.assert_called_once()
from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

from app.enums import Timeframe
from app.models import MarketData
from app.repositories.market_data import MarketDataRepository


def test_list_by_instrument_date_range_and_timeframe():
    db = MagicMock()
    repository = MarketDataRepository(db)

    instrument_id = uuid4()
    start_timestamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end_timestamp = datetime(2026, 1, 31, tzinfo=timezone.utc)

    first = MagicMock(spec=MarketData)
    second = MagicMock(spec=MarketData)

    db.scalars.return_value.all.return_value = [first, second]

    result = repository.list(
        instrument_id=instrument_id,
        start_timestamp=start_timestamp,
        end_timestamp=end_timestamp,
        timeframe=Timeframe.ONE_DAY,
    )

    assert result == [first, second]
    db.scalars.assert_called_once()
