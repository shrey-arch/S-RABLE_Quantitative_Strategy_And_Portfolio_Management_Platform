import pandas as pd
import pytest

from app.quant.indicators.ema import EMA


def test_ema_calculates_expected_values():
    data = pd.DataFrame(
        {"close": [10, 20, 30, 40, 50]},
        index=pd.date_range("2026-01-01", periods=5),
    )

    result = EMA(3).calculate(data)

    expected = [10.0, 15.0, 22.5, 31.25, 40.625]

    assert result.tolist() == expected


def test_ema_rejects_invalid_window():
    with pytest.raises(ValueError, match="window must be greater than 0"):
        EMA(0)


def test_ema_requires_close_column():
    data = pd.DataFrame(
        {"open": [10, 20]},
        index=pd.date_range("2026-01-01", periods=2),
    )

    with pytest.raises(ValueError, match="close"):
        EMA(2).calculate(data)
