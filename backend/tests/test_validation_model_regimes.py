"""Feature 3: validation stage 3 split by the market regime model's classification.

Each backtest day takes the model's regime of the same day (the classification
GET /regime/history shows); days without one are unclassified and listed; days
inside the model's training period are flagged; regimes with fewer than 20 days
are not judged; the model is recorded. Rule-based regimes are unchanged."""

import math
import time
from datetime import timedelta
from uuid import uuid4

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import Exchange, InstrumentType, StrategyType, Timeframe
from app.main import app
from app.ml import supervised as sup
from app.models import Execution, Instrument, MarketData, RegimeModelRecord, Strategy, User
from app.services.backtesting.executor_instance import backtest_executor
from app.services.instruments.instrument_service import InstrumentService
from app.validation import pipeline as P
from app.validation import thresholds as T
from tests.regime_synth import synthetic_market
from tests.test_regime_labels import switching_prices
from tests.test_validation_pipeline import inputs, prices

client = TestClient(app)
TERMINAL = {"COMPLETED", "FAILED", "CANCELLED"}
SMALL = {
    "walk_forward": {"train_bars": 40, "validation_bars": 20, "test_bars": 20},
    "monte_carlo": {"simulations": 200, "seed": 11},
}


def ist(ts):
    return pd.Timestamp(ts).tz_convert("Asia/Kolkata").date()


def returns_of(result, initial=100_000.0):
    values = [initial] + [p["portfolio_value"] for p in result.equity_curve]
    return [b / a - 1 for a, b in zip(values, values[1:])]


def crafted(data, labels: dict[int, int], *, missing=(), dims=None, training=(50, 150)):
    """ModelRegimes with a regime id per bar position; `missing` positions have no
    reference bar at all; positions without a label are warm-up."""
    days = {}
    for position, regime_id in labels.items():
        if position in missing:
            continue
        days[ist(data.index[position])] = {
            "regime_id": regime_id,
            "dimensions": dims(position) if dims else None,
        }
    first, last = training
    return P.ModelRegimes(
        model={
            "id": "m-1",
            "number": 4,
            "name": "Model 4",
            "kind": "XGB" if dims else "GMM",
            "kind_name": "XGBoost" if dims else "Gaussian mixture",
            "version": "v",
            "training_start": data.index[first].isoformat(),
            "training_end": data.index[last].isoformat(),
            "instrument_id": None,
            "instrument_symbol": "NIFTY50",
            "horizon_days": 20 if dims else None,
        },
        labels=(
            [{"regime_id": c["regime_id"], "code": c["code"], "name": c["name"]} for c in sup.combos()]
            if dims
            else [
                {"regime_id": 0, "code": "R1", "name": "Calm"},
                {"regime_id": 1, "code": "R2", "name": "Volatile"},
                {"regime_id": 2, "code": "R3", "name": "Rare"},
            ]
        ),
        days=days,
        reference_days={ist(data.index[p]) for p in range(len(data)) if p not in missing},
        dimensions=(
            [{"key": k, "name": sup.DIMENSION_NAMES[k], "classes": list(sup.CLASSES[k])} for k in sup.DIMENSIONS]
            if dims
            else None
        ),
    )


# --- the pipeline ------------------------------------------------------------------


def test_days_split_by_the_model_with_unclassified_insufficient_and_in_sample():
    data = prices(400)
    labels = {p: 0 for p in range(50, 250)} | {p: 1 for p in range(250, 390)} | {p: 2 for p in range(390, 400)}
    missing = set(range(100, 105))
    run = inputs(data, model_regimes=crafted(data, labels, missing=missing))
    _, result = P.backtest_stage(run)
    stage = P.regime_stress_stage(run, result)
    rows = {r["code"]: r for r in stage["regimes"]}
    returns = returns_of(result)
    for regime_id, code in enumerate(["R1", "R2", "R3"]):
        mine = [r for p, r in enumerate(returns) if labels.get(p) == regime_id and p not in missing]
        assert rows[code]["days"] == len(mine)
        assert rows[code]["total_return"] == pytest.approx(math.prod(1 + r for r in mine) - 1)
        assert rows[code]["annualized_volatility"] == pytest.approx(np.std(mine, ddof=1) * math.sqrt(252))
    assert [rows[c]["judged"] for c in ("R1", "R2", "R3")] == [True, True, False]
    assert stage["insufficient"] == [{"key": "R3", "name": "Rare", "days": 10}]
    unclassified = stage["unclassified"]
    assert unclassified["days"] == 55
    assert {r["reason"]: r["days"] for r in unclassified["reasons"]} == {"warm_up": 50, "no_reference_bar": 5}
    assert [(p["start"], p["bars"]) for p in unclassified["periods"]] == [
        (data.index[0].isoformat(), 50),
        (data.index[100].isoformat(), 5),
    ]
    # Days 50-150 are inside the training period, less the 5 without a reference bar.
    assert stage["in_sample"]["days"] == 96 and "96 of 400 days" in stage["in_sample"]["flag"]
    check = stage["checks"][0]
    assert check["value"] == pytest.approx(max(rows["R1"]["max_drawdown"], rows["R2"]["max_drawdown"]))
    assert check["passed"] == (check["value"] <= T.REGIME_MAX_DRAWDOWN)
    assert stage["method"]["source"] == "model" and stage["method"]["model"]["number"] == 4
    assert stage["method"]["min_days"] == 20
    assert sum(p["bars"] for p in stage["periods"]) == len(result.equity_curve)
    # Every day's return is in exactly one place: a regime or unclassified.
    unclassified_returns = [r for p, r in enumerate(returns) if p not in labels or p in missing]
    total = math.prod(1 + r for r in unclassified_returns) * math.prod(
        1 + (row["total_return"] or 0) for row in stage["regimes"]
    )
    assert total == pytest.approx(result.equity_curve[-1]["portfolio_value"] / 100_000.0)


def test_a_supervised_model_is_also_split_and_judged_by_dimension():
    data = prices(400)
    combos = sup.combos()

    def dims(p):
        return {
            "volatility": "High volatility" if p % 2 else "Low volatility",
            "trend": "Uptrend" if p < 380 else "Sideways",  # 20 sideways days: judged
            "risk": "Risk-off" if p >= 395 else "Risk-on",  # 5 risk-off days: not judged
        }

    labels = {}
    for p in range(30, 400):
        d = dims(p)
        labels[p] = next(
            c["regime_id"]
            for c in combos
            if (c["volatility_state"], c["trend_state"], c["risk_state"]) == (d["volatility"], d["trend"], d["risk"])
        )
    run = inputs(data, model_regimes=crafted(data, labels, dims=dims))
    _, result = P.backtest_stage(run)
    stage = P.regime_stress_stage(run, result)
    assert len(stage["regimes"]) == 12 and all(r["judged"] is None for r in stage["regimes"])
    by_dim = {d["key"]: {r["key"]: r for r in d["rows"]} for d in stage["dimensions"]}
    assert by_dim["trend"]["Uptrend"]["days"] == 350 and by_dim["trend"]["Sideways"]["days"] == 20
    assert by_dim["trend"]["Downtrend"]["days"] == 0 and not by_dim["trend"]["Downtrend"]["judged"]
    assert by_dim["risk"]["Risk-off"]["judged"] is False
    assert {"key": "Risk-off", "name": "Risk-off", "days": 5} in stage["insufficient"]
    judged = [r for d in by_dim.values() for r in d.values() if r["judged"]]
    assert stage["checks"][0]["value"] == pytest.approx(max(r["max_drawdown"] for r in judged))
    assert "Judged: regimes with at least 20 days (each class of each dimension)" in stage["checks"][0]["explanation"]
    for d in stage["dimensions"]:
        assert sum(r["days"] for r in d["rows"]) == stage["labelled_days"]
        assert sum(p["bars"] for p in d["periods"]) == len(result.equity_curve)


def test_no_judged_regime_fails_the_check_with_a_reason():
    data = prices(300)
    run = inputs(data, model_regimes=crafted(data, {p: 0 for p in range(285, 300)}))
    _, result = P.backtest_stage(run)
    stage = P.regime_stress_stage(run, result)
    check = stage["checks"][0]
    assert check["value"] is None and not check["passed"]
    assert check["reason"] == "No regime had at least 20 classified days, so none could be judged."


def test_a_model_that_cannot_be_used_fails_only_stage_3():
    data = prices(400)
    broken = P.ModelRegimes(model={}, labels=[], days={}, reference_days=set(), error="The model's reference instrument no longer exists.")
    report = P.run_pipeline(inputs(data, model_regimes=broken))
    stage = report["stages"]["regime_stress"]
    assert stage["status"] == "ERROR" and stage["error"] == "The model's reference instrument no longer exists."
    assert report["stages"]["monte_carlo"]["status"] in {"PASS", "FAIL"}


def test_rule_based_regimes_are_unchanged():
    run = inputs()
    _, result = P.backtest_stage(run)
    stage = P.regime_stress_stage(run, result)
    assert set(stage) == {"key", "name", "status", "checks", "reason", "error", "method", "regimes", "periods", "labelled_days"}
    assert set(stage["method"]) == {"method", "trend_window", "volatility_window", "volatility_threshold", "warm_up_bars"}
    assert all(set(r) == {"key", "name", "days", "share", "total_return", "annualized_mean_return",
                          "annualized_volatility", "max_drawdown", "trade_count"} for r in stage["regimes"])


# --- the API, with a trained model and the real worker -----------------------------


def wait_for_worker(seconds=120):
    deadline = time.time() + seconds
    while not backtest_executor.has_capacity() and time.time() < deadline:
        time.sleep(0.2)


def _instrument(db, symbol, kind, frame):
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
                volume=int(row.get("volume", 1000)),
            )
        )
    db.commit()
    return instrument


@pytest.fixture
def world():
    db = SessionLocal()
    db.execute(delete(RegimeModelRecord))
    user = User(full_name="Stress", email=f"mrs-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add(user)
    db.commit()
    strategy = Strategy(
        user_id=user.id,
        name="Momentum",
        strategy_type=StrategyType.PYTHON,
        strategy_config={"parameters": {"template": "momentum", "lookback": 10}, "indicators": [],
                         "entry_conditions": [], "exit_conditions": []},
    )
    db.add(strategy)
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: user
    made = []

    def add(symbol, kind, frame):
        instrument = _instrument(db, symbol, kind, frame)
        made.append(instrument.id)
        return instrument

    try:
        yield {"db": db, "user": user, "strategy": strategy, "add": add}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        wait_for_worker()
        db.rollback()
        db.execute(delete(Execution).where(Execution.strategy_id == strategy.id))
        db.execute(delete(Strategy).where(Strategy.id == strategy.id))
        db.execute(delete(RegimeModelRecord))
        db.execute(delete(MarketData).where(MarketData.instrument_id.in_(made)))
        db.execute(delete(Instrument).where(Instrument.id.in_(made)))
        db.execute(delete(User).where(User.id == user.id))
        db.commit()
        db.close()


def _train(body):
    started = client.post("/regime/models", json=body)
    assert started.status_code == 202, started.text
    model = client.get(f"/regime/models/{started.json()['id']}").json()
    assert model["status"] == "READY", model["error_message"]
    return model


def _validate(world, instrument, frame, regimes):
    wait_for_worker()
    created = client.post(
        "/validations",
        json={
            "strategy_id": str(world["strategy"].id),
            "instrument_id": str(instrument.id),
            "timeframe": "1D",
            "initial_capital": 100000,
            "start_timestamp": frame.index[0].isoformat(),
            "end_timestamp": frame.index[-1].isoformat(),
            "quantity": 20,
            "regimes": regimes,
            **SMALL,
        },
    )
    assert created.status_code == 201, created.text
    deadline = time.time() + 120
    while time.time() < deadline:
        report = client.get(f"/validations/{created.json()['id']}").json()
        if report["status"] in TERMINAL:
            return report
        time.sleep(0.3)
    raise AssertionError("validation did not finish")


def _expected(history, report):
    """Days per regime code as /regime/history classifies the same days."""
    by_day = {ist(p["timestamp"]): p for p in history["points"]}
    codes = {r["regime_id"]: r["code"] for r in history["regimes"]}
    counts = {}
    for point in report["stages"]["backtest"]["equity_curve"]:
        p = by_day.get(ist(point["timestamp"]))
        if p is not None and p["regime_id"] is not None:
            counts[codes[p["regime_id"]]] = counts.get(codes[p["regime_id"]], 0) + 1
    return counts, by_day


def test_a_validation_with_the_gmm_model_uses_the_same_split_as_regime_history(world):
    reference = switching_prices(600)
    nifty = world["add"]("MRNIFTY", InstrumentType.INDEX, reference.drop(reference.index[[400, 401, 402]]))
    frame = pd.DataFrame(
        {"close": [500 + 0.3 * i + 25 * math.sin(i / 7) for i in range(300)]},
        index=reference.index[300:600],
    )
    stock = world["add"]("MRSTOCK", InstrumentType.EQUITY, frame)
    model = _train({"instrument_id": str(nifty.id), "random_state": 7})

    report = _validate(world, stock, frame, {"source": "model"})
    assert report["status"] == "COMPLETED", report.get("error")
    stage = report["stages"]["regime_stress"]
    assert stage["status"] in {"PASS", "FAIL"}, stage
    # The model is recorded, in the stage and the configuration.
    recorded = report["configuration"]["regimes"]
    assert recorded["source"] == "model" and recorded["model_id"] == model["id"]
    assert recorded["model"]["number"] == model["number"] and recorded["model"]["kind"] == "GMM"
    assert recorded["model"]["training_start"] == model["card"]["training_start"]
    assert stage["method"]["model"] == recorded["model"]

    history = client.get("/regime/history").json()
    counts, _ = _expected(history, report)
    assert {r["code"]: r["days"] for r in stage["regimes"] if r["days"]} == counts
    reasons = {r["reason"]: r["days"] for r in stage["unclassified"]["reasons"]}
    assert reasons == {"no_reference_bar": 3}
    assert stage["in_sample"]["days"] == sum(
        1
        for p in report["stages"]["backtest"]["equity_curve"]
        if ist(model["card"]["training_start"]) <= ist(p["timestamp"]) <= ist(model["card"]["training_end"])
        and ist(p["timestamp"]) not in {ist(t) for t in reference.index[[400, 401, 402]]}
    )


def test_a_validation_with_a_supervised_model_splits_by_dimension(world, monkeypatch):
    monkeypatch.setattr(sup, "RF_GRID", ({"max_depth": 4, "min_samples_leaf": 20},))
    monkeypatch.setattr(sup, "XGB_GRID", ({"max_depth": 2, "n_estimators": 60},))
    monkeypatch.setitem(sup.RF_FIXED, "n_estimators", 40)
    data, _ = synthetic_market(1100, seed=11)
    nifty = world["add"]("MRNIFTY", InstrumentType.INDEX, data)
    frame = pd.DataFrame({"close": data["close"].to_numpy()[-300:] * 0.05}, index=data.index[-300:])
    stock = world["add"]("MRSTOCK", InstrumentType.EQUITY, frame)
    model = _train({"instrument_id": str(nifty.id), "model_kind": "RF", "random_state": 3})

    report = _validate(world, stock, frame, {"source": "model", "model_id": model["id"]})
    stage = report["stages"]["regime_stress"]
    assert stage["status"] in {"PASS", "FAIL"}, stage
    assert stage["method"]["model"]["kind"] == "RF" and stage["method"]["model"]["horizon_days"] == 20
    assert "never used" in stage["method"]["method"]
    history = client.get("/regime/history").json()
    counts, by_day = _expected(history, report)
    assert {r["code"]: r["days"] for r in stage["regimes"] if r["days"]} == counts
    for dimension in stage["dimensions"]:
        expected = {}
        for point in report["stages"]["backtest"]["equity_curve"]:
            label = (by_day[ist(point["timestamp"])]["dimensions"] or {}).get(dimension["key"])
            if label:
                expected[label] = expected.get(label, 0) + 1
        assert {r["key"]: r["days"] for r in dimension["rows"] if r["days"]} == expected
    # Days inside the model's training period are flagged as in-sample.
    train = model["card"]["dataset"]["splits"][0]
    first, last = ist(train["start"]), ist(train["label_window_end"])
    assert stage["method"]["model"]["in_sample_end"] == train["label_window_end"]
    overlap = sum(1 for t in frame.index if first <= ist(t) <= last)
    assert overlap > 0 and stage["in_sample"]["days"] == overlap
    assert stage["in_sample"]["flag"].startswith(f"Classified in-sample for {overlap} of 300 days")


def test_the_model_source_needs_a_ready_model(world):
    frame = pd.DataFrame(
        {"close": [500 + i for i in range(300)]},
        index=pd.date_range("2022-01-03", periods=300, freq="B", tz="UTC"),
    )
    stock = world["add"]("MRSTOCK", InstrumentType.EQUITY, frame)
    payload = {
        "strategy_id": str(world["strategy"].id),
        "instrument_id": str(stock.id),
        "timeframe": "1D",
        "initial_capital": 100000,
        **SMALL,
    }
    none = client.post("/validations", json={**payload, "regimes": {"source": "model"}})
    assert none.status_code == 422 and "No regime model has been trained" in none.json()["detail"]
    unknown = client.post(
        "/validations", json={**payload, "regimes": {"source": "model", "model_id": str(uuid4())}}
    )
    assert unknown.status_code == 422 and unknown.json()["detail"] == "This regime model does not exist."
    bad = client.post("/validations", json={**payload, "regimes": {"source": "clusters"}})
    assert bad.status_code == 422
