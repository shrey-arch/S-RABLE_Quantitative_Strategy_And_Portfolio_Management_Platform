import pandas as pd
import pytest

from app.quant.statistics.correlation import rolling_correlation


def test_rolling_correlation_calculates_expected_values():
    data = pd.DataFrame(
        {
            "a": [1, 2, 3, 4, 5],
            "b": [2, 4, 6, 8, 10],
        },
        index=pd.date_range("2026-01-01", periods=5),
    )

    result = rolling_correlation(data, "a", "b", 3)

    assert result.iloc[:2].isna().all()
    assert result.iloc[2] == pytest.approx(1.0)
    assert result.iloc[3] == pytest.approx(1.0)
    assert result.iloc[4] == pytest.approx(1.0)


def test_rolling_correlation_rejects_invalid_window():
    data = pd.DataFrame(
        {
            "a": [1, 2, 3],
            "b": [2, 4, 6],
        }
    )

    with pytest.raises(ValueError, match="window must be greater than 0"):
        rolling_correlation(data, "a", "b", 0)


def test_rolling_correlation_requires_columns():
    data = pd.DataFrame({"a": [1, 2, 3]})

    with pytest.raises(ValueError, match="missing required columns"):
        rolling_correlation(data, "a", "b", 3)


def test_rolling_correlation_preserves_time_index():
    index = pd.date_range("2026-01-01", periods=4)
    data = pd.DataFrame(
        {
            "a": [1, 2, 3, 4],
            "b": [2, 4, 6, 8],
        },
        index=index,
    )

    result = rolling_correlation(data, "a", "b", 2)

    assert result.index.equals(index)
