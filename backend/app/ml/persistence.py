from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import sklearn

from app.ml.features import FEATURE_COLUMNS
from app.ml.model import RegimeModel, RegimeModelEvaluation


ARTIFACT_FORMAT_VERSION = 2
MODEL_VERSION = "gmm-regime-v1"


class ModelArtifactError(ValueError):
    """Raised when a saved regime model artifact is invalid or incompatible."""


def _evaluation_to_dict(evaluation: RegimeModelEvaluation) -> dict[str, Any]:
    return {
        "validation_bic": evaluation.validation_bic,
        "test_bic": evaluation.test_bic,
        "test_sample_count": evaluation.test_sample_count,
        "test_component_counts": {
            str(key): value
            for key, value in evaluation.test_component_counts.items()
        },
        "test_mean_max_probability": evaluation.test_mean_max_probability,
        "test_mean_entropy": evaluation.test_mean_entropy,
    }


def _validate_feature_parameters(parameters: Any) -> dict[str, int]:
    if not isinstance(parameters, dict):
        raise ModelArtifactError("Artifact feature parameters are missing or invalid.")

    validated: dict[str, int] = {}
    for name in ("volatility_window", "trend_window"):
        value = parameters.get(name)
        if isinstance(value, bool) or not isinstance(value, int) or value < 2:
            raise ModelArtifactError(
                "Artifact feature parameters must contain integer windows >= 2."
            )
        validated[name] = value

    return validated

def save_regime_model(
    model: RegimeModel,
    evaluation: RegimeModelEvaluation,
    path: str | Path,
    *,
    training_start: str | datetime,
    training_end: str | datetime,
    model_version: str = MODEL_VERSION,
    feature_parameters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist a trained model and its reproducibility metadata.

    Artifacts must only be loaded from trusted sources because joblib uses
    Python object serialization.
    """
    if not isinstance(model, RegimeModel):
        raise ValueError("model must be a RegimeModel.")
    if not isinstance(evaluation, RegimeModelEvaluation):
        raise ValueError("evaluation must be a RegimeModelEvaluation.")
    if not isinstance(model_version, str) or not model_version.strip():
        raise ValueError("model_version must be a non-empty string.")

    start = str(training_start)
    end = str(training_end)
    if not start or not end or start > end:
        raise ValueError("training period must have a valid start and end.")

    resolved_feature_parameters = _validate_feature_parameters(
        feature_parameters if feature_parameters is not None else {
            "volatility_window": 20,
            "trend_window": 20,
        }
    )

    metadata = {
        "artifact_format_version": ARTIFACT_FORMAT_VERSION,
        "model_version": model_version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "training_start": start,
        "training_end": end,
        "feature_columns": list(model.feature_columns),
        "feature_parameters": resolved_feature_parameters,
        "n_components": model.n_components,
        "random_state": model.random_state,
        "parameters": model.estimator.get_params(deep=False),
        "scaler_parameters": model.scaler.get_params(deep=False),
        "evaluation": _evaluation_to_dict(evaluation),
        "scikit_learn_version": sklearn.__version__,
    }

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {"metadata": metadata, "model": model}

    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            joblib.dump(payload, temporary_file)

        os.replace(temporary_path, target)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()

    return metadata


def load_regime_model(
    path: str | Path,
    *,
    expected_model_version: str | None = None,
) -> tuple[RegimeModel, dict[str, Any]]:
    """Load a compatible model artifact from a trusted local path."""
    target = Path(path)
    if not target.is_file():
        raise FileNotFoundError(f"Model artifact not found: {target}")

    try:
        payload = joblib.load(target)
    except Exception as exc:
        raise ModelArtifactError("Unable to load model artifact.") from exc

    if not isinstance(payload, dict):
        raise ModelArtifactError("Model artifact must contain a dictionary.")

    metadata = payload.get("metadata")
    model = payload.get("model")
    if not isinstance(metadata, dict):
        raise ModelArtifactError("Model artifact metadata is missing or invalid.")

    if metadata.get("artifact_format_version") != ARTIFACT_FORMAT_VERSION:
        raise ModelArtifactError("Unsupported artifact format version.")
    if not isinstance(model, RegimeModel):
        raise ModelArtifactError("Model artifact does not contain a compatible model.")


    _validate_feature_parameters(metadata.get("feature_parameters"))

    if tuple(metadata.get("feature_columns", ())) != FEATURE_COLUMNS:
        raise ModelArtifactError("Artifact feature definitions are incompatible.")
    if tuple(model.feature_columns) != FEATURE_COLUMNS:
        raise ModelArtifactError("Model feature definitions are incompatible.")
    if metadata.get("n_components") != model.n_components:
        raise ModelArtifactError("Artifact component metadata does not match model.")
    if expected_model_version is not None:
        if metadata.get("model_version") != expected_model_version:
            raise ModelArtifactError("Unexpected model version.")

    required_metadata = (
        "model_version",
        "training_start",
        "training_end",
        "parameters",
        "evaluation",
        "scikit_learn_version",
    )
    if any(key not in metadata for key in required_metadata):
        raise ModelArtifactError("Artifact metadata is incomplete.")

    return model, metadata
