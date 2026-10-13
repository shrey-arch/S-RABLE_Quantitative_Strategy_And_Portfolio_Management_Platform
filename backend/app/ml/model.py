from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler

from app.ml.dataset import RegimeTrainingDataset
from app.ml.features import FEATURE_COLUMNS


@dataclass
class RegimeModel:
    """A fitted GMM and its training-fitted feature scaler."""

    scaler: StandardScaler
    estimator: GaussianMixture
    feature_columns: tuple[str, ...]
    n_components: int
    random_state: int


@dataclass(frozen=True)
class RegimeModelEvaluation:
    """Evaluation metadata for validation and held-out test observations."""

    validation_bic: float
    test_bic: float
    test_sample_count: int
    test_component_counts: dict[int, int]
    test_mean_max_probability: float
    test_mean_entropy: float


def _validate_features(features: pd.DataFrame, *, minimum_rows: int) -> None:
    if not isinstance(features, pd.DataFrame):
        raise ValueError("features must be a pandas DataFrame.")
    if tuple(features.columns) != FEATURE_COLUMNS:
        raise ValueError("features must have the expected ordered feature columns.")
    if len(features) < minimum_rows:
        raise ValueError(f"At least {minimum_rows} feature rows are required.")
    if features.isna().any(axis=None):
        raise ValueError("features cannot contain missing values.")
    values = features.to_numpy(dtype=float)
    if not np.isfinite(values).all():
        raise ValueError("features must contain only finite numeric values.")


def train_regime_model(
    dataset: RegimeTrainingDataset,
    *,
    candidate_components: tuple[int, ...] = (2, 3, 4),
    random_state: int = 42,
    n_init: int = 5,
) -> tuple[RegimeModel, RegimeModelEvaluation]:
    """Select a GMM by validation BIC, then evaluate once on the test split.

    Scaling is fitted only on training features. The test split is not used
    to select model settings.
    """
    train = dataset.features.train
    validation = dataset.features.validation
    test = dataset.features.test

    _validate_features(train, minimum_rows=2)
    _validate_features(validation, minimum_rows=1)
    _validate_features(test, minimum_rows=1)

    if not candidate_components:
        raise ValueError("candidate_components cannot be empty.")
    if (
        any(
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < 1
            for value in candidate_components
        )
        or len(set(candidate_components)) != len(candidate_components)
    ):
        raise ValueError("candidate_components must be unique positive integers.")
    if any(value >= len(train) for value in candidate_components):
        raise ValueError("Each component count must be smaller than training size.")
    if isinstance(n_init, bool) or not isinstance(n_init, int) or n_init < 1:
        raise ValueError("n_init must be a positive integer.")

    scaler = StandardScaler()
    train_scaled = scaler.fit_transform(train)
    validation_scaled = scaler.transform(validation)

    best_model = None
    best_bic = float("inf")

    for components in candidate_components:
        estimator = GaussianMixture(
            n_components=components,
            covariance_type="full",
            n_init=n_init,
            random_state=random_state,
            reg_covar=1e-6,
        )
        estimator.fit(train_scaled)
        validation_bic = estimator.bic(validation_scaled)

        if np.isfinite(validation_bic) and validation_bic < best_bic:
            best_bic = float(validation_bic)
            best_model = estimator

    if best_model is None:
        raise ValueError("No candidate model produced a finite validation BIC.")

    model = RegimeModel(
        scaler=scaler,
        estimator=best_model,
        feature_columns=FEATURE_COLUMNS,
        n_components=best_model.n_components,
        random_state=random_state,
    )

    test_scaled = scaler.transform(test)
    test_bic = float(best_model.bic(test_scaled))
    probabilities = best_model.predict_proba(test_scaled)
    predictions = probabilities.argmax(axis=1)
    counts = {
        component: int((predictions == component).sum())
        for component in range(best_model.n_components)
    }
    entropy = -np.sum(
        probabilities * np.log(np.clip(probabilities, 1e-12, 1.0)),
        axis=1,
    )

    evaluation = RegimeModelEvaluation(
        validation_bic=best_bic,
        test_bic=test_bic,
        test_sample_count=len(test),
        test_component_counts=counts,
        test_mean_max_probability=float(probabilities.max(axis=1).mean()),
        test_mean_entropy=float(entropy.mean()),
    )
    return model, evaluation


def predict_regimes(
    model: RegimeModel,
    features: pd.DataFrame,
) -> pd.DataFrame:
    """Predict component IDs and posterior membership probabilities."""
    _validate_features(features, minimum_rows=1)
    scaled = model.scaler.transform(features)
    probabilities = model.estimator.predict_proba(scaled)
    labels = probabilities.argmax(axis=1)

    result = pd.DataFrame(
        {
            "regime_id": labels.astype(int),
            "confidence": probabilities.max(axis=1),
        },
        index=features.index,
    )
    for component in range(model.n_components):
        result[f"probability_{component}"] = probabilities[:, component]
    return result
