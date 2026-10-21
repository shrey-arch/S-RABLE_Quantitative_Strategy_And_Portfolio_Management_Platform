"""Phase 15: trading records (orders, trades, positions) of the user's backtests.

A seeded backtest result is stored as records; every stored value must equal
what GET /executions/{id}/results shows for the same run. Then filters,
ownership, order lifecycle (400 on an invalid change) and delete."""

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
    OrderSide,
    OrderStatus,
    OrderType,
    StrategyType,
    Timeframe,
)
from app.main import app
from app.models import Execution, Instrument, MarketData, Order, Position, Strategy, Trade, User
from app.services.backtesting.backtest_service import BacktestService
from app.services.instruments.instrument_service import InstrumentService
from app.services.records.service import ALREADY_STORED

client = TestClient(app)
DAY = timedelta(days=1)
T0 = datetime(2025, 1, 6, 9, 15, tzinfo=timezone.utc)
CLOSES = {"A": [100.0, 110.0, 90.0, 120.0], "B": [50.0, 52.0, 54.0, 55.0]}


def iso(day: int) -> str:
    return (T0 + day * DAY).isoformat()


def fill(day, instrument, side, quantity, price, charges=0.0):
    return {
        "timestamp": iso(day),
        "instrument_id": instrument,
        "side": side,
        "quantity": float(quantity),
        "price": price,
        "brokerage": charges / 2,
        "total_charges": charges,
    }


def seeded_result(a: str, b: str) -> dict:
    """A: long 10 @ 100, then sells 20 @ 90 (flips to a short 10, open at the end).
    B: long 5 @ 50, sold 5 @ 55 (closed)."""
    return {
        "metadata": {"instrument_ids": [a, b]},
        "equity_curve": [
            {"timestamp": iso(i), "portfolio_value": v}
            for i, v in enumerate([10000.0, 10110.0, 9905.0, 9625.0])
        ],
        "trades": [
            fill(0, a, "BUY", 10, 100.0, 2.0),
            fill(1, b, "BUY", 5, 50.0, 1.0),
            fill(2, a, "SELL", 20, 90.0, 3.0),
            fill(3, b, "SELL", 5, 55.0, 1.0),
        ],
        "provenance": {},
    }


def instrument(db, name):
    item = InstrumentService(db).create_instrument(
        symbol=name,
        trading_symbol=f"{name}-{uuid4().hex[:6]}",
        name=f"Records {name}",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin=None,
        lot_size=1,
        tick_size=0.05,
    )
    for day, close in enumerate(CLOSES[name]):
        db.add(
            MarketData(
                instrument_id=item.id,
                timestamp=T0 + day * DAY,
                timeframe=Timeframe.ONE_DAY,
                open=close,
                high=close,
                low=close,
                close=close,
                volume=100,
            )
        )
    return item


@pytest.fixture
def world():
    db = SessionLocal()
    user = User(full_name="Records", email=f"rec-{uuid4().hex[:8]}@example.com", password_hash="x")
    other = User(full_name="Other", email=f"reo-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add_all([user, other])
    db.commit()
    a, b = instrument(db, "A"), instrument(db, "B")
    strategies = []

    def execution(owner, status=ExecutionStatus.COMPLETED, kind=ExecutionType.BACKTEST):
        strategy = Strategy(
            user_id=owner.id,
            name="Records run",
            strategy_type=StrategyType.PYTHON,
            strategy_config={"parameters": {"template": "momentum"}},
        )
        db.add(strategy)
        db.flush()
        strategies.append(strategy)
        run = Execution(
            strategy_id=strategy.id,
            instrument_id=a.id,
            execution_type=kind,
            status=status,
            timeframe="1D",
            initial_capital=10000,
            execution_config={},
            run_settings={"strategy_key": "momentum"},
            execution_metrics={"canonical_result": seeded_result(str(a.id), str(b.id))},
        )
        db.add(run)
        db.flush()
        return run

    mine = execution(user)
    theirs = execution(other)
    running = execution(user, status=ExecutionStatus.RUNNING)
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {
            "db": db,
            "user": user,
            "other": other,
            "a": a,
            "b": b,
            "mine": mine,
            "theirs": theirs,
            "running": running,
        }
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.rollback()
        ids = [s.id for s in strategies]
        db.execute(delete(Execution).where(Execution.strategy_id.in_(ids)))
        db.execute(delete(Strategy).where(Strategy.id.in_(ids)))
        db.execute(delete(MarketData).where(MarketData.instrument_id.in_([a.id, b.id])))
        db.execute(delete(Instrument).where(Instrument.id.in_([a.id, b.id])))
        db.execute(delete(User).where(User.id.in_([user.id, other.id])))
        db.commit()
        db.close()


def store(world, key="mine"):
    return client.post(f"/executions/{world[key].id}/records")


def as_user(user):
    app.dependency_overrides[get_current_user] = lambda: user


def test_stored_records_equal_the_results_page(world):
    response = store(world)
    assert response.status_code == 201, response.text
    assert response.json() == {
        "execution_id": str(world["mine"].id),
        "stored": True,
        "orders": 4,
        "trades": 4,
        "positions": 2,
    }
    results = client.get(f"/executions/{world['mine'].id}/results").json()["records"]
    run = {"execution_id": str(world["mine"].id)}
    orders = client.get("/orders", params=run).json()
    trades = client.get("/trades", params=run).json()
    positions = client.get("/positions", params=run).json()

    # One completed MARKET order and one trade per fill, oldest last.
    by_time = sorted(orders, key=lambda o: o["order_timestamp"])
    for order, expected, fill_ in zip(by_time, results["orders"], results["fills"]):
        assert order["order_type"] == "MARKET" and order["status"] == "COMPLETED"
        assert order["order_side"] == expected["side"]
        assert order["instrument_id"] == expected["instrument_id"]
        assert order["quantity"] == order["filled_quantity"] == expected["quantity"]
        assert order["price"] == expected["reference_price"]
        assert order["average_fill_price"] == expected["fill_price"]
        trade = next(t for t in trades if t["order_id"] == order["id"])
        assert trade["execution_id"] == str(world["mine"].id)
        assert trade["instrument_id"] == order["instrument_id"]
        assert trade["order_side"] == order["order_side"]
        assert trade["executed_quantity"] == fill_["quantity"]
        assert trade["executed_price"] == fill_["price"]
        assert trade["brokerage"] == fill_["brokerage"]
        assert trade["total_charges"] == fill_["total_charges"]
        assert trade["trade_timestamp"] == order["order_timestamp"]

    a, b = str(world["a"].id), str(world["b"].id)
    open_ = next(p for p in positions if p["instrument_id"] == a)
    end = next(p for p in results["positions"] if p["instrument_id"] == a)
    assert open_["position_status"] == "OPEN" and open_["closed_at"] is None
    assert open_["direction"] == end["direction"] == "SHORT"
    assert open_["quantity"] == end["quantity"] == 10
    assert open_["average_price"] == end["average_price"] == 90.0
    assert open_["current_price"] == end["last_price"] == 120.0
    assert open_["market_value"] == abs(end["market_value"]) == 1200.0
    # unrealised = (current - average) x quantity, negative quantity for a short.
    assert open_["unrealized_pnl"] == end["unrealized_pnl"] == -300.0
    # realised = (90 - 100) x 10 closed; the sum of the fills' realised P&L.
    assert open_["realized_pnl"] == sum(
        f["realized_pnl"] for f in results["fills"] if f["instrument_id"] == a
    ) == -100.0

    closed = next(p for p in positions if p["instrument_id"] == b)
    assert closed["position_status"] == "CLOSED" and closed["direction"] == "LONG"
    assert closed["quantity"] == 0 and closed["market_value"] == 0 and closed["unrealized_pnl"] == 0
    assert closed["average_price"] == 50.0 and closed["current_price"] == 55.0
    assert closed["realized_pnl"] == 25.0
    assert datetime.fromisoformat(closed["closed_at"].replace("Z", "+00:00")) == T0 + 3 * DAY

    again = store(world)
    assert again.status_code == 409 and again.json()["detail"] == ALREADY_STORED
    assert client.get(f"/executions/{world['mine'].id}/records").json()["stored"] is True


def test_records_are_stored_when_a_backtest_completes(world):
    db = world["db"]
    # The worker stores them just before it marks the run COMPLETED (one commit).
    BacktestService(db)._store_records(world["mine"])
    db.commit()
    assert client.get(f"/executions/{world['mine'].id}/records").json()["orders"] == 4
    # Only backtests get records.
    world["running"].execution_type = ExecutionType.VALIDATION
    BacktestService(db)._store_records(world["running"])
    db.commit()
    assert client.get(f"/executions/{world['running'].id}/records").json()["stored"] is False
    # A run that has not completed cannot be stored by hand.
    world["running"].execution_type = ExecutionType.BACKTEST
    db.commit()
    refused = store(world, "running")
    assert refused.status_code == 409
    assert "completed" in refused.json()["detail"]


def test_filters(world):
    store(world)
    mine = {"execution_id": str(world["mine"].id)}
    a, b = str(world["a"].id), str(world["b"].id)
    sells = client.get("/orders", params={**mine, "side": "SELL"}).json()
    assert [o["order_side"] for o in sells] == ["SELL", "SELL"]
    assert len(client.get("/orders", params={**mine, "instrument_id": b}).json()) == 2
    assert len(client.get("/orders", params={**mine, "status": "COMPLETED"}).json()) == 4
    assert client.get("/orders", params={**mine, "status": "OPEN"}).json() == []
    # Dates are IST days of the order time.
    day1 = (T0 + DAY).astimezone(timezone(timedelta(hours=5, minutes=30))).date().isoformat()
    on_day1 = client.get("/orders", params={**mine, "start_date": day1, "end_date": day1}).json()
    assert [o["instrument_id"] for o in on_day1] == [b]
    first = sells[0]
    linked = client.get("/trades", params={"order_id": first["id"]}).json()
    assert [t["order_id"] for t in linked] == [first["id"]]
    assert len(client.get("/trades", params={**mine, "side": "BUY"}).json()) == 2
    assert len(client.get("/trades", params={**mine, "instrument_id": a}).json()) == 2
    assert [p["instrument_id"] for p in client.get("/positions", params={**mine, "status": "CLOSED"}).json()] == [b]
    assert [p["instrument_id"] for p in client.get("/positions", params={**mine, "direction": "SHORT"}).json()] == [a]


def test_only_your_own_records(world):
    as_user(world["other"])
    assert store(world, "theirs").status_code == 201
    theirs = client.get("/orders").json()
    as_user(world["user"])
    store(world)
    mine = client.get("/orders").json()
    assert {o["execution_id"] for o in mine} == {str(world["mine"].id)}
    order = theirs[0]
    trade = client.get("/trades").json()[0]
    assert client.get(f"/orders/{order['id']}").status_code == 404
    assert client.post(f"/orders/{order['id']}/cancel").status_code == 404
    assert client.delete(f"/orders/{order['id']}").status_code == 404
    assert client.get(f"/executions/{world['theirs'].id}/records").status_code == 404
    assert store(world, "theirs").status_code == 404
    as_user(world["other"])
    assert client.get(f"/trades/{trade['id']}").status_code == 404
    assert len(client.get("/orders").json()) == 4


def test_order_lifecycle_rejects_invalid_changes_with_400(world):
    store(world)
    completed = client.get("/orders", params={"execution_id": str(world["mine"].id)}).json()[0]
    for action in ("open", "complete", "cancel", "reject"):
        refused = client.post(f"/orders/{completed['id']}/{action}")
        assert refused.status_code == 400
        assert refused.json()["detail"].startswith("Invalid order transition: COMPLETED -> ")

    db = world["db"]
    pending = Order(
        execution_id=world["mine"].id,
        instrument_id=world["a"].id,
        order_type=OrderType.MARKET,
        order_side=OrderSide.BUY,
        status=OrderStatus.PENDING,
        quantity=1,
        filled_quantity=0,
        price=100,
    )
    db.add(pending)
    db.commit()
    assert client.post(f"/orders/{pending.id}/complete").json()["detail"] == (
        "Invalid order transition: PENDING -> COMPLETED."
    )
    assert client.post(f"/orders/{pending.id}/open").json()["status"] == "OPEN"
    assert client.post(f"/orders/{pending.id}/complete").json()["status"] == "COMPLETED"
    assert client.post(f"/orders/{pending.id}/cancel").status_code == 400


def test_delete_records(world):
    store(world)
    mine = {"execution_id": str(world["mine"].id)}
    order = client.get("/orders", params=mine).json()[0]
    assert client.delete(f"/orders/{order['id']}").status_code == 204
    # The order's trades go with it; positions are not changed.
    assert client.get("/trades", params={"order_id": order["id"]}).json() == []
    assert len(client.get("/positions", params=mine).json()) == 2
    trade = client.get("/trades", params=mine).json()[0]
    assert client.delete(f"/trades/{trade['id']}").status_code == 204
    assert client.get(f"/trades/{trade['id']}").status_code == 404
    position = client.get("/positions", params=mine).json()[0]
    assert client.delete(f"/positions/{position['id']}").status_code == 204
    assert len(client.get("/positions", params=mine).json()) == 1
    left = world["db"].scalars(select(Trade).join(Order).where(Order.execution_id == world["mine"].id)).all()
    assert len(left) == 2


def test_records_cannot_be_created_and_need_a_login(world):
    for path in ("/orders", "/trades", "/trades/execute", "/positions"):
        assert client.post(path, json={}).status_code == 405
    app.dependency_overrides.pop(get_current_user, None)
    for path in ("/orders", "/trades", "/positions"):
        assert client.get(path).status_code == 401
    assert client.post(f"/executions/{world['mine'].id}/records").status_code == 401
    as_user(world["user"])


def test_positions_report_their_direction(world):
    db = world["db"]
    store(world)
    rows = db.scalars(select(Position).where(Position.execution_id == world["mine"].id)).all()
    assert sorted(p.direction for p in rows) == ["LONG", "SHORT"]
