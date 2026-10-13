import pandas as pd
import pytest

from app.data.datasets import filter_by_date_range, split_dataset
from app.data.validators import (
    find_duplicate_timestamps,
    find_missing_values,
    find_split_leakage,
)


def make_dataset() -> pd.DataFrame:
    index = pd.date_range(
        "2026-01-01",
        periods=10,
        freq="D",
        tz="UTC",
    )

    return pd.DataFrame(
        {
            "open": range(100, 110),
            "high": range(101, 111),
            "low": range(99, 109),
            "close": range(100, 110),
            "volume": range(1000, 1010),
        },
        index=index,
    )


def test_chronological_ordering():
    data = make_dataset()

    assert data.index.is_monotonic_increasing


def test_missing_data_detection():
    data = make_dataset()
    data.loc[data.index[2], "close"] = None

    result = find_missing_values(
        data,
        ["open", "high", "low", "close", "volume"],
    )

    assert result.columns == {"close": 1}


def test_date_filtering():
    data = make_dataset()

    result = filter_by_date_range(
        data,
        start=pd.Timestamp("2026-01-03", tz="UTC").to_pydatetime(),
        end=pd.Timestamp("2026-01-06", tz="UTC").to_pydatetime(),
    )

    assert len(result) == 4
    assert result.index[0] == pd.Timestamp("2026-01-03", tz="UTC")
    assert result.index[-1] == pd.Timestamp("2026-01-06", tz="UTC")


def test_dataset_splitting():
    data = make_dataset()

    result = split_dataset(
        data,
        train_ratio=0.6,
        validation_ratio=0.2,
        test_ratio=0.2,
    )

    assert len(result.train) == 6
    assert len(result.validation) == 2
    assert len(result.test) == 2


def test_no_future_data_leakage():
    data = make_dataset()

    result = split_dataset(
        data,
        train_ratio=0.6,
        validation_ratio=0.2,
        test_ratio=0.2,
    )

    assert find_split_leakage(
        result.train,
        result.validation,
        result.test,
    ) is None

    assert result.train.index.max() < result.validation.index.min()
    assert result.validation.index.max() < result.test.index.min()


def test_reproducibility():
    data = make_dataset()

    first = split_dataset(
        data,
        train_ratio=0.6,
        validation_ratio=0.2,
        test_ratio=0.2,
    )

    second = split_dataset(
        data,
        train_ratio=0.6,
        validation_ratio=0.2,
        test_ratio=0.2,
    )

    pd.testing.assert_frame_equal(first.train, second.train)
    pd.testing.assert_frame_equal(first.validation, second.validation)
    pd.testing.assert_frame_equal(first.test, second.test)


def test_duplicate_timestamp_detection():
    data = make_dataset()
    duplicate = data.iloc[[0]].copy()
    duplicate.index = [data.index[1]]

    data = pd.concat([data, duplicate])

    result = find_duplicate_timestamps(data)

    assert result.timestamps == [pd.Timestamp("2026-01-02", tz="UTC")]
