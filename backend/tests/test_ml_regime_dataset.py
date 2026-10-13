import numpy as np
import pandas as pd
import pytest

from app.ml.dataset import prepare_regime_dataset


def make_data(size=200):
    index = pd.date_range(
        "2025-01-01",
        periods=size,
        freq="h",
        tz="UTC",
    )
    close = 100 * np.exp(np.cumsum(np.random.default_rng(42).normal(0, 0.01, size)))
    return pd.DataFrame({"close": close}, index=index)


def test_dataset_splits_are_chronological_and_non_overlapping():
    result = prepare_regime_dataset(make_data())

    train = result.features.train
    validation = result.features.validation
    test = result.features.test

    assert not train.empty
    assert not validation.empty
    assert not test.empty
    assert train.index.max() < validation.index.min()
    assert validation.index.max() < test.index.min()
    assert list(train.columns) == [
        "log_return",
        "realized_volatility",
        "trend_strength",
    ]


def test_dataset_records_boundaries_and_dropped_warmup_rows():
    data = make_data()
    result = prepare_regime_dataset(
        data,
        volatility_window=10,
        trend_window=10,
    )

    assert result.dropped_warmup_rows == 10
    assert result.training_start == result.features.train.index[0]
    assert result.training_end == result.features.train.index[-1]
    assert result.validation_start == result.features.validation.index[0]
    assert result.test_end == result.features.test.index[-1]


def test_rejects_too_small_dataset():
    with pytest.raises(ValueError, match="complete feature rows"):
        prepare_regime_dataset(
            make_data(4),
            volatility_window=3,
            trend_window=3,
        )


def test_rejects_split_that_creates_empty_partition():
    with pytest.raises(ValueError, match="non-empty"):
        prepare_regime_dataset(
            make_data(10),
            train_ratio=0.90,
            validation_ratio=0.05,
            test_ratio=0.05,
            volatility_window=2,
            trend_window=2,
        )


def test_dataset_splits_are_reproducible():
    data = make_data()
    first = prepare_regime_dataset(data)
    second = prepare_regime_dataset(data)

    pd.testing.assert_frame_equal(first.features.train, second.features.train)
    pd.testing.assert_frame_equal(
        first.features.validation,
        second.features.validation,
    )
    pd.testing.assert_frame_equal(first.features.test, second.features.test)
