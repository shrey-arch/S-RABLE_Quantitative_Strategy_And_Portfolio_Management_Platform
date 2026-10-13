import pandas as pd
import pytest

from app.quant.indicators.macd import MACD


def test_macd_calculates_expected_values():
    data = pd.DataFrame(
        {"close": [10, 11, 12, 13, 14, 15]},
        index=pd.date_range("2026-01-01", periods=6),
    )

    result = MACD(2, 4, 2).calculate(data)

    expected_macd = [
        0.0,
        0.266667,
        0.515556,
        0.694519,
        0.811773,
        0.885418,
    ]

    expected_signal = [
        0.0,
        0.177778,
        0.402963,
        0.597333,
        0.740293,
        0.837043,
    ]

    expected_histogram = [
        0.0,
        0.088889,
        0.112593,
        0.097185,
        0.071480,
        0.048375,
    ]

    assert result["macd"].tolist() == pytest.approx(
        expected_macd, abs=1e-6
    )
    assert result["signal"].tolist() == pytest.approx(
        expected_signal, abs=1e-6
    )
    assert result["histogram"].tolist() == pytest.approx(
        expected_histogram, abs=1e-6
    )


def test_macd_rejects_invalid_periods():
    with pytest.raises(ValueError, match="fast_period"):
        MACD(0, 4, 2)

    with pytest.raises(ValueError, match="slow_period"):
        MACD(2, 0, 2)

    with pytest.raises(ValueError, match="signal_period"):
        MACD(2, 4, 0)


def test_macd_requires_fast_period_less_than_slow_period():
    with pytest.raises(ValueError, match="fast_period must be less than slow_period"):
        MACD(4, 4, 2)


def test_macd_requires_close_column():
    data = pd.DataFrame(
        {"open": [10, 11, 12]},
        index=pd.date_range("2026-01-01", periods=3),
    )

    with pytest.raises(ValueError, match="close"):
        MACD(2, 4, 2).calculate(data)
