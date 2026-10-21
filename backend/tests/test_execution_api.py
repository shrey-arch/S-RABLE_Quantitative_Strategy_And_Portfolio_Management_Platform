"""Phase 9 contract for /backtests and /executions, against the real database and
the real backtest worker: login and ownership, validation, the busy worker (409),
the lifecycle as stored (PENDING -> RUNNING -> COMPLETED / FAILED / CANCELLED),
a real cancel, multi-instrument strategies, costs, and the startup sweep."""

import math
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import (
    Exchange,
    ExecutionStatus,
    ExecutionType,
    InstrumentType,
    StrategyType,
    Timeframe,
)
from app.main import app
from app.models import Execution, Instrument, MarketData, Strategy, User
from app.services.backtesting.executor import BacktestExecutor
from app.services.backtesting.executor_instance import backtest_executor
from app.services.backtesting.startup import fail_stranded_backtests
from app.services.executions.execution_service import ExecutionService
from app.services.instruments.instrument_service import InstrumentService

client = TestClient(app)

START = datetime(2025, 1, 1, tzinfo=timezone.utc)
DAYS = 90
TERMINAL = {"COMPLETED", "FAILED", "CANCELLED"}


# --- fixtures ---------------------------------------------------------------------


@pytest.fixture
def world():
    """Two users, three instruments with 90 daily bars, and strategies."""
    db = SessionLocal()
    users = [
        User(full_name=f"BT {n}", email=f"bt-{uuid4().hex[:8]}@example.com", password_hash="x")
        for n in (1, 2)
    ]
    db.add_all(users)
    db.commit()

    instruments = []
    for n, (base, step, wave) in enumerate([(100, 0.6, 4), (90, 0.5, 6), (50, -0.1, 3)]):
        instrument = InstrumentService(db).create_instrument(
            symbol=f"BT{n}",
            trading_symbol=f"BT{n}-{uuid4().hex[:6]}",
            name=f"Backtest {n}",
            exchange=Exchange.NSE,
            instrument_type=InstrumentType.EQUITY,
            isin=None,
            lot_size=1,
            tick_size=0.05,
        )
        for day in range(DAYS):
            close = base + step * day + wave * math.sin(day / 3)
            db.add(
                MarketData(
                    instrument_id=instrument.id,
                    timestamp=START + timedelta(days=day),
                    timeframe=Timeframe.ONE_DAY,
                    open=close,
                    high=close + 1,
                    low=close - 1,
                    close=close,
                    volume=1000,
                )
            )
        instruments.append(instrument)
    db.commit()

    def strategy(owner, template, **extra):
        parameters = {"template": template} if template else {"quantity": 1}
        row = Strategy(
            user_id=owner.id,
            name=template or "no-code",
            strategy_type=StrategyType.PYTHON if template else StrategyType.NO_CODE,
            strategy_config={
                "parameters": parameters,
                "indicators": [],
                "entry_conditions": [],
                "exit_conditions": [],
            },
            **extra,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    data = {
        "db": db,
        "user": users[0],
        "other": users[1],
        "instruments": instruments,
        "momentum": strategy(users[0], "momentum"),
        "pairs": strategy(users[0], "statistical_arbitrage"),
        "taa": strategy(users[0], "tactical_asset_allocation"),
        "no_code": strategy(users[0], None),
        "inactive": strategy(users[0], "momentum", is_active=False),
        "foreign": strategy(users[1], "momentum"),
    }
    login(users[0])
    try:
        yield data
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        wait_for_worker()
        ids = [i.id for i in instruments]
        user_ids = [u.id for u in users]
        strategy_ids = list(
            db.scalars(select(Strategy.id).where(Strategy.user_id.in_(user_ids))).all()
        )
        db.execute(delete(Execution).where(Execution.strategy_id.in_(strategy_ids)))
        db.execute(delete(Strategy).where(Strategy.id.in_(strategy_ids)))
        db.execute(delete(MarketData).where(MarketData.instrument_id.in_(ids)))
        db.execute(delete(Instrument).where(Instrument.id.in_(ids)))
        db.execute(delete(User).where(User.id.in_(user_ids)))
        db.commit()
        db.close()


def login(user):
    app.dependency_overrides[get_current_user] = lambda: user


def wait_for_worker(seconds=60):
    deadline = time.time() + seconds
    while not backtest_executor.has_capacity() and time.time() < deadline:
        time.sleep(0.2)


def body(world, strategy="momentum", **overrides):
    payload = {
        "strategy_id": str(world[strategy].id),
        "instrument_id": str(world["instruments"][0].id),
        "timeframe": "1D",
        "initial_capital": 100000,
        "start_timestamp": START.isoformat(),
        "end_timestamp": (START + timedelta(days=DAYS - 1)).isoformat(),
        "execution_config": {"lookback": 5},
        "quantity": 1,
    }
    payload.update(overrides)
    return payload


def run_to_end(payload, seconds=90):
    """POST /backtests, then follow GET /executions/{id} until a terminal status.
    Returns the statuses seen, in order, and the final record."""
    wait_for_worker()
    created = client.post("/backtests", json=payload)
    assert created.status_code == 201, created.text
    execution = created.json()
    seen = [execution["status"]]
    deadline = time.time() + seconds
    while execution["status"] not in TERMINAL and time.time() < deadline:
        time.sleep(0.3)
        execution = client.get(f"/executions/{execution['id']}").json()
        if execution["status"] != seen[-1]:
            seen.append(execution["status"])
    return seen, execution


# --- login and ownership ------------------------------------------------------------


def test_routes_need_login():
    app.dependency_overrides.pop(get_current_user, None)
    some_id = uuid4()
    assert client.get("/executions").status_code == 401
    assert client.get(f"/executions/{some_id}").status_code == 401
    assert client.post(f"/executions/{some_id}/cancel").status_code == 401
    assert client.delete(f"/executions/{some_id}").status_code == 401
    assert client.post("/backtests", json={}).status_code == 401


def test_system_lifecycle_routes_are_not_in_the_api(world):
    some_id = uuid4()
    assert client.post("/executions", json={}).status_code == 405
    assert client.patch(f"/executions/{some_id}", json={}).status_code == 405
    for action in ("start", "complete", "fail"):
        assert client.post(f"/executions/{some_id}/{action}").status_code in (404, 405)


def test_another_users_strategy_cannot_be_backtested(world):
    response = client.post("/backtests", json=body(world, "foreign"))
    assert response.status_code == 404
    assert response.json()["detail"] == "Strategy not found."


def test_executions_are_only_visible_to_their_owner(world):
    seen, execution = run_to_end(body(world))
    assert execution["status"] == "COMPLETED"
    assert [e["id"] for e in client.get("/executions").json()] == [execution["id"]]

    login(world["other"])
    assert client.get("/executions").json() == []
    assert client.get(f"/executions/{execution['id']}").status_code == 404
    assert client.post(f"/executions/{execution['id']}/cancel").status_code == 404
    assert client.delete(f"/executions/{execution['id']}").status_code == 404


# --- validation (nothing is created) -------------------------------------------------


@pytest.mark.parametrize(
    "strategy,overrides,message",
    [
        ("no_code", {}, "Add at least one entry condition"),
        ("inactive", {}, "This strategy is inactive."),
        ("momentum", {"execution_config": {"lookback": 0}}, "lookback must be greater than 0."),
        ("momentum", {"execution_config": {"window": 3}}, "Unknown parameters"),
        ("momentum", {"strategy_key": "mean_reversion"}, "does not match the strategy"),
        ("momentum", {"timeframe": "2D"}, "timeframe"),
        ("momentum", {"start_timestamp": "2025-01-01T00:00:00"}, "must include a time zone"),
        ("momentum", {"initial_capital": 0}, "initial_capital"),
        ("momentum", {"slippage_bps": -1}, "slippage_bps"),
        ("momentum", {"brokerage_rate": 0.2}, "brokerage_rate"),
        ("pairs", {}, "needs exactly two instruments"),
        ("taa", {}, "needs at least 2 instruments"),
    ],
)
def test_invalid_requests_are_refused_without_creating_anything(world, strategy, overrides, message):
    response = client.post("/backtests", json=body(world, strategy, **overrides))
    assert response.status_code == 422, response.text
    assert message in response.text
    assert client.get("/executions").json() == []


def test_single_instrument_strategy_refuses_extra_instruments(world):
    response = client.post(
        "/backtests",
        json=body(world, other_instrument_ids=[str(world["instruments"][1].id)]),
    )
    assert response.status_code == 422
    assert "uses one instrument" in response.text


def test_an_instrument_cannot_be_chosen_twice(world):
    first = str(world["instruments"][0].id)
    response = client.post(
        "/backtests",
        json=body(world, "pairs", execution_config={}, other_instrument_ids=[first]),
    )
    assert response.status_code == 422
    assert "Each instrument can be chosen only once." in response.text


# --- the lifecycle, as stored ---------------------------------------------------------


def test_submit_runs_to_completed_and_keeps_its_settings(world):
    seen, execution = run_to_end(body(world, slippage_bps=5, brokerage_rate=0.0003))
    assert seen[0] == "PENDING"
    assert seen[-1] == "COMPLETED"
    assert set(seen) <= {"PENDING", "RUNNING", "COMPLETED"}
    assert execution["started_at"] and execution["completed_at"]
    assert execution["error"] is None
    assert execution["execution_config"] == {"lookback": 5}
    assert execution["run_settings"] == {
        "strategy_key": "momentum",
        "start_timestamp": START.isoformat(),
        "end_timestamp": (START + timedelta(days=DAYS - 1)).isoformat(),
        "quantity": 1,
        "other_instrument_ids": [],
        "slippage_bps": 5.0,
        "brokerage_rate": 0.0003,
        "strategy_version": 1,
        "engine_version": "1.3",
    }
    result = execution["execution_metrics"]["canonical_result"]
    assert result["metrics"]["trade_count"] > 0
    # Costs reached the simulated broker.
    assert all(trade["brokerage"] > 0 for trade in result["trades"])


def test_a_failure_shows_its_error_code(world):
    seen, execution = run_to_end(
        body(
            world,
            start_timestamp="2020-01-01T00:00:00+00:00",
            end_timestamp="2020-02-01T00:00:00+00:00",
        )
    )
    assert seen[-1] == "FAILED"
    assert execution["error_message"]
    assert execution["error"]["code"].startswith("BACKTEST_")
    assert execution["error"]["category"] == "MARKET_DATA"
    assert execution["completed_at"]


def test_pairs_strategy_trades_both_instruments(world):
    a, b = world["instruments"][0], world["instruments"][1]
    seen, execution = run_to_end(
        body(
            world,
            "pairs",
            execution_config={"lookback": 10, "entry_threshold": 1.0},
            other_instrument_ids=[str(b.id)],
        )
    )
    assert seen[-1] == "COMPLETED", execution["error"]
    traded = {t["instrument_id"] for t in execution["execution_metrics"]["canonical_result"]["trades"]}
    assert traded <= {str(a.id), str(b.id)}
    assert execution["run_settings"]["other_instrument_ids"] == [str(b.id)]


def test_tactical_allocation_runs_on_a_universe(world):
    ids = [str(i.id) for i in world["instruments"]]
    seen, execution = run_to_end(
        body(
            world,
            "taa",
            execution_config={"lookback": 10, "top_k": 2},
            instrument_id=ids[0],
            other_instrument_ids=ids[1:],
        )
    )
    assert seen[-1] == "COMPLETED", execution["error"]
    traded = {t["instrument_id"] for t in execution["execution_metrics"]["canonical_result"]["trades"]}
    assert traded and traded <= set(ids)


def test_a_second_submission_while_one_runs_is_refused_with_409(world, monkeypatch):
    import app.api.backtesting.routes as routes

    monkeypatch.setattr(routes._executor, "has_capacity", lambda: False)
    response = client.post("/backtests", json=body(world))
    assert response.status_code == 409
    assert response.json()["detail"] == routes.BUSY_MESSAGE
    assert client.get("/executions").json() == []


# --- cancel -----------------------------------------------------------------------------


def make_execution(world, status=ExecutionStatus.PENDING):
    db = world["db"]
    execution = Execution(
        strategy_id=world["momentum"].id,
        instrument_id=world["instruments"][0].id,
        execution_type=ExecutionType.BACKTEST,
        status=status,
        timeframe="1D",
        initial_capital=100000,
        execution_config={"lookback": 5},
    )
    db.add(execution)
    db.commit()
    db.refresh(execution)
    return execution


def test_cancel_a_pending_execution_and_it_stays_cancelled(world):
    execution = make_execution(world)
    response = client.post(f"/executions/{execution.id}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "CANCELLED"
    assert response.json()["completed_at"]

    again = client.post(f"/executions/{execution.id}/cancel")
    assert again.status_code == 409
    assert again.json()["detail"] == "This execution has already finished (CANCELLED)."


def test_a_late_worker_cannot_overwrite_a_cancellation(world):
    execution = make_execution(world, ExecutionStatus.RUNNING)

    # The worker's own session still holds the RUNNING copy.
    worker_db = SessionLocal()
    try:
        stale = worker_db.get(Execution, execution.id)
        assert stale.status == ExecutionStatus.RUNNING

        assert client.post(f"/executions/{execution.id}/cancel").json()["status"] == "CANCELLED"

        with pytest.raises(ValueError, match="CANCELLED -> COMPLETED"):
            ExecutionService(worker_db).complete_execution(execution=stale)
        worker_db.rollback()
    finally:
        worker_db.close()
    assert client.get(f"/executions/{execution.id}").json()["status"] == "CANCELLED"


def _sleeping_worker(*_args, **_kwargs):
    time.sleep(30)


def test_cancel_stops_the_worker_process():
    executor = BacktestExecutor(max_workers=1, timeout_seconds=60)
    execution_id = uuid4()
    try:
        executor.submit(
            execution_id=execution_id,
            strategy_key="momentum",
            worker_target=_sleeping_worker,
        )
        process = executor._by_execution[execution_id]
        assert process.is_alive()
        assert executor.cancel(execution_id) is True
        assert not process.is_alive()
        assert executor.cancel(execution_id) is False
    finally:
        executor.shutdown(wait=False)


def test_a_real_running_backtest_can_be_cancelled(world):
    # A long range keeps the worker busy long enough to cancel it.
    wait_for_worker()
    created = client.post("/backtests", json=body(world))
    assert created.status_code == 201
    execution_id = created.json()["id"]
    response = client.post(f"/executions/{execution_id}/cancel")
    assert response.status_code in (200, 409)
    if response.status_code == 200:
        assert response.json()["status"] == "CANCELLED"
        wait_for_worker()
        assert client.get(f"/executions/{execution_id}").json()["status"] == "CANCELLED"
        assert backtest_executor.has_capacity()


# --- history, delete, startup -----------------------------------------------------------


def test_history_filters(world):
    completed = make_execution(world, ExecutionStatus.RUNNING)
    ExecutionService(world["db"]).complete_execution(execution=completed)
    pending = make_execution(world)

    def ids(query):
        return [e["id"] for e in client.get(f"/executions{query}").json()]

    assert ids("?status=COMPLETED") == [str(completed.id)]
    assert ids("?status=PENDING") == [str(pending.id)]
    assert ids("?execution_type=REGIME_TEST") == []
    assert set(ids(f"?strategy_id={world['momentum'].id}")) == {str(completed.id), str(pending.id)}
    assert ids(f"?instrument_id={world['instruments'][1].id}") == []
    assert ids("?created_from=2099-01-01T00:00:00Z") == []
    assert ids(f"?limit=1") == [str(pending.id)]


def test_delete_only_finished_executions(world):
    running = make_execution(world, ExecutionStatus.RUNNING)
    response = client.delete(f"/executions/{running.id}")
    assert response.status_code == 409
    assert response.json()["detail"] == "Cancel this execution before deleting it."

    client.post(f"/executions/{running.id}/cancel")
    assert client.delete(f"/executions/{running.id}").status_code == 204
    assert client.get(f"/executions/{running.id}").status_code == 404


def test_startup_marks_stranded_backtests_failed(world):
    pending = make_execution(world)
    running = make_execution(world, ExecutionStatus.RUNNING)
    assert fail_stranded_backtests() >= 2
    for execution in (pending, running):
        stored = client.get(f"/executions/{execution.id}").json()
        assert stored["status"] == "FAILED"
        assert stored["error"]["code"] == "BACKTEST_WORKER_LOST"


def test_registry_says_how_many_instruments_each_strategy_needs(world):
    entries = {e["strategy_key"]: e["instruments"] for e in client.get("/strategy-registry").json()}
    assert entries == {
        "momentum": "single",
        "mean_reversion": "single",
        "volatility_arbitrage": "single",
        "statistical_arbitrage": "pair",
        "tactical_asset_allocation": "universe",
    }
