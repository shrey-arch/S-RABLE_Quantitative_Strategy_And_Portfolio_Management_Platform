from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class InvalidVolumeIssue:
    zero_count: int
    negative_count: int


def find_invalid_volume(data: pd.DataFrame) -> InvalidVolumeIssue:
    if data.empty or "volume" not in data.columns:
        return InvalidVolumeIssue(
            zero_count=0,
            negative_count=0,
        )

    return InvalidVolumeIssue(
        zero_count=int((data["volume"] == 0).sum()),
        negative_count=int((data["volume"] < 0).sum()),
    )
