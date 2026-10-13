import math

import pandas as pd
import pytest

from app.quant.indicators.rsi import RSI


def test_rsi_calculates_expected_values():
    data = pd.DataFrame(
        {"close": [1, 2, 3, 4, 3, 2, 3, 4, 5, 4]},
        index=pd.date_range("2026-01-01", periods=10),
    )

    result = RSI(3).calculate(data)

    expected = [
        math.nan,
        math.nan,
        math.nan,
        100.0,
        66.6667,
        44.4444,
        62.9630,
        75.3086,
        83.5391,
        55.6927,
    ]

    assert result.iloc[:3].isna().all()

    for actual, expected_value in zip(result.iloc[3:], expected[3:]):
        assert actual == pytest.approx(expected_value, abs=1e-4)


def test_rsi_rejects_invalid_period():
    with pytest.raises(ValueError, match="period must be greater than 0"):
        RSI(0)


def test_rsi_requires_close_column():
    data = pd.DataFrame(
        {"open": [10, 20, 30]},
        index=pd.date_range("2026-01-01", periods=3),
    )

    with pytest.raises(ValueError, match="close"):
        RSI(3).calculate(data)


def test_rsi_returns_nan_for_insufficient_history():
    data = pd.DataFrame(
        {"close": [10, 11, 12]},
        index=pd.date_range("2026-01-01", periods=3),
    )

    result = RSI(14).calculate(data)

    assert result.isna().all()
