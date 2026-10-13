import pandas as pd
import pytest

from app.quant.statistics.rolling_std import rolling_std


def test_rolling_std_calculates_expected_values():
    data = pd.DataFrame(
        {"value": [10, 20, 30, 40, 50]},
        index=pd.date_range("2026-01-01", periods=5),
    )

    result = rolling_std(data, "value", 3)

    assert result.iloc[:2].isna().all()
    assert result.iloc[2] == pytest.approx(10.0)
    assert result.iloc[3] == pytest.approx(10.0)
    assert result.iloc[4] == pytest.approx(10.0)


def test_rolling_std_rejects_invalid_window():
    data = pd.DataFrame({"value": [10, 20, 30]})

    with pytest.raises(ValueError, match="window must be greater than 0"):
        rolling_std(data, "value", 0)


def test_rolling_std_requires_column():
    data = pd.DataFrame({"price": [10, 20, 30]})

    with pytest.raises(ValueError, match="value"):
        rolling_std(data, "value", 3)


def test_rolling_std_preserves_time_index():
    index = pd.date_range("2026-01-01", periods=4)
    data = pd.DataFrame({"value": [10, 20, 30, 40]}, index=index)

    result = rolling_std(data, "value", 2)

    assert result.index.equals(index)
