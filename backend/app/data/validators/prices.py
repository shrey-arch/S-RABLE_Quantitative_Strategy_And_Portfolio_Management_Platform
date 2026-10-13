from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class InvalidPriceIssue:
    columns: dict[str, int]


def find_invalid_prices(
    data: pd.DataFrame,
    price_columns: list[str],
) -> InvalidPriceIssue:
    if data.empty:
        return InvalidPriceIssue(columns={})

    invalid_counts = {
        column: int((data[column] <= 0).sum())
        for column in price_columns
        if column in data.columns and (data[column] <= 0).any()
    }

    return InvalidPriceIssue(columns=invalid_counts)
