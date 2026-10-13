import numpy as np
import pandas as pd
import pytest

from app.ml.dataset import prepare_regime_dataset
from app.ml.model import predict_regimes, train_regime_model


def make_data(size=400):
    rng = np.random.default_rng(123)
    index = pd.date_range(
        "2024-01-01",
        periods=size,
        freq="h",
        tz="UTC",
    )
    returns = rng.normal(0, 0.01, size)
    returns[size // 2:] = rng.normal(0, 0.04, size - size // 2)
    close = 100 * np.exp(np.cumsum(returns))
    return pd.DataFrame({"close": close}, index=index)


def make_dataset():
    return prepare_regime_dataset(
        make_data(),
        volatility_window=10,
        trend_window=10,
    )


def test_training_and_prediction_produce_valid_probabilities():
    dataset = make_dataset()
    model, evaluation = train_regime_model(
        dataset,
        candidate_components=(2, 3),
        n_init=2,
    )
    predictions = predict_regimes(model, dataset.features.test)

    probability_columns = [
        f"probability_{i}" for i in range(model.n_components)
    ]
    assert len(predictions) == len(dataset.features.test)
    assert predictions["regime_id"].between(0, model.n_components - 1).all()
    assert predictions["confidence"].between(0, 1).all()
    assert np.allclose(predictions[probability_columns].sum(axis=1), 1.0)
    assert evaluation.test_sample_count == len(dataset.features.test)
    assert np.isfinite(evaluation.validation_bic)
    assert np.isfinite(evaluation.test_bic)


def test_training_is_reproducible():
    dataset = make_dataset()
    first, first_eval = train_regime_model(
        dataset, candidate_components=(2, 3), random_state=42, n_init=2
    )
    second, second_eval = train_regime_model(
        dataset, candidate_components=(2, 3), random_state=42, n_init=2
    )

    np.testing.assert_allclose(
        first.estimator.means_,
        second.estimator.means_,
    )
    assert first.n_components == second.n_components
    assert first_eval.validation_bic == pytest.approx(second_eval.validation_bic)
    assert first_eval.test_bic == pytest.approx(second_eval.test_bic)


def test_scaler_is_fitted_only_on_training_data():
    dataset = make_dataset()
    altered = type(dataset)(
        features=type(dataset.features)(
            train=dataset.features.train,
            validation=dataset.features.validation * 100,
            test=dataset.features.test * 100,
        ),
        training_start=dataset.training_start,
        training_end=dataset.training_end,
        validation_start=dataset.validation_start,
        validation_end=dataset.validation_end,
        test_start=dataset.test_start,
        test_end=dataset.test_end,
        dropped_warmup_rows=dataset.dropped_warmup_rows,
    )

    first, _ = train_regime_model(
        dataset, candidate_components=(2,), n_init=2
    )
    second, _ = train_regime_model(
        altered, candidate_components=(2,), n_init=2
    )

    np.testing.assert_allclose(first.scaler.mean_, second.scaler.mean_)
    np.testing.assert_allclose(first.scaler.scale_, second.scaler.scale_)


def test_rejects_invalid_component_configuration():
    dataset = make_dataset()
    with pytest.raises(ValueError, match="candidate_components"):
        train_regime_model(dataset, candidate_components=())


def test_rejects_missing_prediction_features():
    dataset = make_dataset()
    model, _ = train_regime_model(
        dataset, candidate_components=(2,), n_init=2
    )
    invalid = dataset.features.test.copy()
    invalid.iloc[0, 0] = np.nan

    with pytest.raises(ValueError, match="missing"):
        predict_regimes(model, invalid)
