from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class DuplicateTimestampIssue:
    timestamps: list[pd.Timestamp]


def find_duplicate_timestamps(data: pd.DataFrame) -> DuplicateTimestampIssue:
    if data.empty:
        return DuplicateTimestampIssue(timestamps=[])

    duplicate_mask = data.index.duplicated(keep=False)
    duplicate_timestamps = sorted(
        data.index[duplicate_mask].unique().tolist()
    )

    return DuplicateTimestampIssue(
        timestamps=duplicate_timestamps
    )
