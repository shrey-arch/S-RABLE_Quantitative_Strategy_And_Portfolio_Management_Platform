import numpy as np
import pandas as pd
import pytest

from app.ml.dataset import prepare_regime_dataset
from app.ml.model import predict_regimes, train_regime_model
from app.ml.persistence import (
    ModelArtifactError,
    load_regime_model,
    save_regime_model,
)


def make_dataset():
    rng = np.random.default_rng(123)
    size = 400
    index = pd.date_range(
        "2024-01-01",
        periods=size,
        freq="h",
        tz="UTC",
    )
    returns = rng.normal(0, 0.01, size)
    returns[size // 2:] = rng.normal(0, 0.04, size - size // 2)
    close = 100 * np.exp(np.cumsum(returns))
    return prepare_regime_dataset(
        pd.DataFrame({"close": close}, index=index),
        volatility_window=10,
        trend_window=10,
    )


def test_model_save_load_round_trip(tmp_path):
    dataset = make_dataset()
    model, evaluation = train_regime_model(
        dataset,
        candidate_components=(2, 3),
        n_init=2,
    )
    artifact_path = tmp_path / "models" / "regime.joblib"

    metadata = save_regime_model(
        model,
        evaluation,
        artifact_path,
        training_start=dataset.training_start.isoformat(),
        training_end=dataset.training_end.isoformat(),
    )

    loaded_model, loaded_metadata = load_regime_model(
        artifact_path,
        expected_model_version="gmm-regime-v1",
    )
    before = predict_regimes(model, dataset.features.test)
    after = predict_regimes(loaded_model, dataset.features.test)

    pd.testing.assert_frame_equal(before, after)
    assert loaded_metadata["model_version"] == metadata["model_version"]
    assert loaded_metadata["training_start"] == str(dataset.training_start.isoformat())
    assert loaded_metadata["feature_columns"] == list(model.feature_columns)


def test_missing_artifact_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError, match="not found"):
        load_regime_model(tmp_path / "missing.joblib")


def test_rejects_wrong_expected_model_version(tmp_path):
    dataset = make_dataset()
    model, evaluation = train_regime_model(
        dataset,
        candidate_components=(2,),
        n_init=2,
    )
    path = tmp_path / "model.joblib"
    save_regime_model(
        model,
        evaluation,
        path,
        training_start=dataset.training_start.isoformat(),
        training_end=dataset.training_end.isoformat(),
    )

    with pytest.raises(ModelArtifactError, match="Unexpected model version"):
        load_regime_model(path, expected_model_version="another-version")


def test_rejects_corrupt_artifact(tmp_path):
    path = tmp_path / "corrupt.joblib"
    path.write_bytes(b"not a joblib artifact")

    with pytest.raises(ModelArtifactError, match="Unable to load"):
        load_regime_model(path)


def test_rejects_invalid_training_period(tmp_path):
    dataset = make_dataset()
    model, evaluation = train_regime_model(
        dataset,
        candidate_components=(2,),
        n_init=2,
    )

    with pytest.raises(ValueError, match="training period"):
        save_regime_model(
            model,
            evaluation,
            tmp_path / "invalid.joblib",
            training_start="2025-01-01",
            training_end="2024-01-01",
        )

def test_rejects_unsupported_artifact_format(tmp_path):
    import joblib

    path = tmp_path / "unsupported.joblib"
    joblib.dump(
        {
            "metadata": {"artifact_format_version": 999},
            "model": None,
        },
        path,
    )

    with pytest.raises(ModelArtifactError, match="Unsupported artifact format"):
        load_regime_model(path)


@pytest.mark.parametrize(
    "feature_parameters",
    [
        None,
        {},
        {"volatility_window": 10},
        {"volatility_window": 1, "trend_window": 10},
        {"volatility_window": 10, "trend_window": True},
        {"volatility_window": "10", "trend_window": 10},
    ],
)
def test_rejects_invalid_feature_parameters(tmp_path, feature_parameters):
    dataset = make_dataset()
    model, evaluation = train_regime_model(
        dataset,
        candidate_components=(2,),
        n_init=2,
    )
    path = tmp_path / "model.joblib"

    metadata = save_regime_model(
        model,
        evaluation,
        path,
        training_start=dataset.training_start.isoformat(),
        training_end=dataset.training_end.isoformat(),
    )

    import joblib

    payload = joblib.load(path)
    payload["metadata"]["feature_parameters"] = feature_parameters
    joblib.dump(payload, path)

    with pytest.raises(ModelArtifactError, match="feature parameters"):
        load_regime_model(path)


@pytest.mark.parametrize(
    "feature_parameters",
    [
        {},
        {"volatility_window": 10},
        {"volatility_window": 1, "trend_window": 10},
        {"volatility_window": 10, "trend_window": True},
        {"volatility_window": "10", "trend_window": 10},
    ],
)
def test_save_rejects_invalid_feature_parameters(
    tmp_path, feature_parameters
):
    dataset = make_dataset()
    model, evaluation = train_regime_model(
        dataset,
        candidate_components=(2,),
        n_init=2,
    )

    path = tmp_path / "invalid-model.joblib"

    with pytest.raises(ModelArtifactError, match="feature parameters"):
        save_regime_model(
            model,
            evaluation,
            path,
            training_start=dataset.training_start.isoformat(),
            training_end=dataset.training_end.isoformat(),
            feature_parameters=feature_parameters,
        )

    assert not path.exists()
