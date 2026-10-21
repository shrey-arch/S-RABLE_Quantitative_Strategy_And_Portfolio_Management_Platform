"""Feature 1 (P2/P3): strategy deployments on the paper account, the daily job,
account performance, the journal and validation stage 5.

Bars are seeded; "Yahoo" is a stand-in that adds the next day's bar when the
job asks for it; the clock is fixed. A deployment of a no-code strategy must
make exactly the trades the backtest engine makes over the same days."""

import math
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.backtesting.broker import SimulatedBroker
from app.backtesting.engine import BacktestEngine
from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import Exchange, ExecutionStatus, ExecutionType, InstrumentType, StrategyType, Timeframe
from app.main import app
from app.models import (
    Execution,
    Instrument,
    MarketData,
    Notification,
    PaperAccount,
    PaperDeployment,
    Strategy,
    User,
)
from app.services.instruments.instrument_service import InstrumentService
from app.services.paper import clock, deployments, quotes
from app.strategies.rule_strategy import RuleStrategy
from app.validation.pipeline import empty_report

client = TestClient(app)
IST = clock.IST
FIRST = date(2026, 5, 4)
START = date(2026, 10, 14)  # deployments start here (clock at 10:00 IST)


def ist(day: date, hm: str) -> datetime:
    return datetime.fromisoformat(f"{day.isoformat()}T{hm}:00").replace(tzinfo=IST).astimezone(timezone.utc)


def close_for(n: int) -> float:
    # On the 0.05 tick, as NSE prices are.
    return round((100 + 8 * math.sin(n / 2.5) + n * 0.05) * 20) / 20


SMA3 = {"name": "sma3", "type": "SMA", "parameters": {"window": 3}}
RULES = {
    "parameters": {},
    "indicators": [SMA3],
    "entry_conditions": [{"left": {"type": "price", "field": "close"}, "operator": ">", "right": {"type": "indicator", "name": "sma3"}}],
    "exit_conditions": [{"left": {"type": "price", "field": "close"}, "operator": "<", "right": {"type": "indicator", "name": "sma3"}}],
}


class Clock:
    def __init__(self, monkeypatch):
        self.at = ist(START, "10:00")
        monkeypatch.setattr(clock, "now_utc", lambda: self.at)

    def set(self, day: date, hm: str):
        self.at = ist(day, hm)


@pytest.fixture
def world(monkeypatch):
    db = SessionLocal()
    user = User(full_name="Deploy", email=f"pd-{uuid4().hex[:8]}@example.com", password_hash="x")
    other = User(full_name="Other", email=f"pe-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add_all([user, other])
    db.commit()
    tag = uuid4().hex[:5].upper()
    instrument = InstrumentService(db).create_instrument(
        symbol=f"DEP{tag}", trading_symbol=f"DEP{tag}-EQ", name="Deploy Co", exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY, isin=None, lot_size=1, tick_size=0.05,
    )
    days = clock.trading_days(FIRST, date(2027, 1, 31))
    index = {d: n for n, d in enumerate(days)}
    for d in days:
        if d < START:
            db.add(_bar(instrument.id, d, close_for(index[d])))
    db.commit()
    no_code = Strategy(user_id=user.id, name="SMA3 cross", strategy_type=StrategyType.NO_CODE, strategy_config=RULES)
    pair = Strategy(user_id=user.id, name="Pair", strategy_type=StrategyType.PYTHON,
                    strategy_config={"parameters": {"template": "statistical_arbitrage"}})
    python = Strategy(user_id=user.id, name="Code", strategy_type=StrategyType.PYTHON, strategy_config={"parameters": {}},
                      python_code="def generate_signal(context):\n    return None\n")
    db.add_all([no_code, pair, python])
    db.commit()
    imported: list[date] = []
    blocked: set[date] = set()

    def fake_import(session, instrument_id, start, end):
        for d in clock.trading_days(start, end):
            if d in blocked or d not in index:
                continue
            if not deployments._has_bar(session, instrument_id, d):
                session.add(_bar(instrument_id, d, close_for(index[d])))
                imported.append(d)
        session.commit()

    monkeypatch.setattr(deployments, "bar_importer", fake_import)
    quotes.set_quote_provider(_NoQuotes())
    now = Clock(monkeypatch)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {"db": db, "user": user, "other": other, "instrument": instrument, "no_code": no_code,
               "pair": pair, "python": python, "clock": now, "blocked": blocked, "index": index}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        quotes.set_quote_provider(None)
        db.rollback()
        db.execute(delete(Notification).where(Notification.user_id.in_([user.id, other.id])))
        db.execute(delete(PaperAccount).where(PaperAccount.user_id.in_([user.id, other.id])))
        db.execute(delete(Execution).where(Execution.strategy_id.in_([no_code.id, pair.id, python.id])))
        db.execute(delete(Strategy).where(Strategy.user_id == user.id))
        db.execute(delete(MarketData).where(MarketData.instrument_id == instrument.id))
        db.execute(delete(Instrument).where(Instrument.id == instrument.id))
        db.execute(delete(User).where(User.id.in_([user.id, other.id])))
        db.commit()
        db.close()


class _NoQuotes:
    def fetch(self, symbol):
        raise quotes.QuoteUnavailable("No quotes in this test.")


def _bar(instrument_id, d: date, close: float) -> MarketData:
    return MarketData(
        instrument_id=instrument_id,
        timestamp=datetime.combine(d, datetime.min.time(), tzinfo=IST).astimezone(timezone.utc),
        timeframe=Timeframe.ONE_DAY,
        open=close, high=close + 1, low=close - 1, close=close, volume=1000,
    )


def deploy(world, key="no_code", **body):
    data = {"strategy_id": str(world[key].id), "instrument_id": str(world["instrument"].id), "quantity": 10, "capital": 100000}
    data.update(body)
    return client.post("/paper/deployments", json=data)


def run_due(world, day: date, hm: str = "17:00"):
    world["clock"].set(day, hm)
    response = client.post("/paper/deployments/run-due")
    assert response.status_code == 200, response.text
    return response.json()


def no_slippage():
    assert client.patch("/paper/account/settings", json={"slippage_bps": 0}).status_code == 200


def engine_trades(world, through: date):
    db = world["db"]
    rows = db.scalars(
        select(MarketData).where(MarketData.instrument_id == world["instrument"].id).order_by(MarketData.timestamp)
    ).all()
    data = pd.DataFrame(
        {"open": [r.open for r in rows], "high": [r.high for r in rows], "low": [r.low for r in rows],
         "close": [float(r.close) for r in rows], "volume": [r.volume for r in rows]},
        index=pd.DatetimeIndex([r.timestamp for r in rows]),
    )
    data = data[data.index <= pd.Timestamp(ist(through, "23:00"))]
    result = BacktestEngine().run(
        strategy=RuleStrategy(RULES), data=data, execution_id=uuid4(), instrument_id=world["instrument"].id,
        initial_capital=100000, quantity=10, broker=SimulatedBroker(), trade_from=pd.Timestamp(ist(START, "00:00")),
    )
    return [
        (clock.to_ist(t["timestamp"]).date().isoformat(), t["side"], int(t["quantity"]), round(float(t["price"]), 2))
        for t in result.trades
    ]


# --- deploy -------------------------------------------------------------------


def test_deploy_rules(world):
    no_slippage()
    response = deploy(world, loss_limit=0.2, duration_days=10)
    assert response.status_code == 201, response.text
    dep = response.json()
    assert dep["status"] == "ACTIVE" and dep["start_date"] == START.isoformat()
    assert dep["end_date"] == (START + timedelta(days=10)).isoformat()
    assert dep["layout"] == "single" and dep["rules"] == RULES and dep["cash"] == 100000
    assert dep["performance"]["days"] == 0
    assert deploy(world, key="pair", other_instrument_ids=[str(world["instrument"].id)]).status_code == 422
    python = deploy(world, key="python")
    assert python.status_code == 422 and "cannot be deployed" in python.json()["detail"]
    big = deploy(world, capital=5_000_000)
    assert big.status_code == 422 and "available cash" in big.json()["detail"]
    notes = world["db"].scalars(select(Notification).where(Notification.user_id == world["user"].id)).all()
    assert [n.title for n in notes] == ["Paper deployment started"]


def test_a_deployment_trades_exactly_like_the_backtest_engine(world):
    no_slippage()
    dep = deploy(world).json()
    through = date(2026, 11, 6)
    result = run_due(world, through)
    trading = clock.trading_days(START, through)
    assert result["days_processed"] == len(trading) and result["through"] == through.isoformat()
    detail = client.get(f"/paper/deployments/{dep['id']}").json()
    assert [d["day"] for d in detail["days"]] == [d.isoformat() for d in reversed(trading)]
    ours = sorted(
        (d["day"], o["side"], o["quantity"], round(o["price"], 2))
        for d in detail["days"]
        for o in d["orders"]
        if o["status"] == "FILLED"
    )
    theirs = sorted(engine_trades(world, through))
    assert ours and ours == theirs
    # Strategy orders are in the order book, marked as such.
    orders = client.get("/paper/orders").json()
    assert {o["source"] for o in orders} == {"STRATEGY"} and {o["deployment_id"] for o in orders} == {dep["id"]}
    # Equity each day = cash + holdings at the close.
    for d in detail["days"]:
        assert d["equity"] == pytest.approx(d["cash"] + d["positions_value"], abs=0.01)
    # Running again changes nothing.
    again = run_due(world, through, "18:00")
    assert again["days_processed"] == 0
    assert len(client.get("/paper/orders").json()) == len(orders)


def test_the_job_waits_for_a_missing_bar_then_skips_it(world):
    dep = deploy(world).json()
    gap = date(2026, 10, 15)
    world["blocked"].add(gap)
    run_due(world, gap)
    detail = client.get(f"/paper/deployments/{dep['id']}").json()
    assert [d["day"] for d in detail["days"]] == ["2026-10-14"]
    assert detail["last_processed_date"] == "2026-10-14"
    # Two trading days later the day is skipped with a note; later days go on.
    run_due(world, date(2026, 10, 19))
    detail = client.get(f"/paper/deployments/{dep['id']}").json()
    by_day = {d["day"]: d for d in detail["days"]}
    assert "skipped" in by_day["2026-10-15"]["note"] and by_day["2026-10-15"]["equity"] is None
    assert {"2026-10-16", "2026-10-19"} <= set(by_day)


def test_before_the_close_settles_nothing_runs_for_today(world):
    deploy(world)
    result = run_due(world, START, "15:45")
    assert result["through"] == "2026-10-13" and result["days_processed"] == 0


def test_loss_limit_pauses_and_notifies(world):
    dep = deploy(world, capital=2000, loss_limit=0.0005).json()  # charges and slippage alone cross it
    run_due(world, date(2026, 11, 6))
    detail = client.get(f"/paper/deployments/{dep['id']}").json()
    assert detail["status"] == "PAUSED" and "limit" in detail["status_reason"]
    assert detail["breaches"] == 1
    titles = [n.title for n in world["db"].scalars(select(Notification).where(Notification.user_id == world["user"].id))]
    assert "Paper deployment loss limit reached" in titles
    paused_days = len(detail["days"])
    run_due(world, date(2026, 11, 13))
    assert len(client.get(f"/paper/deployments/{dep['id']}").json()["days"]) == paused_days


def test_pause_resume_stop_and_ownership(world):
    dep = deploy(world).json()
    path = f"/paper/deployments/{dep['id']}"
    assert client.post(f"{path}/pause").json()["status"] == "PAUSED"
    assert client.post(f"{path}/pause").status_code == 409
    assert client.post(f"{path}/resume").json()["status"] == "ACTIVE"
    assert client.post(f"{path}/stop").json()["status"] == "STOPPED"
    assert client.post(f"{path}/resume").status_code == 409
    app.dependency_overrides[get_current_user] = lambda: world["other"]
    assert client.get(path).status_code == 404
    assert client.post(f"{path}/pause").status_code == 404
    assert client.get("/paper/deployments").json() == []


def test_completion_at_the_end_date(world):
    dep = deploy(world, duration_days=7).json()
    run_due(world, date(2026, 11, 13))
    detail = client.get(f"/paper/deployments/{dep['id']}").json()
    assert detail["status"] == "COMPLETED"
    assert max(d["day"] for d in detail["days"]) <= (START + timedelta(days=7)).isoformat()


# --- P3: performance, snapshots, journal ---------------------------------------


def test_performance_and_account_snapshots(world):
    no_slippage()
    dep = deploy(world).json()
    through = date(2026, 11, 6)
    run_due(world, through)
    detail = client.get(f"/paper/deployments/{dep['id']}").json()
    values = [d["equity"] for d in reversed(detail["days"])]
    expected = deployments.metrics(values, 100000)
    perf = detail["performance"]
    for key in ("days", "total_return", "max_drawdown", "annualized_mean_return", "sharpe_ratio"):
        assert perf[key] == pytest.approx(expected[key])
    assert perf["fills"] == len(engine_trades(world, through))
    account = client.get("/paper/performance").json()
    assert [s["day"] for s in account["snapshots"]] == [through.isoformat()]
    snap = account["snapshots"][0]
    acct = client.get("/paper/account").json()
    assert snap["cash"] == acct["cash"]
    assert snap["equity"] == pytest.approx(snap["cash"] + snap["holdings_value"], abs=0.01)
    assert account["performance"]["days"] == 1 and account["basis"]


def test_journal_note_and_tags(world):
    no_slippage()
    deploy(world)
    run_due(world, date(2026, 11, 6))
    order = client.get("/paper/orders").json()[0]
    saved = client.patch(f"/paper/orders/{order['id']}/journal", json={"note": " Followed the cross. ", "tags": ["sma", "sma", " trend "]}).json()
    assert saved["note"] == "Followed the cross." and saved["tags"] == ["sma", "trend"]
    cleared = client.patch(f"/paper/orders/{order['id']}/journal", json={"note": "", "tags": []}).json()
    assert cleared["note"] is None and cleared["tags"] == []
    app.dependency_overrides[get_current_user] = lambda: world["other"]
    assert client.patch(f"/paper/orders/{order['id']}/journal", json={"note": "x"}).status_code == 404


# --- validation stage 5 ---------------------------------------------------------


def validation(world, *, passed=True, version=None):
    report = empty_report()
    for key in ("backtest", "walk_forward", "regime_stress", "monte_carlo"):
        report["stages"][key]["status"] = "PASS" if passed else "FAIL"
    report["stages"]["backtest"]["equity_curve"] = [
        {"timestamp": f"2025-01-{d:02d}T00:00:00+00:00", "portfolio_value": 100000 * (1.001 ** d)} for d in range(1, 30)
    ]
    report["verdict"] = {"status": "PASS" if passed else "FAIL", "reason": "test"}
    run = Execution(
        strategy_id=world["no_code"].id, instrument_id=world["instrument"].id, execution_type=ExecutionType.VALIDATION,
        status=ExecutionStatus.COMPLETED, timeframe="1D", initial_capital=100000, execution_config={},
        run_settings={"strategy_key": "no_code_rules", "rules": RULES, "quantity": 10,
                      "strategy_version": version or world["no_code"].version, "other_instrument_ids": []},
        execution_metrics={"validation": report},
    )
    world["db"].add(run)
    world["db"].commit()
    return run


def test_stage5_runs_on_the_paper_account_and_sets_the_verdict(world):
    no_slippage()
    run = validation(world)
    response = client.post(f"/paper/deployments/from-validation/{run.id}", json={"capital": 100000, "loss_limit": 0.5})
    assert response.status_code == 201, response.text
    dep = response.json()
    assert dep["validation_id"] == str(run.id) and dep["end_date"] == (START + timedelta(days=30)).isoformat()
    report = client.get(f"/validations/{run.id}").json()
    assert report["stages"]["paper_trading"]["status"] == "RUNNING"
    assert report["stages"]["paper_trading"]["paper"]["deployment_id"] == dep["id"]
    assert client.post(f"/paper/deployments/from-validation/{run.id}", json={"capital": 1000}).status_code == 409

    run_due(world, date(2026, 11, 3))
    middle = client.get(f"/validations/{run.id}").json()["stages"]["paper_trading"]
    assert middle["status"] == "RUNNING" and middle["paper"]["days_done"] > 5
    assert client.get(f"/validations/{run.id}").json()["verdict"]["status"] == "PASS"

    run_due(world, date(2026, 11, 30))
    report = client.get(f"/validations/{run.id}").json()
    stage = report["stages"]["paper_trading"]
    assert stage["status"] in {"PASS", "FAIL"}
    checks = {c["id"]: c for c in stage["checks"]}
    assert set(checks) == {"paper_retention", "paper_breaches"}
    paper = stage["paper"]
    assert checks["paper_retention"]["value"] == pytest.approx(
        paper["paper_annualized_mean_return"] / paper["backtest_annualized_mean_return"]
    )
    assert checks["paper_retention"]["threshold"] == 0.7
    expected = "VALIDATED" if stage["status"] == "PASS" else "FAIL"
    assert report["verdict"]["status"] == expected
    assert client.get(f"/paper/deployments/{dep['id']}").json()["status"] == "COMPLETED"
    titles = [n.title for n in world["db"].scalars(select(Notification).where(Notification.user_id == world["user"].id))]
    assert any(t.startswith("Paper trading stage") for t in titles)
    assert any(t["stage"] == "paper_trading" for t in report["thresholds"])


def test_stage5_needs_stages_1_to_4_and_the_same_strategy_version(world):
    failed = validation(world, passed=False)
    assert client.post(f"/paper/deployments/from-validation/{failed.id}", json={"capital": 1000}).status_code == 422
    old = validation(world, version=99)
    response = client.post(f"/paper/deployments/from-validation/{old.id}", json={"capital": 1000})
    assert response.status_code == 422 and "changed" in response.json()["detail"]
    app.dependency_overrides[get_current_user] = lambda: world["other"]
    ok = validation(world)
    assert client.post(f"/paper/deployments/from-validation/{ok.id}", json={"capital": 1000}).status_code == 404


def test_old_reports_with_a_planned_stage_can_start(world):
    run = validation(world)
    metrics = dict(run.execution_metrics)
    report = dict(metrics["validation"])
    report["stages"] = dict(report["stages"])
    report["stages"]["paper_trading"] = {**report["stages"]["paper_trading"], "status": "PLANNED"}
    metrics["validation"] = report
    run.execution_metrics = metrics
    world["db"].commit()
    shown = client.get(f"/validations/{run.id}").json()
    assert shown["stages"]["paper_trading"]["status"] == "NOT_RUN"
    assert "Start paper trading" in shown["verdict"]["reason"]
    assert client.post(f"/paper/deployments/from-validation/{run.id}", json={"capital": 1000}).status_code == 201


def test_the_daily_job_script_and_due_day():
    assert deployments.due_day(ist(date(2026, 10, 16), "16:05")) == date(2026, 10, 16)
    assert deployments.due_day(ist(date(2026, 10, 16), "15:59")) == date(2026, 10, 15)
    assert deployments.due_day(ist(date(2026, 10, 18), "12:00")) == date(2026, 10, 16)  # Sunday
    assert deployments.due_day(ist(date(2026, 10, 21), "09:00")) == date(2026, 10, 19)  # 20th is a holiday
    assert isinstance(UUID(str(uuid4())), UUID)
