from datetime import date
from uuid import uuid4

import pandas as pd
import pytest

from app.data.cache import DatasetValidationError, MarketDatasetCache
from app.data.datasets import MarketDataset
from app.enums import Timeframe


def make_data():
    index = pd.date_range(
        "2026-01-01",
        periods=5,
        freq="D",
        tz="UTC",
        name="timestamp",
    )
    return pd.DataFrame(
        {
            "open": [100.0, 101.0, 102.0, 103.0, 104.0],
            "high": [102.0, 103.0, 104.0, 105.0, 106.0],
            "low": [99.0, 100.0, 101.0, 102.0, 103.0],
            "close": [101.0, 102.0, 103.0, 104.0, 105.0],
            "volume": [1000, 1100, 1200, 1300, 1400],
        },
        index=index,
    )


def make_market_dataset(data=None):
    instrument_id = uuid4()
    dataset = MarketDataset(
        instrument=None,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 5),
        frequency=Timeframe.ONE_DAY,
        ohlcv=make_data() if data is None else data,
        metadata={"instrument_id": str(instrument_id), "row_count": 5},
    )
    return instrument_id, dataset


def make_key(cache, instrument_id):
    return cache.build_key(
        instrument_id=instrument_id,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 5),
        frequency="1d",
        data_version="v1",
        provider="test-provider",
    )


def test_cache_key_is_deterministic(tmp_path):
    cache = MarketDatasetCache(tmp_path)
    instrument_id = uuid4()

    assert make_key(cache, instrument_id) == make_key(cache, instrument_id)


def test_cache_key_changes_when_data_version_changes(tmp_path):
    cache = MarketDatasetCache(tmp_path)
    instrument_id = uuid4()

    first = cache.build_key(
        instrument_id=instrument_id,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 5),
        frequency="1d",
        data_version="v1",
        provider="test-provider",
    )
    second = cache.build_key(
        instrument_id=instrument_id,
        start_date=date(2026, 1, 1),
        end_date=date(2026, 1, 5),
        frequency="1d",
        data_version="v2",
        provider="test-provider",
    )

    assert first != second


def test_put_and_get_persist_dataset(tmp_path):
    cache = MarketDatasetCache(tmp_path)
    instrument_id, dataset = make_market_dataset()
    key = make_key(cache, instrument_id)

    saved = cache.put(
        key=key,
        dataset=dataset,
        provider="test-provider",
        data_version="v1",
    )
    loaded = MarketDatasetCache(tmp_path).get(key)

    assert saved["cache_hit"] is False
    assert loaded is not None
    assert loaded["cache_hit"] is True
    assert loaded["fingerprint"] == saved["fingerprint"]
    pd.testing.assert_frame_equal(loaded["ohlcv"], dataset.ohlcv)


@pytest.mark.parametrize(
    "mutate, message",
    [
        (
            lambda data: data.assign(close=data["close"].where(data.index != data.index[0])),
            "Missing OHLCV values",
        ),
        (
            lambda data: data.assign(close=-1.0),
            "Invalid prices",
        ),
        (
            lambda data: data.assign(volume=-1),
            "Negative volume",
        ),
        (
            lambda data: pd.concat([data, data.iloc[[0]]]).sort_index(),
            "Duplicate timestamps",
        ),
    ],
)
def test_invalid_dataset_is_rejected(tmp_path, mutate, message):
    cache = MarketDatasetCache(tmp_path)
    instrument_id, dataset = make_market_dataset(mutate(make_data()))

    with pytest.raises(DatasetValidationError, match=message):
        cache.put(
            key=make_key(cache, instrument_id),
            dataset=dataset,
            provider="test-provider",
            data_version="v1",
        )


def test_corrupted_cache_entry_is_treated_as_miss(tmp_path):
    cache = MarketDatasetCache(tmp_path)
    instrument_id, _ = make_market_dataset()
    key = make_key(cache, instrument_id)

    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / f"{key}.pkl").write_bytes(b"not a pickle")

    assert cache.get(key) is None



def test_cache_is_readable_from_separate_process(tmp_path):
    import os
    import subprocess
    import sys

    cache = MarketDatasetCache(tmp_path)
    instrument_id, dataset = make_market_dataset()
    key = make_key(cache, instrument_id)

    cache.put(
        key=key,
        dataset=dataset,
        provider="test-provider",
        data_version="v1",
    )

    script = (
        "from pathlib import Path; "
        "from app.data.cache import MarketDatasetCache; "
        f"entry = MarketDatasetCache(Path({str(tmp_path)!r})).get({key!r}); "
        "assert entry is not None; "
        "assert entry['cache_hit'] is True; "
        "print(entry['fingerprint'])"
    )

    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        check=False,
        env=os.environ.copy(),
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip()
