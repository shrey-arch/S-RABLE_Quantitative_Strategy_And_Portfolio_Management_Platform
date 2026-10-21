"""Phase 11: POST /validations runs the pipeline in the real backtest worker; GET
/validations and /validations/{id} show it, with stages, checks and thresholds."""

import json
import math
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import Exchange, InstrumentType, StrategyType, Timeframe
from app.main import app
from app.models import Execution, Instrument, MarketData, Strategy, User
from app.services.backtesting.executor_instance import backtest_executor
from app.services.instruments.instrument_service import InstrumentService

client = TestClient(app)
START = datetime(2023, 1, 2, tzinfo=timezone.utc)
DAYS = 260
TERMINAL = {"COMPLETED", "FAILED", "CANCELLED"}

RULES = {
    "parameters": {},
    "indicators": [
        {"name": "fast", "type": "SMA", "parameters": {"window": 5}},
        {"name": "slow", "type": "SMA", "parameters": {"window": 15}},
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

SMALL = {
    "walk_forward": {"train_bars": 40, "validation_bars": 20, "test_bars": 20},
    "regimes": {"trend_window": 50, "volatility_window": 10},
    "monte_carlo": {"simulations": 200, "seed": 11},
}


def close_on(day: int) -> float:
    return 500 + day * 0.4 + 30 * math.sin(day / 9) + 12 * math.sin(day / 2.3)


@pytest.fixture
def world():
    db = SessionLocal()
    user = User(full_name="Validator", email=f"val-{uuid4().hex[:8]}@example.com", password_hash="x")
    other = User(full_name="Other", email=f"oth-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add_all([user, other])
    db.commit()
    instrument = InstrumentService(db).create_instrument(
        symbol="VAL",
        trading_symbol=f"VAL-{uuid4().hex[:6]}",
        name="Validation test",
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
                timestamp=START + timedelta(days=day),
                timeframe=Timeframe.ONE_DAY,
                open=close,
                high=close + 2,
                low=close - 2,
                close=close,
                volume=1000,
            )
        )

    def strategy(name, kind, config, owner=user):
        row = Strategy(user_id=owner.id, name=name, strategy_type=kind, strategy_config=config)
        db.add(row)
        return row

    rows = {
        "momentum": strategy(
            "Momentum",
            StrategyType.PYTHON,
            {"parameters": {"template": "momentum", "lookback": 10}, "indicators": [],
             "entry_conditions": [], "exit_conditions": []},
        ),
        "rules": strategy("SMA cross", StrategyType.NO_CODE, RULES),
        "meanrev": strategy(
            "Mean reversion",
            StrategyType.PYTHON,
            {"parameters": {"template": "mean_reversion"}, "indicators": [],
             "entry_conditions": [], "exit_conditions": []},
        ),
        "theirs": strategy(
            "Not mine",
            StrategyType.PYTHON,
            {"parameters": {"template": "momentum"}, "indicators": [],
             "entry_conditions": [], "exit_conditions": []},
            owner=other,
        ),
    }
    db.commit()
    for row in rows.values():
        db.refresh(row)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {"db": db, "user": user, "other": other, "instrument": instrument, **rows}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        wait_for_worker()
        ids = [r.id for r in rows.values()]
        db.execute(delete(Execution).where(Execution.strategy_id.in_(ids)))
        db.execute(delete(Strategy).where(Strategy.id.in_(ids)))
        db.execute(delete(MarketData).where(MarketData.instrument_id == instrument.id))
        db.execute(delete(Instrument).where(Instrument.id == instrument.id))
        db.execute(delete(User).where(User.id.in_([user.id, other.id])))
        db.commit()
        db.close()


def wait_for_worker(seconds=120):
    deadline = time.time() + seconds
    while not backtest_executor.has_capacity() and time.time() < deadline:
        time.sleep(0.2)


def body(world, strategy="momentum", **overrides):
    payload = {
        "strategy_id": str(world[strategy].id),
        "instrument_id": str(world["instrument"].id),
        "timeframe": "1D",
        "initial_capital": 100000,
        "start_timestamp": START.isoformat(),
        "end_timestamp": (START + timedelta(days=DAYS - 1)).isoformat(),
        "quantity": 20,
        "slippage_bps": 5,
        "brokerage_rate": 0.0003,
        **json.loads(json.dumps(SMALL)),
    }
    payload.update(overrides)
    return payload


def run_to_end(payload):
    wait_for_worker()
    created = client.post("/validations", json=payload)
    assert created.status_code == 201, created.text
    execution = created.json()
    assert execution["execution_type"] == "VALIDATION"
    deadline = time.time() + 120
    report = None
    while time.time() < deadline:
        report = client.get(f"/validations/{execution['id']}").json()
        if report["status"] in TERMINAL:
            break
        time.sleep(0.3)
    return report


def test_a_validation_runs_every_stage_and_reports_the_evidence(world):
    payload = body(world, walk_forward={**SMALL["walk_forward"], "parameter_grid": {"lookback": [5, 10]}})
    report = run_to_end(payload)
    assert report["status"] == "COMPLETED", report.get("error")
    stages = report["stages"]
    assert report["stage_statuses"] == {k: stages[k]["status"] for k in stages}
    for key in ("backtest", "walk_forward", "regime_stress", "monte_carlo"):
        assert stages[key]["status"] in {"PASS", "FAIL"}, stages[key]
        for check in stages[key]["checks"]:
            assert check["passed"] == (
                check["value"] is not None
                and {
                    ">": check["value"] > check["threshold"],
                    ">=": check["value"] >= check["threshold"],
                    "<": check["value"] < check["threshold"],
                    "<=": check["value"] <= check["threshold"],
                }[check["operator"]]
            )
    assert stages["paper_trading"]["status"] == "NOT_RUN"
    all_pass = all(stages[k]["status"] == "PASS" for k in ("backtest", "walk_forward", "regime_stress", "monte_carlo"))
    assert report["verdict"]["status"] == ("PASS" if all_pass else "FAIL")

    wf = stages["walk_forward"]
    assert len(wf["windows"]) == (DAYS - 80) // 20 + 1
    assert wf["settings"]["candidates"] == 2
    assert {w["parameters"]["lookback"] for w in wf["windows"]} <= {5, 10}
    assert len(stages["backtest"]["equity_curve"]) == DAYS
    assert len(stages["regime_stress"]["regimes"]) == 4
    assert stages["regime_stress"]["method"]["trend_window"] == 50
    bootstrap = stages["monte_carlo"]["bootstrap"]
    assert (bootstrap["seed"], bootstrap["simulations"]) == (11, 200)
    assert stages["monte_carlo"]["significance"]["permutations"] == 200

    c = report["configuration"]
    assert c["strategy_key"] == "momentum"
    assert c["parameters"] == {}
    assert c["walk_forward"]["step_bars"] == 20
    assert c["walk_forward"]["parameter_grid"] == {"lookback": [5, 10]}
    assert c["monte_carlo"] == {"simulations": 200, "seed": 11}
    assert c["regimes"]["source"] == "rule_based"
    assert c["validation_version"] == "1.1"
    assert {t["stage"] for t in report["thresholds"]} == {
        "backtest", "walk_forward", "regime_stress", "monte_carlo", "paper_trading"
    }
    assert report["thresholds_source"].startswith("BE Synopsis")
    assert report["bars"] == DAYS
    assert report["data_provenance"]["data_fingerprint"]

    # The same seed and data reproduce the Monte Carlo results exactly.
    again = run_to_end(payload)
    assert again["stages"]["monte_carlo"]["bootstrap"] == bootstrap
    assert again["stages"]["monte_carlo"]["significance"] == stages["monte_carlo"]["significance"]

    listed = client.get("/validations").json()
    assert [v["id"] for v in listed] == [again["id"], report["id"]]
    assert listed[1]["verdict"] == report["verdict"]
    assert listed[1]["strategy_name"] == "Momentum"
    # Backtest history does not list validations.
    assert client.get("/executions", params={"execution_type": "BACKTEST"}).json() == []


def test_a_no_code_strategy_is_validated_with_its_saved_rules(world):
    report = run_to_end(body(world, "rules"))
    assert report["status"] == "COMPLETED", report.get("error")
    assert report["configuration"]["rules"] == RULES
    assert report["configuration"]["strategy_key"] == "no_code_rules"
    assert report["stages"]["backtest"]["metrics"]["trade_count"] > 0


def test_a_backtest_can_be_the_source_of_a_validation(world):
    wait_for_worker()
    backtest = client.post(
        "/backtests",
        json={k: v for k, v in body(world).items() if k not in SMALL},
    ).json()
    wait_for_worker()
    report = run_to_end(body(world, source_execution_id=backtest["id"]))
    assert report["source_execution_id"] == backtest["id"]
    assert report["configuration"]["source_execution_id"] == backtest["id"]


@pytest.mark.parametrize(
    "strategy,overrides,message",
    [
        ("momentum", {"walk_forward": {"train_bars": 100, "validation_bars": 50, "test_bars": 50}},
         "Walk-forward needs at least 5 windows. With 260 daily bars"),
        ("rules", {"walk_forward": {**SMALL["walk_forward"], "parameter_grid": {"lookback": [5]}}},
         "A no-code strategy has no parameters to search"),
        ("momentum", {"walk_forward": {**SMALL["walk_forward"], "parameter_grid": {"window": [5]}}},
         "momentum has no parameter named window"),
        ("momentum", {"walk_forward": {**SMALL["walk_forward"], "parameter_grid": {"lookback": [0, 5]}}},
         "Grid values lookback = 0: lookback must be greater than 0."),
        ("meanrev", {"walk_forward": {**SMALL["walk_forward"], "parameter_grid": {"lookback": list(range(5, 15)), "entry_threshold": [1.0, 1.5, 2.0]}}},
         "The parameter grid has 30 combinations; at most 25"),
        ("momentum", {"regimes": {"trend_window": 250, "volatility_window": 20}},
         "Regime stress needs more than 270 daily bars"),
        ("momentum", {"monte_carlo": {"simulations": 50, "seed": 1}}, "greater than or equal to 100"),
        ("momentum", {"source_execution_id": str(uuid4())}, "source_execution_id is not one of your backtests"),
        ("theirs", {}, "Strategy not found."),
    ],
)
def test_requests_that_cannot_run_are_refused(world, strategy, overrides, message):
    response = client.post("/validations", json=body(world, strategy, **overrides))
    assert response.status_code in (404, 422), response.text
    assert message in response.text
    assert client.get("/validations").json() == []


def test_one_run_at_a_time(world, monkeypatch):
    from app.api.backtesting import routes as backtest_routes

    class Busy:
        def has_capacity(self):
            return False

    monkeypatch.setattr(backtest_routes, "_executor", Busy())
    response = client.post("/validations", json=body(world))
    assert response.status_code == 409
    assert "Another backtest or validation is running" in response.text


def test_only_the_owner_sees_a_validation(world):
    report = run_to_end(body(world))
    app.dependency_overrides[get_current_user] = lambda: world["other"]
    assert client.get(f"/validations/{report['id']}").status_code == 404
    assert client.get("/validations").json() == []
    app.dependency_overrides[get_current_user] = lambda: world["user"]
    # A backtest id is not a validation.
    wait_for_worker()
    backtest = client.post(
        "/backtests", json={k: v for k, v in body(world).items() if k not in SMALL}
    ).json()
    assert client.get(f"/validations/{backtest['id']}").status_code == 404


def test_a_cancelled_validation_says_so(world):
    wait_for_worker()
    created = client.post("/validations", json=body(world)).json()
    cancelled = client.post(f"/executions/{created['id']}/cancel")
    report = client.get(f"/validations/{created['id']}").json()
    if cancelled.status_code == 200:
        assert report["status"] == "CANCELLED"
        assert report["verdict"] == {"status": "INCOMPLETE", "reason": "The validation was cancelled."}
    else:  # it finished first
        assert report["status"] == "COMPLETED"


def test_a_validation_left_running_by_a_restart_is_marked_failed(world):
    from app.enums import ExecutionStatus, ExecutionType
    from app.services.backtesting.startup import fail_stranded_backtests
    from app.services.executions.execution_service import ExecutionService

    db = world["db"]
    execution = ExecutionService(db).create_execution(
        strategy_id=world["momentum"].id,
        broker_account_id=None,
        instrument_id=world["instrument"].id,
        execution_type=ExecutionType.VALIDATION,
        status=ExecutionStatus.PENDING,
        timeframe="1D",
        initial_capital=100000,
        execution_config={},
        run_settings={},
    )
    assert fail_stranded_backtests() >= 1
    report = client.get(f"/validations/{execution.id}").json()
    assert report["status"] == "FAILED"
    assert report["error"]["code"] == "BACKTEST_WORKER_LOST"
    assert report["verdict"]["status"] == "INCOMPLETE"
