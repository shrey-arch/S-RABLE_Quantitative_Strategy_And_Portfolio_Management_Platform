"""Phase 12: train the regime model from the API, then read the current regime and
its history. Every label and number must come from the stored model."""

from uuid import uuid4

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import Exchange, InstrumentType, Timeframe
from app.main import app
from app.ml import model as ml_model
from app.models import Instrument, MarketData, RegimeModelRecord, User
from app.services.instruments.instrument_service import InstrumentService
from app.services.regime import service as regime
from tests.test_regime_labels import switching_prices

client = TestClient(app)
DAYS = 600


def add_instrument(db, prices: pd.DataFrame, active=True):
    instrument = InstrumentService(db).create_instrument(
        symbol="REGIME",
        trading_symbol=f"REG-{uuid4().hex[:6]}",
        name="Regime test",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin=None,
        lot_size=1,
        tick_size=0.05,
    )
    for timestamp, close in prices["close"].items():
        db.add(
            MarketData(
                instrument_id=instrument.id,
                timestamp=timestamp.to_pydatetime(),
                timeframe=Timeframe.ONE_DAY,
                open=close,
                high=close * 1.01,
                low=close * 0.99,
                close=close,
                volume=1000,
            )
        )
    if not active:
        instrument.is_active = False
    db.commit()
    return instrument


@pytest.fixture
def world():
    db = SessionLocal()
    db.execute(delete(RegimeModelRecord))
    user = User(full_name="Regime", email=f"reg-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add(user)
    db.commit()
    prices = switching_prices(DAYS)
    instrument = add_instrument(db, prices)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {"db": db, "user": user, "instrument": instrument, "prices": prices}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.rollback()
        db.execute(delete(RegimeModelRecord))
        ids = [i.id for i in db.query(Instrument).filter(Instrument.symbol == "REGIME")]
        db.execute(delete(MarketData).where(MarketData.instrument_id.in_(ids)))
        db.execute(delete(Instrument).where(Instrument.id.in_(ids)))
        db.execute(delete(User).where(User.id == user.id))
        db.commit()
        db.close()


def train(world, **settings):
    body = {"instrument_id": str(world["instrument"].id), "random_state": 7, **settings}
    started = client.post("/regime/models", json=body)
    assert started.status_code == 202, started.text
    assert started.json()["status"] == "TRAINING"
    # The test client runs the background training before it returns.
    model = client.get(f"/regime/models/{started.json()['id']}").json()
    assert model["status"] == "READY", model["error_message"]
    return model


def test_training_stores_a_model_card_with_named_regimes(world):
    model = train(world, candidate_components=[2, 3])
    assert model["number"] == 1 and model["is_active"] and model["trained_by_you"]
    assert model["instrument"]["symbol"] == "REGIME"
    card = model["card"]
    assert card["model_type"].startswith("Gaussian mixture")
    assert card["model_version"] == "gmm-regime-v1"
    assert card["n_components"] in (2, 3)
    assert card["candidate_components"] == [2, 3]
    assert [f["name"] for f in card["features"]] == ["log_return", "realized_volatility", "trend_strength"]
    assert card["feature_parameters"] == {"volatility_window": 20, "trend_window": 20}
    assert card["random_state"] == 7
    assert "no accuracy figure" in card["performance_note"]
    labels = card["labels"]["regimes"]
    assert len(labels) == card["n_components"]
    assert sorted(label["code"] for label in labels) == [f"R{i}" for i in range(1, len(labels) + 1)]
    dataset = card["dataset"]
    assert dataset["bars"] == DAYS
    assert dataset["dropped_warm_up_rows"] == 20
    assert sum(s["rows"] for s in dataset["splits"]) == DAYS - 20
    assert [s["name"] for s in dataset["splits"]] == ["train", "validation", "test"]
    assert card["training_start"] == dataset["splits"][0]["start"]
    assert card["training_end"] == dataset["splits"][0]["end"]
    assert dataset["data_fingerprint"]
    listed = client.get("/regime/models").json()
    assert [m["id"] for m in listed] == [model["id"]]


def test_the_same_data_and_seed_give_the_same_model(world):
    first = train(world)
    second = train(world)
    assert second["number"] == 2 and second["is_active"]
    assert not client.get(f"/regime/models/{first['id']}").json()["is_active"]
    assert first["card"]["labels"] == second["card"]["labels"]
    assert first["card"]["evaluation"] == second["card"]["evaluation"]
    a = client.get("/regime/history", params={"model_id": first["id"]}).json()
    b = client.get("/regime/history", params={"model_id": second["id"]}).json()
    assert a["points"] == b["points"]


def test_current_regime_is_the_model_classification_of_the_last_bar(world):
    model = train(world)
    current = client.get("/regime/current").json()
    assert "not a forecast" in current["statement"]
    assert current["model"]["id"] == model["id"]
    assert current["instrument"]["symbol"] == "REGIME"
    assert current["as_of"] == world["prices"].index[-1].isoformat()

    record = world["db"].get(RegimeModelRecord, model["id"])
    classified = regime.classify(record, world["prices"])
    last = classified.iloc[-1]
    labels = {label["regime_id"]: label for label in model["card"]["labels"]["regimes"]}
    assert current["regime"] == labels[int(last["regime_id"])]
    assert current["confidence"] == pytest.approx(float(last["confidence"]))
    probabilities = {p["regime_id"]: p["probability"] for p in current["probabilities"]}
    assert set(probabilities) == set(labels)
    assert sum(probabilities.values()) == pytest.approx(1.0)
    assert max(probabilities.values()) == pytest.approx(current["confidence"])
    assert [p["code"] for p in current["probabilities"]] == sorted(p["code"] for p in current["probabilities"])


def test_history_bands_line_up_with_the_days(world):
    model = train(world)
    prices = world["prices"]
    start, end = prices.index[100].date(), prices.index[399].date()
    history = client.get(
        "/regime/history", params={"start_date": start.isoformat(), "end_date": end.isoformat()}
    ).json()
    points = history["points"]
    assert [p["timestamp"] for p in points] == [t.isoformat() for t in prices.index[100:400]]
    assert [p["close"] for p in points] == pytest.approx(list(prices["close"].iloc[100:400]))
    assert all(p["regime_id"] is not None for p in points)

    # Periods are the runs of equal regimes, in order, covering every day once.
    rebuilt = []
    for period in history["periods"]:
        days = [p for p in points if period["start"] <= p["timestamp"] <= period["end"]]
        assert len(days) == period["bars"]
        assert {p["regime_id"] for p in days} == {period["regime_id"]}
        rebuilt.extend(days)
    assert rebuilt == points
    for a, b in zip(history["periods"], history["periods"][1:]):
        assert a["regime_id"] != b["regime_id"]

    # A transition is the first day of each period after the first.
    assert [t["timestamp"] for t in history["transitions"]] == [p["start"] for p in history["periods"][1:]]
    for transition, before, after in zip(history["transitions"], history["periods"], history["periods"][1:]):
        assert (transition["from_code"], transition["to_code"]) == (before["code"], after["code"])

    # A day's regime does not depend on the range asked for (features use the past only).
    full = {p["timestamp"]: p for p in client.get("/regime/history").json()["points"]}
    assert all(full[p["timestamp"]] == p for p in points)
    assert history["training_start"] == model["card"]["training_start"]
    assert history["training_end"] == model["card"]["training_end"]
    assert history["regimes"] == model["card"]["labels"]["regimes"]


def test_the_first_days_are_warm_up_without_a_regime(world):
    train(world)
    history = client.get("/regime/history").json()
    first = history["periods"][0]
    assert first["regime_id"] is None and first["code"] is None
    assert first["name"].startswith("Warm-up")
    assert first["bars"] == 20
    assert all(p["regime_id"] is None and p["confidence"] is None for p in history["points"][:20])
    assert len(history["points"]) == DAYS


def test_no_model_yet(world):
    for path in ("/regime/current", "/regime/history"):
        response = client.get(path)
        assert response.status_code == 404
        assert "No regime model has been trained yet" in response.text
    assert client.get("/regime/models").json() == []


@pytest.mark.parametrize(
    "overrides,message",
    [
        ({"end_date": None, "start_date": None, "candidate_components": [1, 2]}, "from 2 to 6"),
        ({"candidate_components": [3, 3]}, "only once"),
        ({"volatility_window": 2}, "greater than or equal to 5"),
        ({"start_date": "2024-01-10", "end_date": "2024-01-01"}, "on or after"),
        ({"start_date": "2022-01-03", "end_date": "2022-05-31"}, "Training needs at least 100 days"),
        ({"instrument_id": str(uuid4())}, "This instrument does not exist."),
    ],
)
def test_settings_that_cannot_train_are_refused(world, overrides, message):
    body = {"instrument_id": str(world["instrument"].id), **overrides}
    response = client.post("/regime/models", json=body)
    assert response.status_code == 422, response.text
    assert message in response.text
    assert client.get("/regime/models").json() == []


def test_an_inactive_instrument_is_refused(world):
    other = add_instrument(world["db"], switching_prices(200), active=False)
    response = client.post("/regime/models", json={"instrument_id": str(other.id)})
    assert response.status_code == 422
    assert "is inactive" in response.text


def test_one_training_at_a_time(world):
    db = world["db"]
    db.add(
        RegimeModelRecord(
            number=1,
            status="TRAINING",
            model_version="gmm-regime-v1",
            instrument_id=world["instrument"].id,
            settings={},
        )
    )
    db.commit()
    response = client.post("/regime/models", json={"instrument_id": str(world["instrument"].id)})
    assert response.status_code == 409
    assert "already training" in response.text
    # On restart, a model left training is marked failed.
    assert regime.fail_stranded_training() == 1
    stranded = client.get("/regime/models").json()[0]
    assert stranded["status"] == "FAILED"
    assert stranded["error_message"] == regime.LOST_MESSAGE


def test_a_failed_training_is_stored_and_never_active(world, monkeypatch):
    good = train(world)

    def broken(*args, **kwargs):
        raise ValueError("No candidate model produced a finite validation BIC.")

    monkeypatch.setattr(regime, "train_regime_model", broken)
    started = client.post("/regime/models", json={"instrument_id": str(world["instrument"].id)})
    failed = client.get(f"/regime/models/{started.json()['id']}").json()
    assert failed["status"] == "FAILED"
    assert failed["error_message"] == "No candidate model produced a finite validation BIC."
    assert failed["card"] is None and not failed["is_active"]
    assert client.get("/regime/current").json()["model"]["id"] == good["id"]
    assert client.get("/regime/current", params={"model_id": failed["id"]}).status_code == 409


def test_the_model_needs_a_login():
    app.dependency_overrides.pop(get_current_user, None)
    assert client.get("/regime/current").status_code == 401
    assert client.post("/regime/models", json={}).status_code == 401


def test_regime_uses_the_tested_ml_code():
    # The API trains and classifies with the functions the ML tests cover.
    assert regime.predict_regimes is ml_model.predict_regimes
    assert regime.train_regime_model is ml_model.train_regime_model
