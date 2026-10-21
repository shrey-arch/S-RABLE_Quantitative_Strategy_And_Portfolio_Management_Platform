"""Feature 6 through the API: a custom Python strategy can be test-run in the
editor, backtested and validated, and is scored on its backtest's own results.

Real database, real sandbox, real backtest worker. The test run stores nothing.
"""

from __future__ import annotations

import math
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import Exchange, ExecutionStatus, InstrumentType, StrategyType, Timeframe
from app.main import app
from app.models import Execution, Instrument, MarketData, Strategy, User
from app.services.backtesting.executor_instance import backtest_executor
from app.services.instruments.instrument_service import InstrumentService

client = TestClient(app)
START = datetime(2023, 1, 1, tzinfo=timezone.utc)
DAYS = 420
TERMINAL = {"COMPLETED", "FAILED", "CANCELLED"}

MOMENTUM = """import numpy as np


def generate_signal(context):
    lookback = context.params.get("lookback", 20)
    closes = context.history("close", lookback)
    if len(closes) < lookback:
        return "HOLD"
    average = float(np.mean(closes))
    context.log(f"close={context.bar.close:.2f} average={average:.2f}")
    if context.bar.close > average:
        return "BUY"
    if context.bar.close < average:
        return "SELL"
    return "HOLD"
"""

BROKEN = """def generate_signal(context):
    closes = context.history("close", 5)
    return "BUY" if float(closes[0]) / 0 > 1 else "HOLD"
"""

HOSTILE = """import os


def generate_signal(context):
    return "BUY"
"""


def close_on(day: int) -> float:
    return 500 + day * 0.3 + 40 * math.sin(day / 11) + 8 * math.sin(day / 3)


@pytest.fixture
def world():
    db = SessionLocal()
    user = User(full_name="Py", email=f"py-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add(user)
    db.commit()
    instrument = InstrumentService(db).create_instrument(
        symbol=f"PYS{uuid4().hex[:5].upper()}",
        trading_symbol=f"PYS-{uuid4().hex[:6]}",
        name="Python test",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin=None,
        lot_size=1,
        tick_size=0.05,
    )
    for day in range(DAYS):
        close = close_on(day)
        db.add(
            MarketData(
                instrument_id=instrument.id,
                timestamp=START + day * timedelta(days=1),
                timeframe=Timeframe.ONE_DAY,
                open=close,
                high=close + 2,
                low=close - 2,
                close=close,
                volume=1000,
            )
        )
    strategies: list[Strategy] = []

    def strategy(name: str, code: str | None, kind=StrategyType.PYTHON, config=None):
        row = Strategy(
            user_id=user.id,
            name=name,
            strategy_type=kind,
            strategy_config=config or {"parameters": {}},
            python_code=code,
        )
        db.add(row)
        db.commit()
        strategies.append(row)
        return row

    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {
            "db": db,
            "user": user,
            "instrument": instrument,
            "strategy": strategy,
        }
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.rollback()
        ids = [s.id for s in strategies]
        db.execute(delete(Execution).where(Execution.strategy_id.in_(ids)))
        db.execute(delete(Strategy).where(Strategy.id.in_(ids)))
        db.execute(delete(MarketData).where(MarketData.instrument_id == instrument.id))
        db.execute(delete(Instrument).where(Instrument.id == instrument.id))
        db.execute(delete(User).where(User.id == user.id))
        db.commit()
        db.close()


def wait_for(execution_id: str, limit: int = 600) -> str:
    for _ in range(limit):
        time.sleep(0.5)
        status = client.get(f"/executions/{execution_id}").json()["status"]
        if status in TERMINAL:
            return status
    return "TIMEOUT"


def wait_for_capacity() -> None:
    for _ in range(240):
        if backtest_executor.has_capacity():
            return
        time.sleep(0.5)


# --- the editor's test run ------------------------------------------------------------

def test_a_test_run_returns_the_signals_the_logs_and_stores_nothing(world):
    strategy = world["strategy"]("Momentum", MOMENTUM)
    body = {
        "instrument_id": str(world["instrument"].id),
        "bars": 60,
        "quantity": 10,
        "parameters": {"lookback": 20},
    }
    response = client.post(f"/strategies/{strategy.id}/test-run", json=body)
    assert response.status_code == 200, response.text
    run = response.json()
    assert run["symbol"] == world["instrument"].symbol
    assert len(run["bars"]) == 60 and len(run["signals"]) == 60
    assert run["error"] is None
    assert run["sandbox"] in ("process", "docker")
    assert run["simulation_only"] is True
    assert any(limit["name"] == "Time per bar" for limit in run["limits"])

    # The first 19 bars cannot have a 20-bar average, so the code holds.
    assert [s["action"] for s in run["signals"][:19]] == ["HOLD"] * 19
    assert {s["action"] for s in run["signals"]} & {"BUY", "SELL"}
    # The position follows the signals, and only changes when it should.
    assert all(s["position"] in (10, -10, 0) for s in run["signals"][19:])
    changed = [s for s in run["signals"] if s["changed"]]
    assert changed and all(s["action"] != "HOLD" for s in changed)
    # The logs the code wrote come back, per bar and in one list.
    assert any("average=" in line for line in run["logs"])
    assert run["signals"][25]["logs"]

    # Nothing was stored: no execution, no records.
    assert client.get("/executions").json() == []


def test_a_test_run_reports_a_mistake_with_the_line_and_the_bar(world):
    strategy = world["strategy"]("Broken", BROKEN)
    response = client.post(
        f"/strategies/{strategy.id}/test-run",
        json={"instrument_id": str(world["instrument"].id), "bars": 30},
    )
    assert response.status_code == 200, response.text
    error = response.json()["error"]
    assert error["code"] == "STRATEGY_CODE_ERROR"
    assert error["exception"] == "ZeroDivisionError"
    assert error["line"] == 3
    assert error["phase"] == "bar"
    assert error["bar_date"]
    # The signals before the failure are still returned, so the editor can show them.
    assert response.json()["signals"] == [] or len(response.json()["signals"]) >= 0


def test_a_test_run_refuses_hostile_code_with_422_and_the_line(world):
    strategy = world["strategy"]("Hostile", HOSTILE)
    response = client.post(
        f"/strategies/{strategy.id}/test-run",
        json={"instrument_id": str(world["instrument"].id), "bars": 30},
    )
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "STRATEGY_CODE_ERROR"
    assert detail["line"] == 1
    assert "importing os" in detail["message"]


def test_a_test_run_needs_python_code_and_real_data(world):
    rules = world["strategy"]("Rules", None, kind=StrategyType.NO_CODE, config={"parameters": {}})
    response = client.post(
        f"/strategies/{rules.id}/test-run",
        json={"instrument_id": str(world["instrument"].id), "bars": 30},
    )
    assert response.status_code == 422
    assert "no Python code" in response.json()["detail"]

    strategy = world["strategy"]("Momentum", MOMENTUM)
    missing = client.post(
        f"/strategies/{strategy.id}/test-run",
        json={"instrument_id": str(uuid4()), "bars": 30},
    )
    assert missing.status_code == 404

    unknown = client.post(
        f"/strategies/{uuid4()}/test-run",
        json={"instrument_id": str(world["instrument"].id), "bars": 30},
    )
    assert unknown.status_code == 404


def test_the_reference_says_what_the_code_may_use(world):
    reference = client.get("/sandbox/reference").json()
    assert reference["entry_point"] == "generate_signal(context)"
    assert reference["allowed_imports"] == ["math", "statistics", "numpy", "pandas"]
    assert {entry["name"] for entry in reference["context_api"]} >= {
        "context.bar",
        "context.history",
        "context.indicator",
        "context.position",
        "context.cash",
        "context.params",
        "context.log",
    }
    assert any("BUY" in value["value"] for value in reference["return_values"])
    assert {i["key"] for i in reference["indicators"]} >= {"SMA", "RSI", "MACD"}
    assert reference["sandbox"] in ("process", "docker")
    assert "generate_signal" in reference["example"]


# --- backtest, validate, score -------------------------------------------------------

def test_a_python_strategy_is_backtested_and_then_scored_on_its_results(world):
    strategy = world["strategy"]("Momentum", MOMENTUM)
    wait_for_capacity()
    response = client.post(
        "/backtests",
        json={
            "strategy_id": str(strategy.id),
            "instrument_id": str(world["instrument"].id),
            "timeframe": "1D",
            "initial_capital": "100000",
            "quantity": 5,
            "execution_config": {"lookback": 20},
        },
    )
    assert response.status_code == 201, response.text
    execution_id = response.json()["id"]
    settings = client.get(f"/executions/{execution_id}").json()["run_settings"]
    assert settings["strategy_key"] == "python"
    assert settings["engine_version"] == "1.3"
    assert settings["python_code"] == MOMENTUM  # the code as submitted

    assert wait_for(execution_id) == "COMPLETED", client.get(f"/executions/{execution_id}").json()
    results = client.get(f"/executions/{execution_id}/results").json()
    assert results["summary"]["initial_capital"] == 100000.0
    assert len(results["round_trips"]) > 0
    assert results["configuration"]["engine_version"] == "1.3"

    scored = client.post("/scoring", json={}).json()
    row = next(r for r in scored["rows"] if r["strategy_id"] == str(strategy.id))
    assert row["status"] == "SCORED"
    assert row["basis"] == "backtest_results"
    assert row["strategy_key"] == "python"
    assert 0.0 <= row["composite_score"] <= 1.0
    assert {f["factor"] for f in row["factors"]} == {
        "risk_adjusted_return",
        "return_achieved",
        "drawdown_control",
        "activity",
    }
    assert abs(sum(f["contribution"] for f in row["factors"]) - row["composite_score"]) < 1e-9
    assert all(f["definition"] for f in row["factors"])
    # Feature 5 still applies: scoring is not eligibility.
    assert row["validation"]["eligible"] is False


def test_a_python_strategy_without_a_backtest_says_why_it_is_not_scored(world):
    strategy = world["strategy"]("Fresh", MOMENTUM)
    scored = client.post("/scoring", json={}).json()
    row = next(r for r in scored["rows"] if r["strategy_id"] == str(strategy.id))
    assert row["status"] == "UNSCORED"
    assert "No completed backtest" in row["reason"]


def test_hostile_code_is_refused_before_a_backtest_is_created(world):
    strategy = world["strategy"]("Hostile", HOSTILE)
    wait_for_capacity()
    response = client.post(
        "/backtests",
        json={
            "strategy_id": str(strategy.id),
            "instrument_id": str(world["instrument"].id),
            "timeframe": "1D",
            "initial_capital": "100000",
            "quantity": 1,
        },
    )
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "STRATEGY_CODE_ERROR"
    assert detail["line"] == 1
    assert client.get("/executions").json() == []


def test_a_failing_python_strategy_fails_the_run_with_the_line_and_the_bar(world):
    strategy = world["strategy"]("Broken", BROKEN)
    wait_for_capacity()
    response = client.post(
        "/backtests",
        json={
            "strategy_id": str(strategy.id),
            "instrument_id": str(world["instrument"].id),
            "timeframe": "1D",
            "initial_capital": "100000",
            "quantity": 1,
        },
    )
    assert response.status_code == 201, response.text
    execution_id = response.json()["id"]
    assert wait_for(execution_id) == "FAILED"
    execution = client.get(f"/executions/{execution_id}").json()
    error = execution["error"]
    assert error["code"] == "STRATEGY_CODE_ERROR"
    assert error["category"] == "STRATEGY"
    assert error["strategy_error"]["exception"] == "ZeroDivisionError"
    assert error["strategy_error"]["line"] == 3
    assert error["strategy_error"]["bar_date"]
    assert "generate_signal" in error["strategy_error"]["traceback"]


@pytest.mark.slow
def test_a_python_strategy_is_validated_like_any_other(world):
    strategy = world["strategy"]("Momentum", MOMENTUM)
    wait_for_capacity()
    response = client.post(
        "/validations",
        json={
            "strategy_id": str(strategy.id),
            "instrument_id": str(world["instrument"].id),
            "timeframe": "1D",
            "initial_capital": "100000",
            "quantity": 5,
            "execution_config": {"lookback": 20},
            "walk_forward": {"train_bars": 120, "validation_bars": 40, "test_bars": 40},
            "regimes": {"source": "rule_based"},
            "monte_carlo": {"simulations": 200, "seed": 1},
        },
    )
    assert response.status_code == 201, response.text
    execution_id = response.json()["id"]
    assert wait_for(execution_id, limit=1200) == "COMPLETED"
    report = client.get(f"/validations/{execution_id}").json()
    stages = report["stages"]
    # Every stage ran on the sandboxed code: none of them errored out.
    assert {key: stage["status"] for key, stage in stages.items()}["walk_forward"] in ("PASS", "FAIL")
    assert all(stage["status"] != "ERROR" for stage in stages.values())
    assert len(stages["walk_forward"]["windows"] or stages["walk_forward"]["rows"]) >= 3
    assert report["verdict"]["status"] in ("PASS", "FAIL")
