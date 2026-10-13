import pandas as pd


def rolling_mean(data: pd.DataFrame, column: str, window: int) -> pd.Series:
    """Calculate a rolling arithmetic mean for a DataFrame column."""

    if column not in data.columns:
        raise ValueError(f"Input data must contain a '{column}' column.")

    if window <= 0:
        raise ValueError("window must be greater than 0.")

    return data[column].rolling(window=window).mean()
