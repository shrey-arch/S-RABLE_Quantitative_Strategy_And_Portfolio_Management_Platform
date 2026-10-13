import pandas as pd
import pytest

from app.quant.indicators.atr import ATR


def test_atr_calculates_expected_values():
    data = pd.DataFrame(
        {
            "high": [12, 14, 15, 17, 16],
            "low": [9, 10, 12, 13, 14],
            "close": [10, 13, 14, 15, 15],
        },
        index=pd.date_range("2026-01-01", periods=5),
    )

    result = ATR(3).calculate(data)

    assert result.iloc[:2].isna().all()

    expected = [
        3.222222,
        3.481481,
        2.987654,
    ]

    assert result.iloc[2:].tolist() == pytest.approx(
        expected,
        abs=1e-6,
    )


def test_atr_returns_nan_for_insufficient_history():
    data = pd.DataFrame(
        {
            "high": [12, 14],
            "low": [9, 10],
            "close": [10, 13],
        },
        index=pd.date_range("2026-01-01", periods=2),
    )

    result = ATR(3).calculate(data)

    assert result.isna().all()


def test_atr_rejects_invalid_period():
    with pytest.raises(ValueError, match="period must be greater than 0"):
        ATR(0)


def test_atr_requires_ohlc_columns():
    data = pd.DataFrame(
        {
            "high": [12, 14],
            "low": [9, 10],
        },
        index=pd.date_range("2026-01-01", periods=2),
    )

    with pytest.raises(ValueError, match="close"):
        ATR(3).calculate(data)
import pandas as pd

from app.quant.indicators.atr import ATR


def test_atr_handles_nan_input_without_crashing():
    data = pd.DataFrame(
        {
            "high": [12, 14, float("nan"), 17, 16, 18],
            "low": [9, 10, float("nan"), 13, 14, 15],
            "close": [10, 13, float("nan"), 15, 15, 17],
        },
        index=pd.date_range("2026-01-01", periods=6),
    )

    result = ATR(3).calculate(data)

    assert len(result) == len(data)
    assert result.index.equals(data.index)
    assert result.iloc[2] != result.iloc[2]
