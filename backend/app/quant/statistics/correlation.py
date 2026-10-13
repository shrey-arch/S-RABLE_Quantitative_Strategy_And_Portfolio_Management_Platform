import pandas as pd


def rolling_correlation(
    data: pd.DataFrame,
    column_a: str,
    column_b: str,
    window: int,
) -> pd.Series:
    """Calculate rolling Pearson correlation between two columns."""

    missing_columns = {
        column_a,
        column_b,
    } - set(data.columns)

    if missing_columns:
        raise ValueError(
            f"Input data is missing required columns: "
            f"{sorted(missing_columns)}"
        )

    if window <= 0:
        raise ValueError("window must be greater than 0.")

    return data[column_a].rolling(window=window).corr(data[column_b])
