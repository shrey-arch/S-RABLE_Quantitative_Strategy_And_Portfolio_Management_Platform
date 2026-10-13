import numpy as np
import pandas as pd
import pytest

from app.ml.dataset import prepare_regime_dataset
from app.ml.model import train_regime_model
from app.ml.persistence import save_regime_model
from app.ml.service import RegimeDetectionService


def make_market_data(size=400):
    rng = np.random.default_rng(2026)
    returns = rng.normal(0, 0.01, size)
    returns[size // 2:] = rng.normal(0, 0.035, size - size // 2)
    close = 100 * np.exp(np.cumsum(returns))
    index = pd.date_range("2024-01-01", periods=size, freq="h", tz="UTC")
    return pd.DataFrame({"close": close}, index=index)


@pytest.fixture
def trained_model():
    data = make_market_data()
    dataset = prepare_regime_dataset(
        data,
        volatility_window=10,
        trend_window=10,
    )
    model, evaluation = train_regime_model(
        dataset,
        candidate_components=(2, 3),
        n_init=2,
    )
    return data, dataset, model, evaluation


def test_service_predicts_latest_regime(trained_model):
    data, _, model, _ = trained_model
    service = RegimeDetectionService(
        model,
        model_version="test-model",
        volatility_window=10,
        trend_window=10,
    )
    result = service.predict(data)

    assert result.timestamp == data.index[-1]
    assert 0 <= result.regime_id < model.n_components
    assert 0 <= result.confidence <= 1
    assert result.model_version == "test-model"
    assert sum(result.probabilities.values()) == pytest.approx(1.0)


def test_service_rejects_insufficient_data(trained_model):
    _, _, model, _ = trained_model
    service = RegimeDetectionService(
        model,
        model_version="test-model",
        volatility_window=10,
        trend_window=10,
    )

    with pytest.raises(ValueError, match="Insufficient market data"):
        service.predict(make_market_data(size=5))


def test_service_loads_persisted_model(trained_model, tmp_path):
    data, dataset, model, evaluation = trained_model
    artifact = tmp_path / "regime.joblib"

    save_regime_model(
        model,
        evaluation,
        artifact,
        training_start=dataset.training_start.isoformat(),
        training_end=dataset.training_end.isoformat(),
        model_version="test-model",
        feature_parameters={
            "volatility_window": 10,
            "trend_window": 10,
        },
    )

    service = RegimeDetectionService.from_artifact(
        artifact,
        expected_model_version="test-model",
    )
    result = service.predict(data)

    assert result.model_version == "test-model"
    assert result.timestamp == data.index[-1]


def test_service_rejects_invalid_market_data(trained_model):
    _, _, model, _ = trained_model
    service = RegimeDetectionService(
        model,
        model_version="test-model",
        volatility_window=10,
        trend_window=10,
    )

    with pytest.raises(ValueError, match="close"):
        service.predict(pd.DataFrame({"open": [1, 2, 3]}))

@pytest.mark.parametrize(
    "parameters",
    [
        {"volatility_window": 1, "trend_window": 10},
        {"volatility_window": 10, "trend_window": 1},
        {"volatility_window": True, "trend_window": 10},
    ],
)
def test_service_rejects_invalid_feature_windows(trained_model, parameters):
    _, _, model, _ = trained_model

    with pytest.raises(ValueError, match="window"):
        RegimeDetectionService(
            model,
            model_version="test-model",
            **parameters,
        )

def test_service_uses_feature_windows_saved_in_artifact(trained_model, tmp_path):
    data, dataset, model, evaluation = trained_model
    artifact = tmp_path / "regime.joblib"

    save_regime_model(
        model,
        evaluation,
        artifact,
        training_start=dataset.training_start.isoformat(),
        training_end=dataset.training_end.isoformat(),
        model_version="window-test",
        feature_parameters={
            "volatility_window": 10,
            "trend_window": 10,
        },
    )

    service = RegimeDetectionService.from_artifact(artifact)
    assert service._volatility_window == 10
    assert service._trend_window == 10
    assert service.predict(data).timestamp == data.index[-1]
