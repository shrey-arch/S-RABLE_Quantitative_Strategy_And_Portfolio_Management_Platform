from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from app.data.datasets.split import DatasetSplit, split_dataset
from app.ml.features import generate_regime_features


@dataclass(frozen=True)
class RegimeTrainingDataset:
    """Chronologically partitioned, finite ML features and split metadata."""

    features: DatasetSplit
    training_start: pd.Timestamp
    training_end: pd.Timestamp
    validation_start: pd.Timestamp
    validation_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp
    dropped_warmup_rows: int


def prepare_regime_dataset(
    data: pd.DataFrame,
    *,
    train_ratio: float = 0.70,
    validation_ratio: float = 0.15,
    test_ratio: float = 0.15,
    volatility_window: int = 20,
    trend_window: int = 20,
) -> RegimeTrainingDataset:
    """Generate features and split complete rows chronologically.

    Rolling warm-up rows are excluded before splitting. No imputation or
    fitting is performed here; all fitted preprocessing belongs to training.
    """
    features = generate_regime_features(
        data,
        volatility_window=volatility_window,
        trend_window=trend_window,
    )

    complete = features.dropna(axis=0, how="any")
    dropped = len(features) - len(complete)

    if len(complete) < 3:
        raise ValueError(
            "At least three complete feature rows are required for splitting."
        )

    split = split_dataset(
        complete,
        train_ratio=train_ratio,
        validation_ratio=validation_ratio,
        test_ratio=test_ratio,
    )

    if split.train.empty or split.validation.empty or split.test.empty:
        raise ValueError(
            "Dataset is too small for the requested non-empty chronological splits."
        )

    return RegimeTrainingDataset(
        features=split,
        training_start=split.train.index[0],
        training_end=split.train.index[-1],
        validation_start=split.validation.index[0],
        validation_end=split.validation.index[-1],
        test_start=split.test.index[0],
        test_end=split.test.index[-1],
        dropped_warmup_rows=dropped,
    )
