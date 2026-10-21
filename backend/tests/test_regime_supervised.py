"""Feature 2: supervised regime models (Random Forest, XGBoost) with an honest
out-of-sample accuracy. Features are causal, labels look ahead, the splits are
purged, the same seed gives the same model, and every figure equals scikit-learn's."""

from uuid import uuid4

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sqlalchemy import delete

from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import Exchange, InstrumentType, Timeframe
from app.main import app
from app.ml import supervised as sup
from app.ml.supervised_persistence import load_supervised_model, save_supervised_model
from app.models import Instrument, MarketData, RegimeModelRecord, User
from app.providers.market_data.yahoo_finance import yahoo_symbol_for
from app.services.instruments.instrument_service import InstrumentService
from app.services.portfolio.user_portfolio import regime_label
from app.services.regime import service as regime
from app.services.scoring.service import current_regime
from tests.regime_synth import synthetic_market

client = TestClient(app)
DAYS = 1100
SMALL_GRIDS = {
    "RF": ({"max_depth": 4, "min_samples_leaf": 20}, {"max_depth": None, "min_samples_leaf": 40}),
    "XGB": ({"max_depth": 2, "n_estimators": 60}, {"max_depth": 3, "n_estimators": 60}),
}


@pytest.fixture(autouse=True)
def quick_models(monkeypatch):
    """The same code with smaller grids and forests, so the suite stays fast."""
    monkeypatch.setattr(sup, "RF_GRID", SMALL_GRIDS["RF"])
    monkeypatch.setattr(sup, "XGB_GRID", SMALL_GRIDS["XGB"])
    monkeypatch.setitem(sup.RF_FIXED, "n_estimators", 60)


@pytest.fixture(scope="module")
def market():
    return synthetic_market(DAYS, seed=11)


@pytest.fixture(scope="module")
def dataset(market):
    data, vix = market
    return sup.prepare_dataset(data, vix, horizon=20)


# --- features and labels ----------------------------------------------------------


def test_features_are_causal(market):
    data, vix = market
    full = sup.generate_features(data, vix, use_volume=True)
    for cut in (300, 640, 900):
        part = sup.generate_features(data.iloc[:cut], vix.iloc[:cut], use_volume=True)
        pd.testing.assert_series_equal(part.iloc[-1], full.iloc[cut - 1], check_names=False)
    assert list(full.columns) == list(sup.PRICE_FEATURES + sup.VOLUME_FEATURES + sup.VIX_FEATURES)
    # The 252-day high needs 252 days; nothing is filled in before that.
    assert full["distance_from_252d_high"].iloc[:251].isna().all()


def test_volume_is_a_feature_only_when_most_bars_have_it_and_it_varies(market):
    data, _ = market
    assert sup.volume_usable(data)
    assert not sup.volume_usable(data.assign(volume=10_000))  # never changes
    zeroed = data.assign(volume=data["volume"].where(np.arange(len(data)) % 3 != 0, 0))
    assert not sup.volume_usable(zeroed)  # a third of the bars have none
    assert list(sup.generate_features(data, None).columns) == list(sup.PRICE_FEATURES)


def test_labels_describe_the_next_horizon_days(market):
    data, vix = market
    close = data["close"]
    outcomes = sup.forward_outcomes(close, vix, 20)
    t = 400
    window = close.iloc[t + 1 : t + 21]
    assert outcomes["forward_return"].iloc[t] == pytest.approx(close.iloc[t + 20] / close.iloc[t] - 1)
    assert outcomes["forward_min_return"].iloc[t] == pytest.approx(window.min() / close.iloc[t] - 1)
    returns = np.log(close).diff().iloc[t + 1 : t + 21]
    assert outcomes["forward_volatility"].iloc[t] == pytest.approx(returns.std(ddof=1) * np.sqrt(252))
    assert outcomes["forward_vix_mean"].iloc[t] == pytest.approx(vix.iloc[t + 1 : t + 21].mean())
    assert outcomes["forward_return"].iloc[-20:].isna().all()
    labels = sup.make_labels(outcomes, volatility_threshold=0.2)
    row = outcomes.iloc[t]
    expected_trend = (
        "Uptrend" if row.forward_return > 0.02 else "Downtrend" if row.forward_return < -0.02 else "Sideways"
    )
    assert labels["trend"].iloc[t] == expected_trend
    off = row.forward_min_return < -0.05 or row.forward_vix_mean > row.vix_median_1y
    assert labels["risk"].iloc[t] == ("Risk-off" if off else "Risk-on")
    assert labels.iloc[-20:].isna().all(axis=None)


def test_the_purge_gap_keeps_label_windows_out_of_the_next_split(dataset):
    pos = dataset.positions
    h = dataset.horizon
    assert pos[dataset.train].max() + h < pos[dataset.validation].min()
    assert pos[dataset.validation].max() + h < pos[dataset.test].min()
    assert [p["dropped_rows"] for p in dataset.purges] == [h, h]
    for fit_rows, score_rows in sup.walk_forward_folds(dataset):
        assert pos[fit_rows].max() + h < pos[score_rows].min()
        assert score_rows.min() > fit_rows.max()
    # The volatility threshold is the median of the training days only.
    assert dataset.volatility_threshold == pytest.approx(
        dataset.outcomes.loc[dataset.train, "forward_volatility"].median()
    )


# --- models and metrics -----------------------------------------------------------


def test_the_same_seed_gives_the_same_model_and_metrics(dataset):
    model_a, eval_a = sup.train_supervised(dataset, model_kind="AUTO", random_state=5)
    model_b, eval_b = sup.train_supervised(dataset, model_kind="AUTO", random_state=5)
    assert eval_a == eval_b
    rows = dataset.features.loc[dataset.test]
    pd.testing.assert_frame_equal(
        sup.predict_supervised(model_a, rows), sup.predict_supervised(model_b, rows)
    )


def test_metrics_equal_sklearn_and_the_baselines(dataset):
    model, evaluation = sup.train_supervised(dataset, model_kind="RF", random_state=3)
    predicted = sup.predict_supervised(model, dataset.features.loc[dataset.test])
    for dim in evaluation["dimensions"]:
        key, classes = dim["key"], dim["classes"]
        assert dim["chosen_kind"] == "RF" and [c["kind"] for c in dim["candidates"]] == ["RF"]
        y_true = dataset.labels.loc[dataset.test, key].to_numpy()
        y_pred = predicted[f"{key}_label"].to_numpy()
        test = dim["test"]
        assert test["rows"] == len(dataset.test)
        assert test["accuracy"] == pytest.approx(accuracy_score(y_true, y_pred))
        assert test["balanced_accuracy"] == pytest.approx(balanced_accuracy_score(y_true, y_pred))
        assert test["confusion_matrix"] == confusion_matrix(y_true, y_pred, labels=classes).tolist()
        precision, recall, _, support = precision_recall_fscore_support(
            y_true, y_pred, labels=classes, zero_division=0
        )
        assert [c["precision"] for c in test["per_class"]] == pytest.approx(list(precision))
        assert [c["recall"] for c in test["per_class"]] == pytest.approx(list(recall))
        assert [c["support"] for c in test["per_class"]] == list(support)
        assert test["meets_target"] == (test["accuracy"] >= 0.70)
        majority, persistence = test["baselines"]
        train_labels = dataset.labels.loc[dataset.train, key]
        common = max(classes, key=lambda c: ((train_labels == c).sum(), -classes.index(c)))
        assert majority["accuracy"] == pytest.approx(float((y_true == common).mean()))
        previous = dataset.labels[key].shift(dataset.horizon).loc[dataset.test].to_numpy()
        assert persistence["accuracy"] == pytest.approx(float((previous == y_true).mean()))
        assert test["beats_baselines"] == (
            test["accuracy"] > majority["accuracy"] and test["accuracy"] > persistence["accuracy"]
        )
        assert sum(r["importance"] for r in dim["feature_importance"]) == pytest.approx(1.0)
    accuracies = [d["test"]["accuracy"] for d in evaluation["dimensions"]]
    assert evaluation["summary"]["mean_accuracy"] == pytest.approx(np.mean(accuracies))


def test_auto_keeps_the_better_kind_on_validation(dataset):
    _, evaluation = sup.train_supervised(dataset, model_kind="AUTO", random_state=1)
    for dim in evaluation["dimensions"]:
        assert [c["kind"] for c in dim["candidates"]] == ["RF", "XGB"]
        best = max(dim["candidates"], key=lambda c: c["validation"]["balanced_accuracy"])
        assert dim["chosen_kind"] == best["kind"]
        for c in dim["candidates"]:
            scored = [g for g in c["grid"] if g["cv_balanced_accuracy"] is not None]
            assert c["cv_balanced_accuracy"] == max(g["cv_balanced_accuracy"] for g in scored)


def test_combined_regime_probabilities(dataset):
    model, _ = sup.train_supervised(dataset, model_kind="XGB", random_state=2)
    out = sup.predict_supervised(model, dataset.features.loc[dataset.test[:50]])
    probabilities = out[[f"probability_{c['regime_id']}" for c in sup.combos()]]
    assert np.allclose(probabilities.sum(axis=1), 1.0)
    first = out.iloc[0]
    combo = sup.combos()[int(first["regime_id"])]
    assert (combo["volatility_state"], combo["trend_state"], combo["risk_state"]) == (
        first["volatility_label"],
        first["trend_label"],
        first["risk_label"],
    )
    assert first["confidence"] == pytest.approx(
        first["volatility_probability"] * first["trend_probability"] * first["risk_probability"]
    )


def test_the_artifact_round_trips(dataset, tmp_path):
    model, _ = sup.train_supervised(dataset, model_kind="AUTO", random_state=4)
    saved = save_supervised_model(model, tmp_path / "m.joblib", training_start="a", training_end="b")
    loaded, metadata = load_supervised_model(tmp_path / "m.joblib")
    assert metadata == saved and metadata["model_version"] == "supervised-regime-v1"
    rows = dataset.features.loc[dataset.test]
    pd.testing.assert_frame_equal(sup.predict_supervised(model, rows), sup.predict_supervised(loaded, rows))


def test_too_little_data_is_refused(market):
    data, vix = market
    with pytest.raises(ValueError, match="at least 500"):
        sup.prepare_dataset(data.iloc[:600], vix.iloc[:600])


# --- Yahoo symbols for indices (Step 0) -------------------------------------------


@pytest.mark.parametrize(
    ("symbol", "kind", "expected"),
    [
        ("NIFTY50", InstrumentType.INDEX, "^NSEI"),
        ("INDIAVIX", InstrumentType.INDEX, "^INDIAVIX"),
        ("^NSEBANK", InstrumentType.INDEX, "^NSEBANK"),
        ("NIFTYBEES", InstrumentType.ETF, "NIFTYBEES.NS"),
        ("RELIANCE", InstrumentType.EQUITY, "RELIANCE.NS"),
    ],
)
def test_yahoo_symbols(symbol, kind, expected):
    instrument = Instrument(symbol=symbol, exchange=Exchange.NSE, instrument_type=kind)
    assert yahoo_symbol_for(instrument) == expected


def test_unknown_index_or_exchange_is_refused():
    with pytest.raises(ValueError, match="NIFTY50 or INDIAVIX"):
        yahoo_symbol_for(Instrument(symbol="MIDCAP", exchange=Exchange.NSE, instrument_type=InstrumentType.INDEX))
    with pytest.raises(ValueError, match="NSE equities, ETFs and indices"):
        yahoo_symbol_for(Instrument(symbol="GOLDM", exchange=Exchange.MCX, instrument_type=InstrumentType.FUTURES))


# --- API --------------------------------------------------------------------------


def _add(db, symbol, kind, frame: pd.DataFrame):
    instrument = InstrumentService(db).create_instrument(
        symbol=symbol,
        trading_symbol=f"{symbol}-{uuid4().hex[:6]}",
        name=symbol,
        exchange=Exchange.NSE,
        instrument_type=kind,
        isin=None,
        lot_size=1,
        tick_size=0.05,
    )
    for timestamp, row in frame.iterrows():
        # float(), not the pandas value as it comes. A value out of a DataFrame is a
        # numpy scalar, and numpy 2 changed how one prints itself: repr(np.float64(1.5))
        # is now "np.float64(1.5)", not "1.5". psycopg2 builds its SQL by printing the
        # parameters, so the statement reaches Postgres containing np.float64(...) and
        # is refused with 'schema "np" does not exist'. psycopg3 binds parameters
        # without printing them and does not care, which is why this passed on one
        # machine and not another. Everything the database is given is a plain Python
        # number.
        close = float(row["close"])
        db.add(
            MarketData(
                instrument_id=instrument.id,
                timestamp=timestamp.to_pydatetime(),
                timeframe=Timeframe.ONE_DAY,
                open=close,
                high=close * 1.01,
                low=close * 0.99,
                close=close,
                volume=int(row["volume"]),
            )
        )
    db.commit()
    return instrument


@pytest.fixture
def world(market):
    data, vix = market
    db = SessionLocal()
    db.execute(delete(RegimeModelRecord))
    user = User(full_name="Supervised", email=f"sup-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add(user)
    db.commit()
    nifty = _add(db, "SUPNIFTY", InstrumentType.INDEX, data)
    india_vix = _add(db, "SUPVIX", InstrumentType.INDEX, pd.DataFrame({"close": vix, "volume": 0}))
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {"db": db, "user": user, "nifty": nifty, "vix": india_vix, "data": data}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.rollback()
        db.execute(delete(RegimeModelRecord))
        ids = [i.id for i in db.query(Instrument).filter(Instrument.symbol.in_(["SUPNIFTY", "SUPVIX"]))]
        db.execute(delete(MarketData).where(MarketData.instrument_id.in_(ids)))
        db.execute(delete(Instrument).where(Instrument.id.in_(ids)))
        db.execute(delete(User).where(User.id == user.id))
        db.commit()
        db.close()


def _train(world, **settings):
    body = {
        "instrument_id": str(world["nifty"].id),
        "vix_instrument_id": str(world["vix"].id),
        "model_kind": "AUTO",
        "horizon_days": 20,
        "random_state": 9,
        **settings,
    }
    started = client.post("/regime/models", json=body)
    assert started.status_code == 202, started.text
    model = client.get(f"/regime/models/{started.json()['id']}").json()
    assert model["status"] == "READY", model["error_message"]
    return model


def test_a_supervised_model_is_trained_from_the_api(world):
    model = _train(world)
    assert model["model_kind"] == "AUTO" and model["model_version"] == "supervised-regime-v1"
    assert model["vix_instrument"]["symbol"] == "SUPVIX"
    assert model["settings"]["horizon_days"] == 20
    card = model["card"]
    assert card["model_kind"] == "AUTO" and card["n_components"] is None
    sup_card = card["supervised"]
    definition = sup_card["label_definition"]
    assert definition["horizon_days"] == 20 and definition["uses_vix"]
    assert definition["trend_threshold"] == 0.02 and definition["drawdown_threshold"] == 0.05
    assert [r["key"] for r in definition["rules"]] == ["volatility", "trend", "risk"]
    assert "India VIX" in definition["rules"][2]["rule"]
    evaluation = sup_card["evaluation"]
    assert evaluation["target_accuracy"] == 0.7
    assert [d["key"] for d in evaluation["dimensions"]] == ["volatility", "trend", "risk"]
    for d in evaluation["dimensions"]:
        assert d["test"]["meets_target"] == (d["test"]["accuracy"] >= 0.7)
    assert [f["name"] for f in card["features"]][-3:] == list(sup.VIX_FEATURES)
    dataset = card["dataset"]
    splits = {s["name"]: s for s in dataset["splits"]}
    assert splits["train"]["label_window_end"] < splits["validation"]["start"]
    assert splits["validation"]["label_window_end"] < splits["test"]["start"]
    assert [p["dropped_rows"] for p in dataset["purges"]] == [20, 20]
    assert dataset["unlabelled_rows"] == 20 and dataset["vix_bars"] == DAYS
    assert card["training_start"] == splits["train"]["start"]
    assert len(card["labels"]["regimes"]) == 12
    record = world["db"].get(RegimeModelRecord, model["id"])
    world["db"].refresh(record)
    assert record.evaluation == evaluation and record.label_definition == definition
    # The same seed gives the same evaluation.
    again = _train(world)
    assert again["card"]["supervised"]["evaluation"] == evaluation


def test_current_and_history_are_per_dimension(world):
    model = _train(world)
    current = client.get("/regime/current").json()
    assert current["statement"].startswith("Model classification of the next 20 trading days")
    assert current["horizon_days"] == 20
    assert [d["key"] for d in current["dimensions"]] == ["volatility", "trend", "risk"]
    for d in current["dimensions"]:
        assert sum(p["probability"] for p in d["probabilities"]) == pytest.approx(1.0)
        assert d["probability"] == max(p["probability"] for p in d["probabilities"])
    regime_row = current["regime"]
    assert [regime_row["volatility_state"], regime_row["trend_state"], regime_row["risk_state"]] == [
        d["label"] for d in current["dimensions"]
    ]
    assert sum(p["probability"] for p in current["probabilities"]) == pytest.approx(1.0)
    assert pd.Timestamp(current["as_of"]) == world["data"].index[-1]

    record = world["db"].get(RegimeModelRecord, model["id"])
    _, classified = regime.classify_stored(world["db"], record)
    last = classified.iloc[-1]
    assert current["confidence"] == pytest.approx(float(last["confidence"]))

    history = client.get("/regime/history").json()
    assert history["horizon_days"] == 20
    points = history["points"]
    assert len(points) == DAYS
    warm = [p for p in points if p["dimensions"] is None]
    assert len(warm) == DAYS - len(classified)
    for band in history["dimension_periods"]:
        assert sum(p["bars"] for p in band["periods"]) == DAYS
        assert band["periods"][0]["label"] is None
    sample = points[-5]
    stamp = pd.Timestamp(sample["timestamp"])
    assert sample["dimensions"] == {k: classified.at[stamp, f"{k}_label"] for k in sup.DIMENSIONS}

    # Downstream: scoring reads the combined regime; the portfolio filter accepts its code.
    scored = current_regime(world["db"])
    assert scored["code"] == regime_row["code"] and scored["trend_state"] == regime_row["trend_state"]
    assert regime_label(world["db"], "HV-UP-OFF")["name"] == "High vol, uptrend, risk-off"


def test_a_supervised_model_without_vix_uses_the_drawdown_rule(world):
    model = _train(world, vix_instrument_id=None, model_kind="RF", horizon_days=10)
    definition = model["card"]["supervised"]["label_definition"]
    assert not definition["uses_vix"] and definition["horizon_days"] == 10
    assert "was not used" in definition["rules"][2]["rule"]
    assert model["vix_instrument"] is None
    assert all(f["name"] not in sup.VIX_FEATURES for f in model["card"]["features"])
    assert client.get("/regime/current").json()["dimensions"]


def test_supervised_training_requests_are_checked(world):
    base = {"instrument_id": str(world["nifty"].id), "model_kind": "XGB"}
    same = client.post("/regime/models", json={**base, "vix_instrument_id": str(world["nifty"].id)})
    assert same.status_code == 422 and "different instrument" in same.json()["detail"]
    short = client.post("/regime/models", json={**base, "start_date": "2022-06-01"})
    assert short.status_code == 422 and "at least 500 labelled days" in short.json()["detail"]
    bad = client.post("/regime/models", json={**base, "horizon_days": 90})
    assert bad.status_code == 422


def test_a_gaussian_mixture_still_trains_and_loads(world):
    started = client.post(
        "/regime/models", json={"instrument_id": str(world["nifty"].id), "random_state": 7}
    )
    model = client.get(f"/regime/models/{started.json()['id']}").json()
    assert model["status"] == "READY" and model["model_kind"] == "GMM"
    assert model["card"]["model_kind"] == "GMM" and model["card"]["supervised"] is None
    assert model["card"]["n_components"] in (2, 3, 4)
    current = client.get("/regime/current").json()
    assert current["dimensions"] is None and "not a forecast" in current["statement"]
    record = world["db"].get(RegimeModelRecord, model["id"])
    assert record.model_kind == "GMM" and record.evaluation is None
