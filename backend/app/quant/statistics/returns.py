import pandas as pd


def calculate_returns(data: pd.DataFrame) -> pd.Series:
    """Calculate simple percentage returns from closing prices."""

    if "close" not in data.columns:
        raise ValueError("Input data must contain a 'close' column.")

    return data["close"].pct_change()
