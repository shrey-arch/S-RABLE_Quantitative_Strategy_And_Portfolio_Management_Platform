from datetime import datetime

import pandas as pd


def filter_by_date_range(
    data: pd.DataFrame,
    *,
    start: datetime,
    end: datetime,
) -> pd.DataFrame:
    if end < start:
        raise ValueError("End date must be greater than or equal to start date.")

    if start.tzinfo is None or start.utcoffset() is None:
        raise ValueError("Start date must be timezone-aware.")

    if end.tzinfo is None or end.utcoffset() is None:
        raise ValueError("End date must be timezone-aware.")

    return data.loc[
        (data.index >= start) & (data.index <= end)
    ].copy()
