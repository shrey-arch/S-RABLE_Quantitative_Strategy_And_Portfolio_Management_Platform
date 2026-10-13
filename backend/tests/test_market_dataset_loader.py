from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pandas as pd

from app.data.cache import MarketDatasetCache
from app.data.loaders import MarketDatasetLoader
from app.enums import Timeframe


def make_records(close_values=(101.0, 102.0)):
    timestamps = [
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        datetime(2026, 1, 2, tzinfo=timezone.utc),
    ]
    return [
        SimpleNamespace(
            timestamp=timestamp,
            open=close - 1,
            high=close + 1,
            low=close - 2,
            close=close,
            volume=1000,
        )
        for timestamp, close in zip(timestamps, close_values)
    ]


def make_loader(tmp_path, records):
    loader = MarketDatasetLoader.__new__(MarketDatasetLoader)
    loader.cache = MarketDatasetCache(tmp_path)

    instrument_id = uuid4()
    instrument = SimpleNamespace(id=instrument_id)

    loader.market_data_service = SimpleNamespace(
        validate_instrument=lambda **kwargs: instrument,
        list_market_data=lambda **kwargs: records,
    )

    return loader, instrument_id


def load_dataset(loader, instrument_id):
    return loader.load(
        instrument_id=instrument_id,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 2),
        frequency=Timeframe.ONE_DAY,
    )


def test_loader_reuses_cached_dataset(tmp_path):
    loader, instrument_id = make_loader(tmp_path, make_records())

    first = load_dataset(loader, instrument_id)
    second = load_dataset(loader, instrument_id)

    assert first.metadata["cache_hit"] is False
    assert second.metadata["cache_hit"] is True
    assert first.metadata["dataset_cache_key"] == second.metadata["dataset_cache_key"]
    pd.testing.assert_frame_equal(first.ohlcv, second.ohlcv)


def test_loader_invalidates_cache_when_records_change(tmp_path):
    records = make_records()
    loader, instrument_id = make_loader(tmp_path, records)

    first = load_dataset(loader, instrument_id)

    loader.market_data_service.list_market_data = (
        lambda **kwargs: make_records((111.0, 112.0))
    )
    second = load_dataset(loader, instrument_id)

    assert second.metadata["cache_hit"] is False
    assert first.metadata["dataset_cache_key"] != second.metadata["dataset_cache_key"]
    assert first.metadata["data_fingerprint"] != second.metadata["data_fingerprint"]
    assert second.ohlcv["close"].tolist() == [111.0, 112.0]


def test_loader_records_provenance(tmp_path):
    loader, instrument_id = make_loader(tmp_path, make_records())

    result = load_dataset(loader, instrument_id)

    assert result.metadata["instrument_id"] == str(instrument_id)
    assert result.metadata["provider"]
    assert result.metadata["requested_start_date"] == "2026-01-01"
    assert result.metadata["requested_end_date"] == "2026-01-02"
    assert result.metadata["data_version"]
    assert result.metadata["data_fingerprint"]
    assert result.metadata["data_acquired_at"]
    assert result.metadata["row_count"] == 2
from datetime import datetime, timezone


def test_loader_forwards_exact_timestamp_boundaries(tmp_path):
    loader, instrument_id = make_loader(tmp_path, make_records())

    start = datetime(2026, 1, 1, 12, 30, tzinfo=timezone.utc)
    end = datetime(2026, 1, 2, 15, 45, tzinfo=timezone.utc)
    captured = {}

    def list_market_data(**kwargs):
        captured.update(kwargs)
        return make_records()

    loader.market_data_service.list_market_data = list_market_data

    result = loader.load(
        instrument_id=instrument_id,
        frequency=Timeframe.ONE_DAY,
        start_timestamp=start,
        end_timestamp=end,
    )

    assert captured["start_timestamp"] == start
    assert captured["end_timestamp"] == end
    assert result.metadata["requested_start_timestamp"] == start.isoformat()
    assert result.metadata["requested_end_timestamp"] == end.isoformat()
