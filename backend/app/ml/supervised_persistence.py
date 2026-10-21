"""Saving and loading supervised regime models (Feature 2).

The Gaussian mixture keeps its own format (app.ml.persistence); old GMM
artifacts load exactly as before. Artifacts must only be loaded from trusted
sources (the regime_models table, written by the backend), because joblib uses
Python object serialization.
"""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import sklearn

from app.ml.persistence import ModelArtifactError
from app.ml.supervised import DIMENSIONS, SupervisedRegimeModel

ARTIFACT_FORMAT_VERSION = 1
MODEL_VERSION = "supervised-regime-v1"


def xgboost_version() -> str | None:
    try:
        import xgboost

        return xgboost.__version__
    except ImportError:  # only needed when a model uses XGBoost
        return None


def save_supervised_model(
    model: SupervisedRegimeModel,
    path: str | Path,
    *,
    training_start: str,
    training_end: str,
) -> dict[str, Any]:
    if not isinstance(model, SupervisedRegimeModel):
        raise ValueError("model must be a SupervisedRegimeModel.")
    metadata = {
        "artifact_format_version": ARTIFACT_FORMAT_VERSION,
        "model_version": MODEL_VERSION,
        "model_kind": model.model_kind,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "training_start": str(training_start),
        "training_end": str(training_end),
        "horizon_days": model.horizon,
        "feature_columns": list(model.feature_columns),
        "random_state": model.random_state,
        "dimension_kinds": {key: model.dimensions[key].kind for key in DIMENSIONS},
        "dimension_parameters": {key: model.dimensions[key].params for key in DIMENSIONS},
        "scikit_learn_version": sklearn.__version__,
        "xgboost_version": xgboost_version(),
    }
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=target.parent, prefix=f".{target.name}.", suffix=".tmp", delete=False
        ) as handle:
            temporary = Path(handle.name)
            joblib.dump({"metadata": metadata, "model": model}, handle)
        os.replace(temporary, target)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return metadata


def load_supervised_model(path: str | Path) -> tuple[SupervisedRegimeModel, dict[str, Any]]:
    target = Path(path)
    if not target.is_file():
        raise FileNotFoundError(f"Model artifact not found: {target}")
    try:
        payload = joblib.load(target)
    except Exception as exc:
        raise ModelArtifactError(
            "Unable to load the supervised model artifact (is xgboost installed?)."
        ) from exc
    if not isinstance(payload, dict):
        raise ModelArtifactError("Model artifact must contain a dictionary.")
    metadata, model = payload.get("metadata"), payload.get("model")
    if not isinstance(metadata, dict) or metadata.get("artifact_format_version") != ARTIFACT_FORMAT_VERSION:
        raise ModelArtifactError("Unsupported supervised artifact format.")
    if metadata.get("model_version") != MODEL_VERSION:
        raise ModelArtifactError("Unexpected model version.")
    if not isinstance(model, SupervisedRegimeModel) or set(model.dimensions) != set(DIMENSIONS):
        raise ModelArtifactError("Model artifact does not contain a compatible supervised model.")
    if list(model.feature_columns) != metadata.get("feature_columns"):
        raise ModelArtifactError("Artifact feature definitions are incompatible.")
    return model, metadata
