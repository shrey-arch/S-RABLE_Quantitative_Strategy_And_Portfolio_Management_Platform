import numpy as np
import pandas as pd
import pytest

from app.ml.features import FEATURE_COLUMNS, generate_regime_features


def make_data(close):
    index = pd.date_range(
        "2025-01-01",
        periods=len(close),
        freq="h",
        tz="UTC",
    )
    return pd.DataFrame({"close": close}, index=index)


def test_generates_expected_columns_and_preserves_index():
    data = make_data([100, 101, 102, 101, 104, 106, 105])
    result = generate_regime_features(
        data, volatility_window=3, trend_window=3
    )
    assert tuple(result.columns) == FEATURE_COLUMNS
    assert result.index.equals(data.index)


def test_warmup_rows_remain_missing():
    result = generate_regime_features(
        make_data([100, 101, 103, 102, 105, 107]),
        volatility_window=3,
        trend_window=3,
    )
    assert result.iloc[:3].isna().any(axis=None)
    assert result.iloc[3:].notna().all(axis=None)


def test_features_do_not_depend_on_future_prices():
    original = make_data([100, 101, 102, 104, 103, 106, 108])
    changed = original.copy()
    changed.loc[changed.index[5]:, "close"] *= 10
    kwargs = {"volatility_window": 3, "trend_window": 3}

    first = generate_regime_features(original, **kwargs)
    second = generate_regime_features(changed, **kwargs)

    pd.testing.assert_frame_equal(first.iloc[:5], second.iloc[:5])


def test_rejects_missing_close_column():
    with pytest.raises(ValueError, match="close column"):
        generate_regime_features(pd.DataFrame({"open": [1, 2]}))


@pytest.mark.parametrize(
    "values",
    [[100, np.nan, 102], [100, np.inf, 102], [100, 0, 102], [100, -1, 102]],
)
def test_rejects_invalid_close_values(values):
    with pytest.raises(ValueError, match="close"):
        generate_regime_features(make_data(values))


def test_rejects_unsorted_and_duplicate_indexes():
    data = make_data([100, 101, 102])
    with pytest.raises(ValueError, match="unique and chronological"):
        generate_regime_features(data.iloc[::-1])

    duplicate = data.copy()
    duplicate.index = [data.index[0], data.index[0], data.index[2]]
    with pytest.raises(ValueError, match="unique and chronological"):
        generate_regime_features(duplicate)


@pytest.mark.parametrize("window", [0, 1, True, 2.5])
def test_rejects_invalid_volatility_window(window):
    with pytest.raises(ValueError, match="volatility_window"):
        generate_regime_features(
            make_data([100, 101, 102]), volatility_window=window
        )


def test_constant_prices_have_zero_volatility_and_undefined_trend():
    result = generate_regime_features(
        make_data([100] * 8),
        volatility_window=3,
        trend_window=3,
    )
    assert result["realized_volatility"].dropna().eq(0).all()
    assert result["trend_strength"].isna().all()
