from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class SplitLeakageIssue:
    message: str


def find_split_leakage(
    train: pd.DataFrame,
    validation: pd.DataFrame,
    test: pd.DataFrame,
) -> SplitLeakageIssue | None:
    if train.empty or validation.empty or test.empty:
        return None

    train_end = train.index.max()
    validation_start = validation.index.min()
    validation_end = validation.index.max()
    test_start = test.index.min()

    if train_end >= validation_start:
        return SplitLeakageIssue(
            message="Training data overlaps or extends into validation data."
        )

    if validation_end >= test_start:
        return SplitLeakageIssue(
            message="Validation data overlaps or extends into test data."
        )

    return None
