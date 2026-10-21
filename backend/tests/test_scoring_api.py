"""Phase 13: scoring the user's strategies on their latest backtest's instruments.
Every score must equal what app.ml computes from the stored closes."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import ExecutionStatus, ExecutionType, StrategyType
from app.main import app
from app.ml.factor_definitions import FACTORS, REGIME_RULES, regime_compatibility
from app.ml.factors import calculate_strategy_factors
from app.ml.scoring import (
    DEFAULT_STRATEGY_WEIGHTS,
    FACTOR_DIRECTIONS,
    STRATEGY_FACTORS,
    calculate_composite_score,
)
from app.models import Execution, Instrument, MarketData, RegimeModelRecord, Strategy, User
from tests.test_regime_api import add_instrument
from tests.test_regime_labels import switching_prices

client = TestClient(app)


def other_prices(days=300, seed=11):
    rng = np.random.default_rng(seed)
    close = 250 * np.exp(np.cumsum(rng.normal(0.0002, 0.012, days)))
    index = pd.date_range("2022-01-03", periods=days, freq="B", tz="UTC")
    return pd.DataFrame({"close": close}, index=index)


def template(key, **params):
    return {
        "parameters": {"template": key, **params},
        "indicators": [],
        "entry_conditions": [],
        "exit_conditions": [],
    }


@pytest.fixture
def world():
    db = SessionLocal()
    db.execute(delete(RegimeModelRecord))
    user = User(full_name="Scorer", email=f"sc-{uuid4().hex[:8]}@example.com", password_hash="x")
    other = User(full_name="Other", email=f"so-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add_all([user, other])
    db.commit()
    a_prices, b_prices = switching_prices(300), other_prices()
    a = add_instrument(db, a_prices)
    b = add_instrument(db, b_prices)
    short = add_instrument(db, switching_prices(15))

    strategies = {}

    def strategy(name, kind, config, owner=user):
        row = Strategy(user_id=owner.id, name=name, strategy_type=kind, strategy_config=config)
        db.add(row)
        db.flush()
        strategies[name] = row
        return row

    def backtest(row, key, instrument, others=(), status=ExecutionStatus.COMPLETED, minutes=0):
        db.add(
            Execution(
                strategy_id=row.id,
                instrument_id=instrument.id,
                execution_type=ExecutionType.BACKTEST,
                status=status,
                timeframe="1D",
                initial_capital=100000,
                execution_config={},
                run_settings={"strategy_key": key, "other_instrument_ids": [str(o.id) for o in others]},
                completed_at=datetime(2026, 10, 1, tzinfo=timezone.utc) + timedelta(minutes=minutes),
            )
        )

    backtest(strategy("Momentum A", StrategyType.PYTHON, template("momentum")), "momentum", a)
    mr = strategy("Mean reversion A", StrategyType.PYTHON, template("mean_reversion"))
    backtest(mr, "mean_reversion", b, minutes=1)
    # A newer failed run does not count; the latest COMPLETED one does.
    backtest(mr, "mean_reversion", a, minutes=0)
    backtest(mr, "mean_reversion", short, status=ExecutionStatus.FAILED, minutes=5)
    backtest(
        strategy("Pairs AB", StrategyType.PYTHON, template("statistical_arbitrage")),
        "statistical_arbitrage",
        a,
        others=[b],
    )
    backtest(
        strategy("Rotation AB", StrategyType.PYTHON, template("tactical_asset_allocation")),
        "tactical_asset_allocation",
        a,
        others=[b],
    )
    backtest(strategy("Vol arb B", StrategyType.PYTHON, template("volatility_arbitrage")), "volatility_arbitrage", b)
    backtest(strategy("Rules", StrategyType.NO_CODE, template("momentum")), "no_code_rules", a)
    strategy("Never run", StrategyType.PYTHON, template("momentum"))
    backtest(strategy("Too short", StrategyType.PYTHON, template("momentum")), "momentum", short)
    backtest(strategy("Theirs", StrategyType.PYTHON, template("momentum"), owner=other), "momentum", a)
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {
            "db": db,
            "user": user,
            "a": a,
            "b": b,
            "prices": {"a": a_prices, "b": b_prices},
            "strategies": strategies,
        }
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.rollback()
        ids = [s.id for s in strategies.values()]
        db.execute(delete(RegimeModelRecord))
        db.execute(delete(Execution).where(Execution.strategy_id.in_(ids)))
        db.execute(delete(Strategy).where(Strategy.id.in_(ids)))
        inst = [i.id for i in db.query(Instrument).filter(Instrument.symbol == "REGIME")]
        db.execute(delete(MarketData).where(MarketData.instrument_id.in_(inst)))
        db.execute(delete(Instrument).where(Instrument.id.in_(inst)))
        db.execute(delete(User).where(User.id.in_([user.id, other.id])))
        db.commit()
        db.close()


def frame_for(world, name, key):
    a, b = world["prices"]["a"], world["prices"]["b"]
    if key == "statistical_arbitrage":
        frame = pd.concat({"instrument_a": a["close"], "instrument_b": b["close"]}, axis=1, join="inner")
        frame["close"] = frame["instrument_a"]
        return frame
    return b if name in ("Vol arb B", "Mean reversion A") else a


def by_name(result):
    return {row["name"]: row for row in result["rows"]}


def test_definitions_document_every_factor_and_rule(world):
    d = client.get("/scoring/definitions").json()
    assert {s["strategy_key"] for s in d["strategies"]} == set(STRATEGY_FACTORS)
    for s in d["strategies"]:
        key = s["strategy_key"]
        assert [f["name"] for f in s["factors"]] == list(STRATEGY_FACTORS[key])
        assert {f["name"]: f["direction"] for f in s["factors"]} == FACTOR_DIRECTIONS[key]
        assert s["default_weights"] == DEFAULT_STRATEGY_WEIGHTS[key]
        assert s["regime_rule"]["rule"] == REGIME_RULES[key]["rule"]
    assert {f["name"] for f in d["factors"]} == set(FACTORS)
    assert d["windows"]["trend"] == 20
    assert d["bounds"]["trend_strength"] == [-3.0, 3.0]
    assert "engineering heuristics" in " ".join(d["method"])


def test_scores_equal_the_ml_code_on_the_stored_closes(world):
    result = client.post("/scoring", json={}).json()
    rows = by_name(result)
    assert "Theirs" not in rows
    scored = [r for r in result["rows"] if r["status"] == "SCORED"]
    assert [r["name"] for r in scored] == [
        r["name"] for r in sorted(scored, key=lambda r: (-r["composite_score"], r["name"]))
    ]
    assert [r["rank"] for r in scored] == list(range(1, len(scored) + 1))
    assert {r["name"] for r in scored} == {"Momentum A", "Mean reversion A", "Pairs AB", "Rotation AB", "Vol arb B"}

    for row in scored:
        key = row["strategy_key"]
        frame = frame_for(world, row["name"], key)
        raw: dict = {}
        factors = calculate_strategy_factors(key, frame, raw_values=raw)
        assert row["composite_score"] == pytest.approx(calculate_composite_score(key, factors))
        assert [f["factor"] for f in row["factors"]] == list(STRATEGY_FACTORS[key])
        for f in row["factors"]:
            assert f["normalized"] == pytest.approx(factors[f["factor"]])
            assert f["raw"] == pytest.approx(raw[f["factor"]])
            assert f["weight"] == 1.0
            assert f["weight_share"] == pytest.approx(1 / len(STRATEGY_FACTORS[key]))
            assert f["label"] == FACTORS[f["factor"]]["label"]
        assert sum(f["contribution"] for f in row["factors"]) == pytest.approx(row["composite_score"])
        assert row["as_of"] == frame.index[-1].isoformat()
        assert row["regime_compatibility"]["status"] == "UNKNOWN"

    # Raw values are the documented measurements.
    close = world["prices"]["a"]["close"]
    momentum = {f["factor"]: f for f in rows["Momentum A"]["factors"]}
    assert momentum["relative_momentum"]["raw"] == pytest.approx(close.iloc[-1] / close.tail(20).mean() - 1)
    rotation = {f["factor"]: f for f in rows["Rotation AB"]["factors"]}
    assert rotation["relative_momentum"]["raw"] == pytest.approx(close.iloc[-1] / close.iloc[-21] - 1)

    # The latest COMPLETED backtest decides the instruments.
    assert [i["id"] for i in rows["Mean reversion A"]["instruments"]] == [str(world["b"].id)]
    assert [i["id"] for i in rows["Pairs AB"]["instruments"]] == [str(world["a"].id), str(world["b"].id)]


def test_strategies_that_cannot_be_scored_say_why(world):
    rows = by_name(client.post("/scoring", json={}).json())
    assert rows["Never run"]["status"] == "UNSCORED"
    assert rows["Never run"]["reason"] == "No completed backtest yet. Backtest it to score it."
    assert "no-code rules" in rows["Rules"]["reason"]
    assert rows["Too short"]["reason"].startswith("The factors could not be computed: Insufficient history")
    for name in ("Never run", "Rules", "Too short"):
        assert rows[name]["composite_score"] is None and rows[name]["rank"] is None
        assert rows[name]["factors"] == []


def test_custom_weights_apply_to_one_request(world):
    weights = {"momentum": {"trend_strength": 3, "relative_momentum": 1, "volatility_suitability": 0}}
    custom = by_name(client.post("/scoring", json={"weights": weights}).json())
    default = by_name(client.post("/scoring", json={}).json())
    frame = world["prices"]["a"]
    factors = calculate_strategy_factors("momentum", frame)
    assert custom["Momentum A"]["composite_score"] == pytest.approx(
        calculate_composite_score("momentum", factors, weights["momentum"])
    )
    shares = {f["factor"]: f["weight_share"] for f in custom["Momentum A"]["factors"]}
    assert shares == pytest.approx({"trend_strength": 0.75, "relative_momentum": 0.25, "volatility_suitability": 0})
    assert custom["Mean reversion A"]["composite_score"] == default["Mean reversion A"]["composite_score"]
    assert default["Momentum A"]["composite_score"] == pytest.approx(calculate_composite_score("momentum", factors))
    result = client.post("/scoring", json={"weights": weights}).json()
    assert result["custom_weights"] and result["weights"]["momentum"] == {
        "trend_strength": 3.0,
        "relative_momentum": 1.0,
        "volatility_suitability": 0.0,
    }


@pytest.mark.parametrize(
    "weights,message",
    [
        ({"no_code_rules": {"x": 1}}, "no_code_rules is not a core strategy"),
        ({"momentum": {"trend_strength": 1}}, "Weights for momentum: Missing factors"),
        ({"momentum": {"trend_strength": -1, "relative_momentum": 1, "volatility_suitability": 1}}, "nonnegative"),
        ({"momentum": {"trend_strength": 0, "relative_momentum": 0, "volatility_suitability": 0}}, "greater than zero"),
    ],
)
def test_bad_weights_are_refused(world, weights, message):
    response = client.post("/scoring", json={"weights": weights})
    assert response.status_code == 422
    assert message in response.text


def test_regime_compatibility_follows_the_rule_table(world):
    started = client.post(
        "/regime/models", json={"instrument_id": str(world["a"].id), "random_state": 7}
    ).json()
    assert client.get(f"/regime/models/{started['id']}").json()["status"] == "READY"
    current = client.get("/regime/current").json()
    result = client.post("/scoring", json={}).json()
    regime = result["regime"]
    assert regime["name"] == current["regime"]["name"]
    assert regime["confidence"] == pytest.approx(current["confidence"])
    assert regime["as_of"] == current["as_of"]
    for row in result["rows"]:
        if row["status"] == "SCORED":
            assert row["regime_compatibility"] == regime_compatibility(row["strategy_key"], regime)

    fit = client.get("/scoring/regime-fit").json()
    assert fit["regime"] == regime
    assert [s["strategy_key"] for s in fit["strategies"]] == list(STRATEGY_FACTORS)
    for s in fit["strategies"]:
        assert s["compatibility"] == regime_compatibility(s["strategy_key"], regime)
    pairs = next(s for s in fit["strategies"] if s["strategy_key"] == "statistical_arbitrage")
    assert pairs["compatibility"]["status"] == "COMPATIBLE"


def test_regime_rules_by_hand():
    up_calm = {"name": "Low volatility, uptrend", "trend_state": "Uptrend", "volatility_state": "Low volatility"}
    side_wild = {"name": "High volatility, sideways", "trend_state": "Sideways", "volatility_state": "High volatility"}
    status = lambda key, regime: regime_compatibility(key, regime)["status"]  # noqa: E731
    assert status("momentum", up_calm) == "COMPATIBLE"
    assert status("momentum", side_wild) == "NOT_COMPATIBLE"
    assert status("mean_reversion", side_wild) == "COMPATIBLE"
    assert status("volatility_arbitrage", side_wild) == "COMPATIBLE"
    assert status("volatility_arbitrage", up_calm) == "NOT_COMPATIBLE"
    assert status("tactical_asset_allocation", up_calm) == "COMPATIBLE"
    assert status("statistical_arbitrage", side_wild) == "COMPATIBLE"
    assert status("momentum", None) == "UNKNOWN"
    assert "Current regime: High volatility, sideways." in regime_compatibility("momentum", side_wild)["reason"]


def test_without_a_regime_model_fit_is_unknown(world):
    fit = client.get("/scoring/regime-fit").json()
    assert fit["regime"] is None
    assert {s["compatibility"]["status"] for s in fit["strategies"]} == {"UNKNOWN"}


def test_scoring_needs_a_login():
    app.dependency_overrides.pop(get_current_user, None)
    assert client.post("/scoring", json={}).status_code == 401
    assert client.get("/scoring/definitions").status_code == 401
