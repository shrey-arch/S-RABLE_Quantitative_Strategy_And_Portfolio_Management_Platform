import pandas as pd

from app.quant.statistics.rolling_mean import rolling_mean
from app.quant.statistics.rolling_std import rolling_std


def rolling_z_score(
    data: pd.DataFrame,
    column: str,
    window: int,
) -> pd.Series:
    """Calculate a rolling z-score for a DataFrame column."""

    if column not in data.columns:
        raise ValueError(f"Input data must contain a '{column}' column.")

    if window <= 0:
        raise ValueError("window must be greater than 0.")

    mean = rolling_mean(data, column, window)
    std = rolling_std(data, column, window)

    return (data[column] - mean) / std
