"""Phase 10: GET /executions/{id}/results.

Two seeded results whose numbers are worked out by hand, then the endpoint
against the real database and the real backtest worker."""

import math
import statistics
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
from app.services.backtesting.executor_instance import backtest_executor
from app.services.backtesting.results_analytics import (
    PERIODS_PER_YEAR,
    RISK_FREE_RATE_PER_PERIOD,
    build_results,
)
from app.services.instruments.instrument_service import InstrumentService

client = TestClient(app)
DAY = timedelta(days=1)
T0 = datetime(2025, 1, 6, tzinfo=timezone.utc)


def iso(day: int) -> str:
    return (T0 + day * DAY).isoformat()


def canonical(values, trades, instrument="X"):
    return {
        "metadata": {"instrument_ids": [instrument]},
        "equity_curve": [{"timestamp": iso(i), "portfolio_value": v} for i, v in enumerate(values)],
        "trades": trades,
    }


def fill(day, side, quantity, price, charges=0.0):
    return {
        "timestamp": iso(day),
        "instrument_id": "X",
        "side": side,
        "quantity": float(quantity),
        "price": price,
        "brokerage": charges,
        "total_charges": charges,
    }


# --- seeded result 1: a long, then flipped to a short that is still open ----------
#   closes 100, 110, 90, 120; capital 10,000
#   day 0 BUY 10 @ 100            -> cash 9,000, long 10      equity 10,000
#   day 1                                                      equity 10,100
#   day 2 SELL 20 @ 90 (close 10, open short 10)  cash 10,800  equity  9,900
#   day 3                                                      equity  9,600
SEED_1 = canonical(
    [10000.0, 10100.0, 9900.0, 9600.0],
    [fill(0, "BUY", 10, 100.0), fill(2, "SELL", 20, 90.0)],
)
CLOSES_1 = {"X": {iso(i): c for i, c in enumerate([100.0, 110.0, 90.0, 120.0])}}


def test_seeded_result_1_every_number():
    r = build_results(canonical=SEED_1, initial_capital=10000.0, closes_by_instrument=CLOSES_1)
    s = r["summary"]
    assert s["initial_capital"] == 10000.0
    assert s["final_capital"] == 9600.0 == r["equity_curve"][-1]["portfolio_value"]
    assert s["net_profit"] == -400.0
    assert s["total_return"] == pytest.approx(-0.04)
    assert s["max_drawdown"] == pytest.approx(1 - 9600 / 10100)
    assert s["max_drawdown_peak_at"] == iso(1)
    assert s["max_drawdown_trough_at"] == iso(3)
    assert s["max_drawdown_duration_bars"] == 2
    assert [p["drawdown"] for p in r["equity_curve"]] == pytest.approx(
        [0.0, 0.0, 9900 / 10100 - 1, 9600 / 10100 - 1]
    )

    # Ratios, worked out independently with the statistics module.
    returns = [10100 / 10000 - 1, 9900 / 10100 - 1, 9600 / 9900 - 1]
    excess = [x - RISK_FREE_RATE_PER_PERIOD for x in returns]
    root = math.sqrt(PERIODS_PER_YEAR)
    assert s["annualized_volatility"] == pytest.approx(statistics.stdev(returns) * root)
    assert s["sharpe_ratio"] == pytest.approx(statistics.mean(excess) / statistics.stdev(excess) * root)
    downside = math.sqrt(sum(min(x, 0) ** 2 for x in excess) / 3)
    assert s["downside_deviation"] == pytest.approx(downside * root)
    assert s["sortino_ratio"] == pytest.approx(statistics.mean(excess) / downside * root)
    years = (3 * 86400) / (365.2425 * 86400)
    cagr = 0.96 ** (1 / years) - 1
    assert s["cagr"] == pytest.approx(cagr)
    assert s["calmar_ratio"] == pytest.approx(cagr / (1 - 9600 / 10100))

    closed, still_open = r["round_trips"]
    assert closed == {
        "instrument_id": "X",
        "direction": "LONG",
        "quantity": 10,
        "entry_timestamp": iso(0),
        "entry_price": 100.0,
        "exit_timestamp": iso(2),
        "exit_price": 90.0,
        "gross_pnl": -100.0,
        "charges": 0.0,
        "net_pnl": -100.0,
        "return": -0.1,
        "is_open": False,
    }
    assert still_open["direction"] == "SHORT" and still_open["is_open"]
    assert still_open["entry_price"] == 90.0 and still_open["exit_price"] is None
    assert still_open["net_pnl"] == -300.0
    # Every trade together explains the whole profit.
    assert closed["net_pnl"] + still_open["net_pnl"] == s["net_profit"]

    t = r["trade_stats"]
    assert t == {
        "fill_count": 2,
        "round_trip_count": 1,
        "open_position_count": 1,
        "winning_trades": 0,
        "losing_trades": 1,
        "win_rate": 0.0,
        "average_gain": None,
        "average_loss": -100.0,
        "profit_factor": 0.0,
        "total_charges": 0.0,
        "total_brokerage": 0.0,
    }
    assert r["null_reasons"]["average_gain"] == "No closed trade made a profit."

    records = r["records"]
    assert [f["realized_pnl"] for f in records["fills"]] == [0.0, -100.0]
    assert [(f["closed_quantity"], f["opened_quantity"]) for f in records["fills"]] == [(0, 10), (10, 10)]
    assert [(o["reference_price"], o["fill_price"]) for o in records["orders"]] == [(100.0, 100.0), (90.0, 90.0)]
    assert records["positions"] == [
        {
            "instrument_id": "X",
            "direction": "SHORT",
            "quantity": 10,
            "average_price": 90.0,
            "last_price": 120.0,
            "market_value": -1200.0,
            "unrealized_pnl": -300.0,
        }
    ]
    assert records["ending_cash"] == 10800.0
    assert records["ending_cash"] - 1200.0 == s["final_capital"]

    assert r["benchmark"]["total_return"] == pytest.approx(0.2)
    assert [p["portfolio_value"] for p in r["benchmark"]["equity_curve"]] == pytest.approx(
        [10000, 11000, 9000, 12000]
    )
    assert r["monthly_returns"] == [{"month": "2025-01", "value": pytest.approx(-0.04)}]


# --- seeded result 2: no trades, flat equity, across two months --------------------
SEED_2 = canonical([5000.0] * 30, [])
CLOSES_2 = {"X": {iso(i): 50.0 + i for i in range(30)}}


def test_seeded_result_2_no_trades_is_a_valid_result():
    r = build_results(canonical=SEED_2, initial_capital=5000.0, closes_by_instrument=CLOSES_2)
    s = r["summary"]
    assert s["net_profit"] == 0.0 and s["total_return"] == 0.0
    assert s["max_drawdown"] == 0.0
    assert s["annualized_volatility"] == 0.0
    assert s["sharpe_ratio"] is None
    assert r["null_reasons"]["sharpe_ratio"] == "Returns did not vary, so the ratio is not defined."
    assert s["calmar_ratio"] is None
    assert r["null_reasons"]["calmar_ratio"] == "There was no drawdown, so the ratio is not defined."
    assert r["trade_stats"]["fill_count"] == 0
    assert r["trade_stats"]["win_rate"] is None
    assert r["null_reasons"]["win_rate"] == "The strategy made no trades."
    assert r["round_trips"] == [] and r["records"]["positions"] == []
    assert r["records"]["ending_cash"] == 5000.0
    assert [m["month"] for m in r["monthly_returns"]] == ["2025-01", "2025-02"]
    assert r["benchmark"]["total_return"] == pytest.approx(79 / 50 - 1)


def test_a_missing_price_means_no_benchmark_with_a_reason():
    closes = {"X": {iso(0): 100.0, iso(1): 110.0}}
    r = build_results(canonical=SEED_1, initial_capital=10000.0, closes_by_instrument=closes)
    assert r["benchmark"] is None
    assert r["benchmark_unavailable_reason"] == "Stored prices are missing for some bars of this run."
    assert r["records"]["positions"][0]["last_price"] is None


def test_charges_are_counted_and_split_between_closing_and_opening():
    seed = canonical(
        [10000.0, 9990.0],
        [fill(0, "BUY", 10, 100.0, charges=4.0), fill(1, "SELL", 20, 100.0, charges=8.0)],
    )
    r = build_results(
        canonical=seed,
        initial_capital=10000.0,
        closes_by_instrument={"X": {iso(0): 100.0, iso(1): 100.0}},
    )
    closed, still_open = r["round_trips"]
    assert closed["charges"] == 8.0  # 4 to open + half of the 8 on the flip
    assert closed["net_pnl"] == -8.0
    assert still_open["charges"] == 4.0
    assert r["trade_stats"]["total_charges"] == 12.0


# --- the endpoint, against the database and the worker -----------------------------


@pytest.fixture
def world():
    db = SessionLocal()
    users = [User(full_name=f"R {n}", email=f"res-{uuid4().hex[:8]}@example.com", password_hash="x") for n in (1, 2)]
    db.add_all(users)
    db.commit()
    instrument = InstrumentService(db).create_instrument(
        symbol="RES",
        trading_symbol=f"RES-{uuid4().hex[:6]}",
        name="Results test",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin=None,
        lot_size=1,
        tick_size=0.05,
    )
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    for day in range(300):
        close = 500 + day * 0.8 + 30 * math.sin(day / 9)
        db.add(
            MarketData(
                instrument_id=instrument.id,
                timestamp=start + day * DAY,
                timeframe=Timeframe.ONE_DAY,
                open=close,
                high=close + 2,
                low=close - 2,
                close=close,
                volume=1000,
            )
        )
    strategy = Strategy(
        user_id=users[0].id,
        name="Results momentum",
        strategy_type=StrategyType.PYTHON,
        strategy_config={"parameters": {"template": "momentum", "lookback": 10}},
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    app.dependency_overrides[get_current_user] = lambda: users[0]
    try:
        yield {"db": db, "users": users, "instrument": instrument, "strategy": strategy, "start": start}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        deadline = time.time() + 60
        while not backtest_executor.has_capacity() and time.time() < deadline:
            time.sleep(0.2)
        db.execute(delete(Execution).where(Execution.strategy_id == strategy.id))
        db.execute(delete(Strategy).where(Strategy.id == strategy.id))
        db.execute(delete(MarketData).where(MarketData.instrument_id == instrument.id))
        db.execute(delete(Instrument).where(Instrument.id == instrument.id))
        db.execute(delete(User).where(User.id.in_([u.id for u in users])))
        db.commit()
        db.close()


def run_to_end(world):
    deadline = time.time() + 60
    while not backtest_executor.has_capacity() and time.time() < deadline:
        time.sleep(0.2)
    created = client.post(
        "/backtests",
        json={
            "strategy_id": str(world["strategy"].id),
            "instrument_id": str(world["instrument"].id),
            "timeframe": "1D",
            "initial_capital": 100000,
            "start_timestamp": world["start"].isoformat(),
            "end_timestamp": (world["start"] + 299 * DAY).isoformat(),
            "execution_config": {"lookback": 10},
            "quantity": 5,
            "slippage_bps": 5,
            "brokerage_rate": 0.0003,
        },
    )
    assert created.status_code == 201, created.text
    execution_id = created.json()["id"]
    deadline = time.time() + 90
    while time.time() < deadline:
        execution = client.get(f"/executions/{execution_id}").json()
        if execution["status"] in ("COMPLETED", "FAILED", "CANCELLED"):
            return execution
        time.sleep(0.3)
    raise AssertionError("the backtest did not finish")


def test_results_of_a_real_run_match_the_stored_result(world):
    execution = run_to_end(world)
    assert execution["status"] == "COMPLETED", execution["error"]
    stored = execution["execution_metrics"]["canonical_result"]

    response = client.get(f"/executions/{execution['id']}/results")
    assert response.status_code == 200, response.text
    r = response.json()

    s = r["summary"]
    assert s["final_capital"] == stored["equity_curve"][-1]["portfolio_value"]
    assert s["final_capital"] == r["equity_curve"][-1]["portfolio_value"]
    assert s["total_return"] == pytest.approx(stored["metrics"]["total_return"])
    assert s["max_drawdown"] == pytest.approx(stored["metrics"]["max_drawdown"])
    assert len(r["equity_curve"]) == len(stored["equity_curve"]) == s["bar_count"]
    assert r["trade_stats"]["fill_count"] == len(stored["trades"]) > 0
    assert r["trade_stats"]["total_charges"] == pytest.approx(
        sum(t["total_charges"] for t in stored["trades"])
    )
    assert sum(t["net_pnl"] for t in r["round_trips"]) == pytest.approx(s["net_profit"], abs=1e-6)
    cash = r["records"]["ending_cash"]
    held = sum(p["market_value"] for p in r["records"]["positions"])
    assert cash + held == pytest.approx(s["final_capital"])
    assert r["benchmark"]["kind"] == "buy_and_hold"
    assert len(r["benchmark"]["equity_curve"]) == s["bar_count"]
    assert r["basis"] == {
        "periods_per_year": 252,
        "risk_free_rate_annual": 0.065,
        "risk_free_rate_per_period": pytest.approx(1.065 ** (1 / 252) - 1),
        "return_frequency": "per bar (daily bars)",
        "cagr_year_days": 365.2425,
    }
    c = r["configuration"]
    assert c["strategy_name"] == "Results momentum"
    assert c["strategy_version"] == 1 == c["current_strategy_version"]
    assert c["engine_version"] == "1.3"
    assert c["parameters"] == {"lookback": 10}
    assert (c["quantity"], c["slippage_bps"], c["brokerage_rate"]) == (5, 5.0, 0.0003)
    dataset = r["provenance"]["datasets"][0]
    assert dataset["instrument_id"] == str(world["instrument"].id)
    assert dataset["row_count"] == 300
    assert dataset["provider"] and dataset["data_fingerprint"]
    assert "strategy_version" not in r["null_reasons"]


def test_results_need_a_completed_run_and_the_owner(world):
    db = world["db"]
    pending = Execution(
        strategy_id=world["strategy"].id,
        instrument_id=world["instrument"].id,
        execution_type=ExecutionType.BACKTEST,
        status=ExecutionStatus.PENDING,
        timeframe="1D",
        initial_capital=1000,
        execution_config={},
    )
    db.add(pending)
    db.commit()
    response = client.get(f"/executions/{pending.id}/results")
    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Results are available once the backtest has completed (it is PENDING)."
    )
    assert client.get(f"/executions/{uuid4()}/results").status_code == 404

    app.dependency_overrides[get_current_user] = lambda: world["users"][1]
    assert client.get(f"/executions/{pending.id}/results").status_code == 404


def test_an_older_run_says_what_was_not_recorded(world):
    db = world["db"]
    old = Execution(
        strategy_id=world["strategy"].id,
        instrument_id=world["instrument"].id,
        execution_type=ExecutionType.BACKTEST,
        status=ExecutionStatus.COMPLETED,
        timeframe="1D",
        initial_capital=10000,
        execution_config={"lookback": 10},
        execution_metrics={"canonical_result": {**SEED_1, "metadata": {"instrument_ids": [str(world["instrument"].id)]}, "trades": []}},
    )
    db.add(old)
    db.commit()
    r = client.get(f"/executions/{old.id}/results").json()
    assert r["configuration"]["strategy_version"] is None
    assert r["null_reasons"]["strategy_version"].startswith("Not recorded")
    assert r["null_reasons"]["engine_version"].startswith("Not recorded")
    assert r["provenance"] == {"datasets": [], "aligned_rows": None}
