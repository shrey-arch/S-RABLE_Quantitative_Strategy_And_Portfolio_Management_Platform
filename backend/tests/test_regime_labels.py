"""Phase 12: naming the clusters of a trained regime model."""

import math

import numpy as np
import pandas as pd

from app.ml.dataset import prepare_regime_dataset
from app.ml.labels import TREND_BAND, name_regimes
from app.ml.model import predict_regimes, train_regime_model


def switching_prices(days=600, seed=3):
    """Calm rising stretches alternating with volatile falling ones."""
    rng = np.random.default_rng(seed)
    returns = []
    calm = True
    while len(returns) < days:
        length = int(rng.integers(50, 90))
        drift, vol = (0.0015, 0.005) if calm else (-0.002, 0.025)
        returns.extend(rng.normal(drift, vol, length))
        calm = not calm
    close = 100 * np.exp(np.cumsum(returns[:days]))
    index = pd.date_range("2022-01-03", periods=days, freq="B", tz="UTC")
    return pd.DataFrame({"close": close}, index=index)


def trained(components=(2, 3)):
    dataset = prepare_regime_dataset(switching_prices())
    model, _ = train_regime_model(dataset, candidate_components=components, random_state=7)
    return model, dataset.features.train


def test_names_follow_the_rule_from_the_cluster_centres():
    model, train = trained()
    labels = name_regimes(model, train)
    centres = model.scaler.inverse_transform(model.estimator.means_)
    columns = list(model.feature_columns)
    median = train["realized_volatility"].median()
    assert labels["median_training_volatility"] == median
    assert len(labels["regimes"]) == model.n_components
    assigned = predict_regimes(model, train)["regime_id"]
    for row in labels["regimes"]:
        centre = centres[row["regime_id"]]
        vol = centre[columns.index("realized_volatility")]
        trend = centre[columns.index("trend_strength")]
        assert row["mean_realized_volatility"] == vol
        assert row["mean_trend_strength"] == trend
        assert row["volatility_state"] == ("High volatility" if vol > median else "Low volatility")
        expected_trend = "Uptrend" if trend > TREND_BAND else "Downtrend" if trend < -TREND_BAND else "Sideways"
        assert row["trend_state"] == expected_trend
        assert row["name"].startswith(f"{row['volatility_state']}, {expected_trend.lower()}")
        assert row["annualized_volatility"] == vol * math.sqrt(252)
        assert row["training_days"] == int((assigned == row["regime_id"]).sum())
    # The calm and the volatile stretches are told apart.
    states = {(r["volatility_state"], r["trend_state"]) for r in labels["regimes"]}
    assert ("Low volatility", "Uptrend") in states
    assert any(v == "High volatility" for v, _ in states)
    # Codes go from the calmest to the most volatile.
    ordered = sorted(labels["regimes"], key=lambda r: r["mean_realized_volatility"])
    assert [r["code"] for r in ordered] == [f"R{i}" for i in range(1, len(ordered) + 1)]
    assert [r["code"] for r in labels["regimes"]] == [r["code"] for r in ordered]
    assert "median of the training days" in labels["rule"]


def test_clusters_with_the_same_description_get_letters():
    model, train = trained(components=(3,))
    # Put every centre on the same side of the median and the same trend, with
    # different volatilities: all three get the same description.
    vol = list(model.feature_columns).index("realized_volatility")
    trend = list(model.feature_columns).index("trend_strength")
    centres = model.scaler.inverse_transform(model.estimator.means_)
    high = train["realized_volatility"].median() * 2
    centres[:, vol] = [high * 1.5, high, high * 2]
    centres[:, trend] = 0.0
    model.estimator.means_ = model.scaler.transform(
        pd.DataFrame(centres, columns=list(model.feature_columns))
    )
    labels = name_regimes(model, train)
    names = {r["regime_id"]: r["name"] for r in labels["regimes"]}
    assert names == {
        1: "High volatility, sideways A",
        0: "High volatility, sideways B",
        2: "High volatility, sideways C",
    }
    assert {r["regime_id"]: r["code"] for r in labels["regimes"]} == {1: "R1", 0: "R2", 2: "R3"}
