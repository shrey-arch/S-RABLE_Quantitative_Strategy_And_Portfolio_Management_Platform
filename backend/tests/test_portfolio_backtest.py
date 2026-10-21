"""Feature 4: portfolio backtest against Nifty 50 (Objective 6).

Equity from fixed sleeves equals a hand calculation; weights plus cash are 1 on
every rebalance; turnover costs are traded value x (brokerage + slippage); the
score and regime on a day use only data up to it; the calendar is Nifty 50's NSE
trading days; another user's run is a 404; the API runs the real worker."""

import math
import time
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.dependencies import get_current_user
from app.data.calendars import NSEMarketCalendar
from app.db import SessionLocal
from app.enums import ExecutionStatus, ExecutionType, InstrumentType, StrategyType
from app.main import app
from app.models import Execution, Instrument, MarketData, RegimeModelRecord, Strategy, User
from app.portfolio_backtest import simulation as sim
from app.services.portfolio_backtest import service as pb
from app.services.regime import service as regime_service
from tests.test_regime_labels import switching_prices
from tests.test_scoring_api import other_prices, template
from tests.test_validation_model_regimes import _instrument, wait_for_worker

client = TestClient(app)
TERMINAL = {"COMPLETED", "FAILED", "CANCELLED"}


def series(days, values):
    return pd.Series(dict(zip(days, values)))


def fixed_inputs(days, a, b, bench, **kw):
    sleeves = [
        sim.Sleeve("A", "Alpha", "momentum", "AAA", series(days, a)),
        sim.Sleeve("B", "Beta", "mean_reversion", "BBB", series(days, b)),
    ]
    scores = kw.pop("scores", {"A": 1.0, "B": 1.0})
    return sim.SimulationInputs(
        sleeves=sleeves,
        benchmark=series(days, bench),
        start=days[0],
        end=days[-1],
        capital=1000.0,
        score=lambda s, d: (scores[s.key], None, None),
        **kw,
    )


# --- the simulation by hand ---------------------------------------------------------

# Thu, Fri | Mon, Tue (two ISO weeks): rebalances on Thu (the first day) and Fri.
DAYS = [date(2024, 3, 7), date(2024, 3, 8), date(2024, 3, 11), date(2024, 3, 12)]


def test_equity_from_fixed_sleeves_equals_the_hand_calculation():
    a = [100, 110, 121, 121]
    b = [100, 100, 90, 99]
    result = sim.simulate(fixed_inputs(DAYS, a, b, [10, 11, 12, 11]))
    assert result["days"] == [d.isoformat() for d in DAYS]
    assert [r["day"] for r in result["rebalances"]] == ["2024-03-07", "2024-03-08"]
    # Thu: 500 / 500. Fri: A drifts to 550, B stays 500 -> 1050, back to 525 / 525.
    # Mon: 525 x 1.1 + 525 x 0.9 = 1050. Tue: 577.5 x 1 + 472.5 x 1.1 = 1097.25.
    expected = [1000, 1050, 1050, 577.5 + 472.5 * 1.1]
    assert result["series"]["portfolio"] == pytest.approx(expected)
    # Equal weight is the same here (equal scores, no limits, no regime).
    assert result["series"]["equal_weight"] == pytest.approx(expected)
    assert result["series"]["nifty"] == pytest.approx([1000, 1100, 1200, 1100])
    assert result["drawdowns"]["nifty"] == pytest.approx([0, 0, 0, 1100 / 1200 - 1])
    assert result["metrics"]["portfolio"]["total_return"] == pytest.approx(expected[-1] / 1000 - 1)
    assert result["metrics"]["portfolio"]["final_value"] == pytest.approx(expected[-1])


def test_scores_set_the_weights_in_proportion():
    a = [100, 110, 121, 121]
    b = [100, 100, 90, 99]
    result = sim.simulate(fixed_inputs(DAYS, a, b, [10, 11, 12, 11], scores={"A": 3.0, "B": 1.0}))
    first = result["rebalances"][0]
    weights = {s["strategy_id"]: s["weight"] for s in first["strategies"]}
    assert weights == pytest.approx({"A": 0.75, "B": 0.25})
    # Fri: 750 x 1.1 + 250 = 1075 -> 806.25 / 268.75; Mon: 886.875 + 241.875.
    assert result["series"]["portfolio"][2] == pytest.approx(806.25 * 1.1 + 268.75 * 0.9)


def test_weights_and_cash_are_one_within_the_limits():
    rng = np.random.default_rng(5)
    days = [d.date() for d in pd.bdate_range("2024-01-01", periods=60)]
    a = 100 * np.cumprod(1 + rng.normal(0, 0.01, 60))
    b = 100 * np.cumprod(1 + rng.normal(0, 0.01, 60))
    result = sim.simulate(
        fixed_inputs(
            days, a, b, 100 * np.cumprod(1 + rng.normal(0, 0.01, 60)),
            scores={"A": 5.0, "B": 1.0}, cash_reserve=0.2, max_strategy_weight=0.5,
        )
    )
    assert result["rebalance_count"] == len(result["rebalances"]) > 5
    for entry in result["rebalances"]:
        weights = [s["weight"] for s in entry["strategies"]]
        assert sum(weights) + entry["cash_weight"] == pytest.approx(1.0, abs=1e-9)
        assert entry["cash_weight"] >= 0.2 - 1e-6
        assert max(weights) <= 0.5 + 1e-6
        assert entry["binding_limits"]


def test_turnover_costs_are_the_traded_value_times_the_rate():
    a = [100, 110, 121, 121]
    b = [100, 100, 90, 99]
    result = sim.simulate(fixed_inputs(DAYS, a, b, [10, 11, 12, 11], brokerage_rate=0.001, slippage_bps=10))
    rate = 0.002
    first, second = result["rebalances"]
    # Thu: buying 1000 of both -> cost 2, then 499 / 499.
    assert first["turnover"] == pytest.approx(1.0)
    assert first["cost"] == pytest.approx(1000 * rate)
    assert first["value_after"] == pytest.approx(998)
    # Fri: A 548.9, B 499 (1047.9); targets 523.95 each; traded 2 x 24.95.
    assert second["value_before"] == pytest.approx(1047.9)
    traded = abs(523.95 - 548.9) + abs(523.95 - 499)
    assert second["cost"] == pytest.approx(traded * rate)
    assert second["turnover"] == pytest.approx(traded / 1047.9)
    after = 1047.9 - traded * rate
    assert result["series"]["portfolio"][1] == pytest.approx(after)
    assert result["series"]["portfolio"][2] == pytest.approx(after / 2 * 1.1 + after / 2 * 0.9)


def test_no_score_means_cash_and_the_reason_is_logged():
    a = [100, 110, 121, 121]
    b = [100, 100, 90, 99]
    inputs = fixed_inputs(DAYS, a, b, [10, 11, 12, 11])
    inputs.score = lambda s, d: (None, None, "Not enough history.") if s.key == "B" else (1.0, None, None)
    result = sim.simulate(inputs)
    row = {s["strategy_id"]: s for s in result["rebalances"][0]["strategies"]}
    assert row["B"]["excluded"] == "Not enough history." and row["B"]["weight"] == 0
    assert row["A"]["weight"] == pytest.approx(1.0)
    inputs.score = lambda s, d: (None, None, "No bars.")
    empty = sim.simulate(inputs)
    assert empty["series"]["portfolio"] == pytest.approx([1000] * 4)
    assert empty["rebalances"][0]["note"].startswith("No strategy could be allocated")


def test_the_regime_filter_excludes_incompatible_strategies():
    a = [100, 110, 121, 121]
    b = [100, 100, 90, 99]
    inputs = fixed_inputs(DAYS, a, b, [10, 11, 12, 11])
    regime = {"code": "R1", "name": "Calm", "volatility_state": "LOW", "trend_state": "UP", "as_of": "2024-03-07"}
    inputs.regime_at = lambda d: regime
    inputs.compatible = lambda key, r: (key == "momentum", "Momentum only.")
    result = sim.simulate(inputs)
    row = {s["strategy_id"]: s for s in result["rebalances"][0]["strategies"]}
    assert row["B"]["excluded"] == "Momentum only." and row["B"]["weight"] == 0
    assert result["rebalances"][0]["regime"] == regime
    # Equal weight ignores the filter.
    assert result["series"]["equal_weight"][1] == pytest.approx(1050)
    assert result["series"]["portfolio"][1] == pytest.approx(1100)


def test_rebalance_days_weekly_and_monthly():
    days = [d.date() for d in pd.bdate_range("2024-01-29", "2024-03-05")]
    weekly = sim.rebalance_days(days, "WEEKLY")
    assert weekly[0] == days[0]
    assert all(d.weekday() == 4 for d in weekly[1:])
    monthly = sim.rebalance_days(days, "MONTHLY")
    assert monthly == [date(2024, 1, 29), date(2024, 1, 31), date(2024, 2, 29)]
    with pytest.raises(ValueError):
        sim.rebalance_days(days, "DAILY")


def test_the_calendar_is_nifty_50s_nse_trading_days():
    # 2024-01-22 and 2024-01-26 were NSE holidays; a Saturday bar is ignored too.
    calendar = NSEMarketCalendar()
    bench_days = [d.date() for d in pd.date_range("2024-01-15", "2024-02-02")]
    bench = series(bench_days, np.linspace(100, 120, len(bench_days)))
    # The sleeve has no bar on 2024-01-30: it keeps the last value that day.
    sleeve_days = [d for d in bench_days if d != date(2024, 1, 30)]
    inputs = sim.SimulationInputs(
        sleeves=[sim.Sleeve("A", "A", "momentum", "AAA", series(sleeve_days, np.arange(len(sleeve_days)) + 100.0))],
        benchmark=bench,
        start=bench_days[0],
        end=bench_days[-1],
        capital=1000,
        trading_day=calendar.is_trading_day,
    )
    result = sim.simulate(inputs)
    days = [date.fromisoformat(d) for d in result["days"]]
    assert days == [d for d in bench_days if calendar.is_trading_day(d)]
    assert date(2024, 1, 22) not in days and date(2024, 1, 26) not in days
    assert all(d.weekday() < 5 for d in days)
    i = days.index(date(2024, 1, 30))
    assert result["series"]["portfolio"][i] == pytest.approx(result["series"]["portfolio"][i - 1])
    assert len(result["series"]["nifty"]) == len(days)


def test_relative_metrics_and_objectives():
    rng = np.random.default_rng(2)
    rb = rng.normal(0.0005, 0.01, 300)
    rp = 0.5 * rb + rng.normal(0.0002, 0.002, 300)
    bench = list(1000 * np.cumprod(np.r_[1, 1 + rb]))
    port = list(1000 * np.cumprod(np.r_[1, 1 + rp]))
    rel, reasons = sim.relative_metrics(port, bench)
    assert not reasons
    assert rel["beta"] == pytest.approx(np.cov(rp, rb, ddof=1)[0, 1] / np.var(rb, ddof=1))
    assert rel["correlation"] == pytest.approx(np.corrcoef(rp, rb)[0, 1])
    te = np.std(rp - rb, ddof=1) * math.sqrt(252)
    assert rel["tracking_error"] == pytest.approx(te)
    assert rel["information_ratio"] == pytest.approx(np.mean(rp - rb) * 252 / te)

    out = sim.objectives({"sharpe_ratio": 1.3, "max_drawdown": 0.15}, {"sharpe_ratio": 1.0, "max_drawdown": 0.2})
    assert out["sharpe_improvement"]["value"] == pytest.approx(0.3) and out["sharpe_improvement"]["met"]
    assert out["drawdown_reduction"]["value"] == pytest.approx(0.25) and out["drawdown_reduction"]["met"]
    miss = sim.objectives({"sharpe_ratio": 0.5, "max_drawdown": 0.19}, {"sharpe_ratio": -1.0, "max_drawdown": 0.2})
    assert miss["sharpe_improvement"]["value"] == pytest.approx(1.5) and miss["sharpe_improvement"]["met"]
    assert not miss["drawdown_reduction"]["met"]
    none = sim.objectives({"sharpe_ratio": None, "max_drawdown": 0.1}, {"sharpe_ratio": 0.0, "max_drawdown": 0.0})
    assert not none["sharpe_improvement"]["met"] and none["sharpe_improvement"]["reason"]
    assert not none["drawdown_reduction"]["met"] and none["drawdown_reduction"]["reason"]


def test_sixty_forty_holds_60_nifty_and_40_debt():
    a = [100, 110, 121, 121]
    result = sim.simulate(fixed_inputs(DAYS, a, a, [10, 11, 12, 11], sixty_forty=True))
    debt = (1.065) ** (1 / 252) - 1
    # Thu 600 / 400; Fri 660 + 400(1+d) -> rebalanced 60/40; Mon nifty +9.09%.
    fri = 660 + 400 * (1 + debt)
    assert result["series"]["sixty_forty"][1] == pytest.approx(fri)
    assert result["series"]["sixty_forty"][2] == pytest.approx(0.6 * fri * 12 / 11 + 0.4 * fri * (1 + debt))


# --- point in time --------------------------------------------------------------------


def test_the_score_on_a_day_ignores_later_bars():
    prices = switching_prices(400)
    days = [pb.ist_day(t) for t in prices.index]
    day = days[320]
    changed = prices.copy()
    changed.iloc[321:, 0] = changed.iloc[321:, 0] * 3
    assert pb.score_at(prices, days, "momentum", day) == pb.score_at(changed, days, "momentum", day)
    later = pb.score_at(prices, days, "momentum", days[399])
    assert later != pb.score_at(changed, days, "momentum", days[399])
    # A day between bars uses the bar before it.
    assert pb.score_at(prices, days, "momentum", day + timedelta(days=1 if day.weekday() < 4 else 2))[0] is not None
    assert pb.score_at(prices, days, "momentum", days[0] - timedelta(days=3))[0] is None


def test_the_regime_on_a_day_is_the_last_classified_day_on_or_before_it():
    record = RegimeModelRecord(
        model_metadata={
            "labels": {
                "regimes": [
                    {"regime_id": 0, "code": "R1", "name": "Calm", "volatility_state": "LOW", "trend_state": "UP"},
                    {"regime_id": 1, "code": "R2", "name": "Storm", "volatility_state": "HIGH", "trend_state": "DOWN"},
                ]
            }
        }
    )
    index = pd.to_datetime(["2024-03-04", "2024-03-06", "2024-03-08"]).tz_localize("UTC")
    regime_at = pb.RegimeAsOf(record, pd.DataFrame({"regime_id": [0, 1, 0]}, index=index))
    assert regime_at(date(2024, 3, 1)) is None
    assert regime_at(date(2024, 3, 5))["code"] == "R1"
    assert regime_at(date(2024, 3, 6)) == {
        "code": "R2", "name": "Storm", "volatility_state": "HIGH", "trend_state": "DOWN", "as_of": "2024-03-06"
    }
    assert regime_at(date(2024, 3, 7))["as_of"] == "2024-03-06"


def test_changing_later_prices_leaves_earlier_rebalances_unchanged():
    rng = np.random.default_rng(9)
    n = 120
    days = [d.date() for d in pd.bdate_range("2024-01-01", periods=n)]
    a = 100 * np.cumprod(1 + rng.normal(0, 0.01, n))
    b = 100 * np.cumprod(1 + rng.normal(0, 0.01, n))
    frames = {}

    def score(sleeve, day):
        frame, idx = frames[sleeve.key]
        return pb.score_at(frame, idx, sleeve.strategy_key, day)

    def run(a_values):
        for key, values in (("A", a_values), ("B", b)):
            index = pd.DatetimeIndex([pd.Timestamp(d, tz="UTC") for d in days])
            frames[key] = (pd.DataFrame({"close": values}, index=index), list(days))
        inputs = fixed_inputs(days, a_values, b, b)
        inputs.score = score
        return sim.simulate(inputs)

    base = run(a)
    shocked = a.copy()
    shocked[80:] *= 0.5
    other = run(shocked)
    cut = days[80].isoformat()
    early = [r for r in base["rebalances"] if r["day"] < cut]
    assert early and early == [r for r in other["rebalances"] if r["day"] < cut]
    assert base["rebalances"] != other["rebalances"]


# --- the API, with the real worker --------------------------------------------------


@pytest.fixture
def world():
    db = SessionLocal()
    db.execute(delete(RegimeModelRecord))
    user = User(full_name="Folio", email=f"pb-{uuid4().hex[:8]}@example.com", password_hash="x")
    other = User(full_name="Other", email=f"pbo-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add_all([user, other])
    db.commit()
    made, strategies = [], []

    def add(symbol, kind, frame):
        instrument = _instrument(db, symbol, kind, frame)
        made.append(instrument.id)
        return instrument

    def strategy(name, key, instrument, owner=user, backtest=True):
        row = Strategy(user_id=owner.id, name=name, strategy_type=StrategyType.PYTHON, strategy_config=template(key))
        db.add(row)
        db.flush()
        strategies.append(row.id)
        if backtest:
            db.add(
                Execution(
                    strategy_id=row.id,
                    instrument_id=instrument.id,
                    execution_type=ExecutionType.BACKTEST,
                    status=ExecutionStatus.COMPLETED,
                    timeframe="1D",
                    initial_capital=100000,
                    execution_config={},
                    run_settings={"strategy_key": key, "quantity": 50, "slippage_bps": 5, "brokerage_rate": 0.0003},
                    completed_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
                )
            )
        db.commit()
        return row

    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {"db": db, "user": user, "other": other, "add": add, "strategy": strategy}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        wait_for_worker()
        db.rollback()
        db.execute(delete(Execution).where(Execution.strategy_id.in_(strategies)))
        db.execute(delete(Strategy).where(Strategy.id.in_(strategies)))
        db.execute(delete(RegimeModelRecord))
        db.execute(delete(MarketData).where(MarketData.instrument_id.in_(made)))
        db.execute(delete(Instrument).where(Instrument.id.in_(made)))
        db.execute(delete(User).where(User.id.in_([user.id, other.id])))
        db.commit()
        db.close()


def _market(world):
    nifty = world["add"]("NIFTY50", InstrumentType.INDEX, switching_prices(600, seed=4))
    a = world["add"]("AAA", InstrumentType.EQUITY, switching_prices(600, seed=8))
    b = world["add"]("BBB", InstrumentType.EQUITY, other_prices(600))
    return nifty, a, b


def _body(nifty, ids, **kw):
    return {
        "name": "Core sleeves",
        "strategy_ids": [str(i) for i in ids],
        "benchmark_instrument_id": str(nifty.id),
        "start_date": "2023-03-01",
        "end_date": "2024-04-30",
        "frequency": "WEEKLY",
        "regime_filter": False,
        **kw,
    }


def _run(body):
    wait_for_worker()
    created = client.post("/portfolio-backtests", json=body)
    assert created.status_code == 201, created.text
    run_id = created.json()["id"]
    deadline = time.time() + 180
    while time.time() < deadline:
        detail = client.get(f"/portfolio-backtests/{run_id}").json()
        if detail["status"] in TERMINAL:
            return created.json(), detail
        time.sleep(0.3)
    raise AssertionError("portfolio backtest did not finish")


def test_a_portfolio_backtest_runs_in_the_worker_and_its_result_is_stored(world):
    nifty, a, b = _market(world)
    s1 = world["strategy"]("Momentum A", "momentum", a)
    s2 = world["strategy"]("Mean reversion B", "mean_reversion", b)
    s3 = world["strategy"]("Never run", "momentum", a, backtest=False)
    limits = {"cash_reserve": 0.1, "max_strategy_weight": 0.6, "max_asset_weight": 1}
    created, detail = _run(_body(nifty, [s1.id, s2.id, s3.id], sixty_forty=True, limits=limits))
    assert created["status"] == "PENDING" and created["strategy_count"] == 2
    assert created["excluded"] == [{"strategy_id": str(s3.id), "name": "Never run", "reason": created["excluded"][0]["reason"]}]
    assert [s["name"] for s in created["strategies"]] == ["Momentum A", "Mean reversion B"]
    assert created["strategies"][0]["quantity"] == 50
    assert detail["status"] == "COMPLETED", detail["error_message"]
    assert detail["headline"] is not None

    results = client.get(f"/portfolio-backtests/{created['id']}/results")
    assert results.status_code == 200, results.text
    r = results.json()
    calendar = NSEMarketCalendar()
    days = [date.fromisoformat(d) for d in r["days"]]
    assert days[0] >= date(2023, 3, 1) and days[-1] <= date(2024, 4, 30)
    assert all(calendar.is_trading_day(d) for d in days)
    assert set(r["series"]) == {"portfolio", "nifty", "equal_weight", "sixty_forty"}
    assert all(len(v) == len(days) for v in r["series"].values())
    assert r["series"]["portfolio"][0] == pytest.approx(1_000_000 - r["rebalances"][0]["cost"])
    assert r["rebalances"][0]["cost"] == pytest.approx(
        r["rebalances"][0]["turnover"] * 1_000_000 * (0.0003 + 5 / 10_000)
    )
    assert len(r["rebalances"]) == r["rebalance_count"] > 50
    for entry in r["rebalances"]:
        assert sum(s["weight"] for s in entry["strategies"]) + entry["cash_weight"] == pytest.approx(1.0, abs=1e-9)
        assert entry["regime"] is None
        assert entry["cash_weight"] >= 0.1 - 1e-6  # cent rounding
        assert all(s["weight"] <= 0.6 + 1e-6 for s in entry["strategies"])
        assert {b["limit"] for b in entry["binding_limits"]} >= ({"cash_reserve"} if entry["cash_weight"] < 1 else set())
    # Nifty is its closes scaled to the capital (a price index).
    closes = regime_service.load_closes(world["db"], nifty.id, None, None).ohlcv["close"]
    by_day = {pb.ist_day(t): float(c) for t, c in closes.items()}
    assert r["series"]["nifty"][-1] == pytest.approx(1_000_000 * by_day[days[-1]] / by_day[days[0]])
    assert r["notes"][0] == sim.PRICE_INDEX_NOTE
    assert r["benchmark"]["symbol"] == "NIFTY50"
    objective = r["objectives"]["sharpe_improvement"]
    assert objective["met"] == (objective["value"] is not None and objective["value"] >= 0.30)
    assert detail["headline"]["sharpe_met"] == objective["met"]

    listed = client.get("/portfolio-backtests").json()
    assert [x["id"] for x in listed] == [created["id"]]
    # Stored: a second read is the same.
    assert client.get(f"/portfolio-backtests/{created['id']}/results").json() == r

    # Another user sees nothing.
    app.dependency_overrides[get_current_user] = lambda: world["other"]
    assert client.get(f"/portfolio-backtests/{created['id']}").status_code == 404
    assert client.get(f"/portfolio-backtests/{created['id']}/results").status_code == 404
    assert client.get("/portfolio-backtests").json() == []
    app.dependency_overrides[get_current_user] = lambda: world["user"]
    # A backtest id is not a portfolio backtest.
    backtest = world["db"].query(Execution).filter(Execution.strategy_id == s1.id,
                                                   Execution.execution_type == ExecutionType.BACKTEST).one()
    assert client.get(f"/portfolio-backtests/{backtest.id}").status_code == 404


def test_the_regime_filter_uses_the_models_regime_as_of_each_day(world):
    nifty, a, b = _market(world)
    s1 = world["strategy"]("Momentum A", "momentum", a)
    s2 = world["strategy"]("Mean reversion B", "mean_reversion", b)
    wait_for_worker()
    trained = client.post("/regime/models", json={"instrument_id": str(nifty.id), "random_state": 7})
    assert trained.status_code == 202, trained.text
    created, detail = _run(_body(nifty, [s1.id, s2.id], regime_filter=True, frequency="MONTHLY"))
    assert detail["status"] == "COMPLETED", detail["error_message"]
    assert created["regime_model"]["id"] == trained.json()["id"]
    r = client.get(f"/portfolio-backtests/{created['id']}/results").json()
    assert r["regime_model"]["id"] == trained.json()["id"]
    assert r["regime_in_sample"]["of_days"] == len(r["days"])
    seen = [e for e in r["rebalances"] if e["regime"]]
    assert seen
    for entry in seen:
        assert entry["regime"]["as_of"] <= entry["day"]
        for s in entry["strategies"]:
            if s["excluded"] and s["score"] is not None:
                assert s["weight"] == 0 and "Regime on this day" in s["excluded"]


def test_requests_that_cannot_run_are_refused(world):
    nifty, a, _ = _market(world)
    s1 = world["strategy"]("Momentum A", "momentum", a)
    never = world["strategy"]("Never run", "momentum", a, backtest=False)
    theirs = world["strategy"]("Theirs", "momentum", a, owner=world["other"])

    none = client.post("/portfolio-backtests", json=_body(nifty, [never.id]))
    assert none.status_code == 422 and "Never run" in none.json()["detail"]
    assert client.post("/portfolio-backtests", json=_body(nifty, [s1.id, theirs.id])).status_code == 404
    no_model = client.post("/portfolio-backtests", json=_body(nifty, [s1.id], regime_filter=True))
    assert no_model.status_code == 422 and "regime filter off" in no_model.json()["detail"]
    future = (date.today() + timedelta(days=5)).isoformat()
    assert client.post("/portfolio-backtests", json=_body(nifty, [s1.id], end_date=future)).status_code == 422
    empty = client.post("/portfolio-backtests", json=_body(nifty, [s1.id], start_date="2019-01-01", end_date="2019-06-01"))
    assert empty.status_code == 422 and "daily bars" in empty.json()["detail"]
    assert client.post("/portfolio-backtests", json=_body(nifty, [s1.id, s1.id])).status_code == 422
    assert client.post("/portfolio-backtests", json=_body(nifty, [s1.id], end_date="2023-01-01")).status_code == 422
    assert client.get(f"/portfolio-backtests/{uuid4()}").status_code == 404


def test_a_strategy_without_bars_in_the_period_fails_the_run_with_the_reason(world):
    nifty, a, _ = _market(world)
    old = world["add"]("OLDCO", InstrumentType.EQUITY, switching_prices(100, seed=5))
    s1 = world["strategy"]("Momentum A", "momentum", a)
    s2 = world["strategy"]("Old company", "momentum", old)
    created, detail = _run(_body(nifty, [s1.id, s2.id], frequency="MONTHLY"))
    assert detail["status"] == "FAILED"
    assert detail["error_message"].startswith("Old company: OLDCO has no stored daily bars in the period")
    assert detail["headline"] is None
    assert client.get(f"/portfolio-backtests/{created['id']}/results").status_code == 409
