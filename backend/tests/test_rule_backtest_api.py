"""Phase 10.5: POST /backtests runs a no-code strategy's saved rules, end to end
(database and real backtest worker), and its results come back like any other run."""

import math
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.backtesting.engine import BacktestEngine
from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import Exchange, InstrumentType, StrategyType, Timeframe
from app.main import app
from app.models import Execution, Instrument, MarketData, Strategy, User
from app.services.backtesting.executor_instance import backtest_executor
from app.services.instruments.instrument_service import InstrumentService
from app.strategies.rule_strategy import RULES_KEY, RuleStrategy

client = TestClient(app)
START = datetime(2024, 1, 1, tzinfo=timezone.utc)
DAYS = 160
TERMINAL = {"COMPLETED", "FAILED", "CANCELLED"}

RULES = {
    "parameters": {},
    "indicators": [
        {"name": "fast", "type": "SMA", "parameters": {"window": 5}},
        {"name": "slow", "type": "SMA", "parameters": {"window": 20}},
    ],
    "entry_conditions": [
        {"left": {"type": "indicator", "name": "fast", "output": "value"}, "operator": ">",
         "right": {"type": "indicator", "name": "slow", "output": "value"}},
    ],
    "exit_conditions": [
        {"left": {"type": "indicator", "name": "fast", "output": "value"}, "operator": "<",
         "right": {"type": "indicator", "name": "slow", "output": "value"}},
    ],
}


def close_on(day: int) -> float:
    return 500 + day * 0.5 + 40 * math.sin(day / 11)


@pytest.fixture
def world():
    db = SessionLocal()
    user = User(full_name="Rules", email=f"rules-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add(user)
    db.commit()
    instruments = []
    for n in range(2):
        instrument = InstrumentService(db).create_instrument(
            symbol=f"RUL{n}",
            trading_symbol=f"RUL{n}-{uuid4().hex[:6]}",
            name=f"Rules {n}",
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
        instruments.append(instrument)

    def strategy(name, kind, config, code=None):
        row = Strategy(
            user_id=user.id,
            name=name,
            strategy_type=kind,
            strategy_config=config,
            python_code=code,
        )
        db.add(row)
        return row

    rows = {
        "rules": strategy("SMA cross", StrategyType.NO_CODE, RULES),
        "no_entry": strategy("No entry", StrategyType.NO_CODE, {**RULES, "entry_conditions": []}),
        "text_value": strategy(
            "Text value",
            StrategyType.NO_CODE,
            {
                **RULES,
                "entry_conditions": [
                    {"left": {"type": "price", "field": "close"}, "operator": ">",
                     "right": {"type": "value", "value": "high"}},
                ],
            },
        ),
        "python": strategy(
            "My code",
            StrategyType.PYTHON,
            {"parameters": {}, "indicators": [], "entry_conditions": [], "exit_conditions": []},
            "def generate_signal(context):\n    return None\n",
        ),
    }
    db.commit()
    for row in rows.values():
        db.refresh(row)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {"db": db, "user": user, "instruments": instruments, **rows}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        wait_for_worker()
        ids = [r.id for r in rows.values()]
        db.execute(delete(Execution).where(Execution.strategy_id.in_(ids)))
        db.execute(delete(Strategy).where(Strategy.id.in_(ids)))
        db.execute(delete(MarketData).where(MarketData.instrument_id.in_([i.id for i in instruments])))
        db.execute(delete(Instrument).where(Instrument.id.in_([i.id for i in instruments])))
        db.execute(delete(User).where(User.id == user.id))
        db.commit()
        db.close()


def wait_for_worker(seconds=60):
    deadline = time.time() + seconds
    while not backtest_executor.has_capacity() and time.time() < deadline:
        time.sleep(0.2)


def body(world, strategy="rules", **overrides):
    payload = {
        "strategy_id": str(world[strategy].id),
        "instrument_id": str(world["instruments"][0].id),
        "timeframe": "1D",
        "initial_capital": 100000,
        "start_timestamp": START.isoformat(),
        "end_timestamp": (START + timedelta(days=DAYS - 1)).isoformat(),
        "quantity": 10,
    }
    payload.update(overrides)
    return payload


def run_to_end(payload):
    wait_for_worker()
    created = client.post("/backtests", json=payload)
    assert created.status_code == 201, created.text
    execution = created.json()
    deadline = time.time() + 90
    while execution["status"] not in TERMINAL and time.time() < deadline:
        time.sleep(0.3)
        execution = client.get(f"/executions/{execution['id']}").json()
    return execution


def test_a_no_code_strategy_backtests_its_saved_rules(world):
    execution = run_to_end(body(world))
    assert execution["status"] == "COMPLETED", execution["error"]
    assert execution["execution_config"] == {}
    settings = execution["run_settings"]
    assert settings["strategy_key"] == RULES_KEY
    assert settings["engine_version"] == "1.3"
    assert settings["rules"] == RULES

    # The worker's trades are exactly those of the rules run on the same prices.
    index = pd.DatetimeIndex([START + timedelta(days=d) for d in range(DAYS)])
    closes = [close_on(d) for d in range(DAYS)]
    data = pd.DataFrame(
        {
            "open": closes,
            "high": [c + 2 for c in closes],
            "low": [c - 2 for c in closes],
            "close": closes,
            "volume": [1000.0] * DAYS,
        },
        index=index,
    )
    expected = BacktestEngine().run(
        strategy=RuleStrategy(RULES),
        data=data,
        execution_id=uuid4(),
        instrument_id=world["instruments"][0].id,
        initial_capital=100000.0,
        quantity=10,
    )
    stored = execution["execution_metrics"]["canonical_result"]["trades"]
    assert len(stored) == len(expected.trades) >= 3
    for got, want in zip(stored, expected.trades):
        assert got["side"] == want["side"]
        assert got["quantity"] == want["quantity"]
        assert got["price"] == pytest.approx(want["price"])
        assert pd.Timestamp(got["timestamp"]) == pd.Timestamp(want["timestamp"])
    # Long only: the position never goes below zero.
    held = 0
    for trade in stored:
        held += trade["quantity"] if trade["side"] == "BUY" else -trade["quantity"]
        assert held in (0, 10)

    results = client.get(f"/executions/{execution['id']}/results")
    assert results.status_code == 200, results.text
    configuration = results.json()["configuration"]
    assert configuration["strategy_key"] == RULES_KEY
    assert configuration["rules"] == RULES
    assert configuration["parameters"] == {}
    assert configuration["engine_version"] == "1.3"


@pytest.mark.parametrize(
    "strategy,overrides,message",
    [
        ("rules", {"execution_config": {"lookback": 5}}, "it has no per-run parameters"),
        ("rules", {"other_instrument_ids": ["__second__"]}, "A no-code strategy uses one instrument"),
        ("rules", {"strategy_key": "momentum"}, "does not match the strategy"),
        ("no_entry", {}, "Add at least one entry condition"),
        ("text_value", {}, "Condition values must be numbers"),
    ],
)
def test_no_code_requests_that_cannot_run_are_refused(world, strategy, overrides, message):
    if overrides.get("other_instrument_ids") == ["__second__"]:
        overrides = {"other_instrument_ids": [str(world["instruments"][1].id)]}
    response = client.post("/backtests", json=body(world, strategy, **overrides))
    assert response.status_code == 422, response.text
    assert message in response.text
    assert client.get("/executions").json() == []
