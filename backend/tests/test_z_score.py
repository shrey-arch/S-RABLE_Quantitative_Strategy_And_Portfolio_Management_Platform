import pandas as pd
import pytest

from app.quant.statistics.z_score import rolling_z_score


def test_z_score_calculates_expected_values():
    data = pd.DataFrame(
        {"value": [10, 20, 30, 40, 50]},
        index=pd.date_range("2026-01-01", periods=5),
    )

    result = rolling_z_score(data, "value", 3)

    assert result.iloc[:2].isna().all()
    assert result.iloc[2] == pytest.approx(1.0)
    assert result.iloc[3] == pytest.approx(1.0)
    assert result.iloc[4] == pytest.approx(1.0)


def test_z_score_rejects_invalid_window():
    data = pd.DataFrame({"value": [10, 20, 30]})

    with pytest.raises(ValueError, match="window must be greater than 0"):
        rolling_z_score(data, "value", 0)


def test_z_score_requires_column():
    data = pd.DataFrame({"price": [10, 20, 30]})

    with pytest.raises(ValueError, match="value"):
        rolling_z_score(data, "value", 3)


def test_z_score_preserves_time_index():
    index = pd.date_range("2026-01-01", periods=4)
    data = pd.DataFrame({"value": [10, 20, 30, 40]}, index=index)

    result = rolling_z_score(data, "value", 2)

    assert result.index.equals(index)
