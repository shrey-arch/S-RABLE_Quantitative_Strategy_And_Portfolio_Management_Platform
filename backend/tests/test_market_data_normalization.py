from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.enums import Timeframe
from app.pipelines.market_data import normalize_market_data
from app.providers.market_data import MarketDataPoint


def test_normalize_market_data():
    instrument_id = uuid4()

    points = [
        MarketDataPoint(
            timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
            open=100,
            high=110,
            low=95,
            close=105,
            volume=1000,
        ),
        MarketDataPoint(
            timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc),
            open=105,
            high=115,
            low=100,
            close=110,
            volume=1200,
        ),
    ]

    result = normalize_market_data(
        instrument_id=instrument_id,
        timeframe=Timeframe.ONE_DAY,
        points=points,
    )

    assert len(result) == 2
    assert result[0].instrument_id == instrument_id
    assert result[0].timeframe is Timeframe.ONE_DAY
    assert result[0].timestamp == points[0].timestamp
    assert result[0].open == 100
    assert result[0].high == 110
    assert result[0].low == 95
    assert result[0].close == 105
    assert result[0].volume == 1000


def test_normalize_market_data_revalidates_ohlc():
    instrument_id = uuid4()

    invalid_point = MarketDataPoint.model_construct(
        timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
        open=100,
        high=90,
        low=95,
        close=105,
        volume=1000,
    )

    with pytest.raises(ValueError):
        normalize_market_data(
            instrument_id=instrument_id,
            timeframe=Timeframe.ONE_DAY,
            points=[invalid_point],
        )


def test_normalize_market_data_empty():
    result = normalize_market_data(
        instrument_id=uuid4(),
        timeframe=Timeframe.ONE_DAY,
        points=[],
    )

    assert result == []
