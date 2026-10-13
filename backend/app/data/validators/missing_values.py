from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class MissingValueIssue:
    columns: dict[str, int]


def find_missing_values(
    data: pd.DataFrame,
    required_columns: list[str],
) -> MissingValueIssue:
    if data.empty:
        return MissingValueIssue(columns={})

    missing_counts = {
        column: int(data[column].isna().sum())
        for column in required_columns
        if column in data.columns and data[column].isna().any()
    }

    return MissingValueIssue(columns=missing_counts)
