from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class DatasetSplit:
    train: pd.DataFrame
    validation: pd.DataFrame
    test: pd.DataFrame


def split_dataset(
    data: pd.DataFrame,
    *,
    train_ratio: float,
    validation_ratio: float,
    test_ratio: float,
) -> DatasetSplit:
    total_ratio = train_ratio + validation_ratio + test_ratio

    if total_ratio != 1.0:
        raise ValueError("Split ratios must sum to 1.0.")

    if any(
        ratio <= 0
        for ratio in (
            train_ratio,
            validation_ratio,
            test_ratio,
        )
    ):
        raise ValueError("Split ratios must be greater than zero.")

    if not data.index.is_monotonic_increasing:
        raise ValueError("Dataset must be chronologically ordered.")

    total_rows = len(data)
    train_end = int(total_rows * train_ratio)
    validation_end = train_end + int(
        total_rows * validation_ratio
    )

    return DatasetSplit(
        train=data.iloc[:train_end].copy(),
        validation=data.iloc[train_end:validation_end].copy(),
        test=data.iloc[validation_end:].copy(),
    )
