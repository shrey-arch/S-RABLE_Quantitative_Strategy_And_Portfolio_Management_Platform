import pandas as pd
import pytest

from app.quant.indicators.bollinger import BollingerBands


def test_bollinger_bands_calculates_expected_values():
    data = pd.DataFrame(
        {"close": [10, 20, 30, 40, 50]},
        index=pd.date_range("2026-01-01", periods=5),
    )

    result = BollingerBands(3, 2).calculate(data)

    assert result["middle"].iloc[:2].isna().all()
    assert result["upper"].iloc[:2].isna().all()
    assert result["lower"].iloc[:2].isna().all()

    assert result["middle"].iloc[2] == pytest.approx(20.0)
    assert result["upper"].iloc[2] == pytest.approx(40.0)
    assert result["lower"].iloc[2] == pytest.approx(0.0)

    assert result["middle"].iloc[3] == pytest.approx(30.0)
    assert result["upper"].iloc[3] == pytest.approx(50.0)
    assert result["lower"].iloc[3] == pytest.approx(10.0)

    assert result["middle"].iloc[4] == pytest.approx(40.0)
    assert result["upper"].iloc[4] == pytest.approx(60.0)
    assert result["lower"].iloc[4] == pytest.approx(20.0)


def test_bollinger_bands_returns_nan_for_insufficient_history():
    data = pd.DataFrame(
        {"close": [10, 20]},
        index=pd.date_range("2026-01-01", periods=2),
    )

    result = BollingerBands(3, 2).calculate(data)

    assert result.isna().all().all()


def test_bollinger_bands_rejects_invalid_parameters():
    with pytest.raises(ValueError, match="window must be greater than 0"):
        BollingerBands(0, 2)

    with pytest.raises(ValueError, match="num_std must be non-negative"):
        BollingerBands(3, -1)


def test_bollinger_bands_requires_close_column():
    data = pd.DataFrame(
        {"open": [10, 20, 30]},
        index=pd.date_range("2026-01-01", periods=3),
    )

    with pytest.raises(ValueError, match="close"):
        BollingerBands(3, 2).calculate(data)
