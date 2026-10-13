import math

import pandas as pd
import pytest

from app.quant.indicators.sma import SMA


def test_sma_calculates_expected_values():
    data = pd.DataFrame(
        {"close": [10, 20, 30, 40, 50]},
        index=pd.date_range("2026-01-01", periods=5),
    )

    result = SMA(3).calculate(data)

    assert math.isnan(result.iloc[0])
    assert math.isnan(result.iloc[1])
    assert result.iloc[2] == 20.0
    assert result.iloc[3] == 30.0
    assert result.iloc[4] == 40.0


def test_sma_returns_nan_for_insufficient_history():
    data = pd.DataFrame(
        {"close": [10, 20]},
        index=pd.date_range("2026-01-01", periods=2),
    )

    result = SMA(3).calculate(data)

    assert result.isna().all()


def test_sma_rejects_invalid_window():
    with pytest.raises(ValueError, match="window must be greater than 0"):
        SMA(0)


def test_sma_requires_close_column():
    data = pd.DataFrame(
        {"open": [10, 20]},
        index=pd.date_range("2026-01-01", periods=2),
    )

    with pytest.raises(ValueError, match="close"):
        SMA(2).calculate(data)
