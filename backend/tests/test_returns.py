import pandas as pd
import pytest

from app.quant.statistics.returns import calculate_returns


def test_returns_calculates_expected_values():
    data = pd.DataFrame(
        {"close": [100, 110, 105, 115]},
        index=pd.date_range("2026-01-01", periods=4),
    )

    result = calculate_returns(data)

    assert pd.isna(result.iloc[0])
    assert result.iloc[1] == pytest.approx(0.1)
    assert result.iloc[2] == pytest.approx(-0.0454545455)
    assert result.iloc[3] == pytest.approx(0.0952380952)


def test_returns_preserves_time_index():
    index = pd.date_range("2026-01-01", periods=3)
    data = pd.DataFrame({"close": [100, 110, 120]}, index=index)

    result = calculate_returns(data)

    assert result.index.equals(index)


def test_returns_requires_close_column():
    data = pd.DataFrame(
        {"open": [100, 110]},
        index=pd.date_range("2026-01-01", periods=2),
    )

    with pytest.raises(ValueError, match="close"):
        calculate_returns(data)
