"""Feature 7, P2: live paper sessions.

Parity: a replayed day gives the backtest engine's own trades on the same bars
(time, side, quantity; prices on the tick grid). Square-off at 15:20 and the end
at 15:30; the daily loss limit; position-value refusals; the kill switch with and
without square-off; restart catch-up; the stale-data guard in delayed mode;
pause and resume; intraday charges and short positions; the API with owner
checks and the event stream."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from uuid import UUID as UUID_, uuid4

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.backtesting.broker import SimulatedBroker
from app.backtesting.engine import BacktestEngine
from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import ExecutionStatus, Exchange, InstrumentType, StrategyType
from app.live import bars as B
from app.live.clock import IST, session_close, session_open
from app.live.feed import RecordedFeed
from app.main import app
from app.models import (
    Execution,
    Instrument,
    LiveBar,
    LiveSession,
    LiveSessionEvent,
    Notification,
    PaperAccount,
    PaperCashEntry,
    PaperFill,
    PaperOrder,
    Strategy,
    User,
)
from app.services.instruments.instrument_service import InstrumentService
from app.services.live import sessions as S
from app.services.live import store
from app.services.live.runner import LiveRunner
from app.services.live.trading import apply_fill
from app.services.paper import service as paper
from app.services.paper.charges import calculate_mis_charges
from app.strategies.factory import build_strategy
from tests.live_synth import intraday_day

client = TestClient(app)
DAY = date(2026, 10, 16)
PREV = date(2026, 10, 15)
EVENING = datetime(2026, 10, 16, 18, 0, tzinfo=IST)


def ist(h, m, s=0, day=DAY):
    return datetime(day.year, day.month, day.day, h, m, s, tzinfo=IST)


def rows_of(df):
    return [{"timestamp": t.to_pydatetime(), **r} for t, r in df.to_dict("index").items()]


@pytest.fixture
def world():
    db = SessionLocal()
    user = User(full_name="Live", email=f"lv-{uuid4().hex[:8]}@example.com", password_hash="x")
    other = User(full_name="Other", email=f"lvo-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add_all([user, other])
    db.commit()
    instrument = InstrumentService(db).create_instrument(
        symbol=f"LV{uuid4().hex[:5].upper()}",
        trading_symbol=f"LV-{uuid4().hex[:6]}",
        name="Live test",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin=None,
        lot_size=1,
        tick_size=0.05,
    )
    one = pd.concat([intraday_day(PREV, seed=11), intraday_day(DAY, seed=12)])
    strategies = []

    def strategy(key="momentum", owner=user, **params):
        config = {"parameters": {"template": key, **params}, "indicators": [], "entry_conditions": [], "exit_conditions": []}
        row = Strategy(user_id=owner.id, name=f"Live {key}", strategy_type=StrategyType.PYTHON, strategy_config=config)
        db.add(row)
        db.commit()
        strategies.append(row.id)
        return row

    def record(df=one):
        return store.save_bars(db, instrument.id, rows_of(df), "recorded")

    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {"db": db, "user": user, "other": other, "instrument": instrument, "one": one, "strategy": strategy, "record": record}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.rollback()
        users = [user.id, other.id]
        accounts = [a for a in db.scalars(select(PaperAccount.id).where(PaperAccount.user_id.in_(users)))]
        db.execute(delete(LiveSessionEvent).where(LiveSessionEvent.session_id.in_(select(LiveSession.id).where(LiveSession.user_id.in_(users)))))
        db.execute(delete(PaperCashEntry).where(PaperCashEntry.account_id.in_(accounts)))
        db.execute(delete(PaperFill).where(PaperFill.account_id.in_(accounts)))
        db.execute(delete(PaperOrder).where(PaperOrder.account_id.in_(accounts)))
        db.execute(delete(LiveSession).where(LiveSession.user_id.in_(users)))
        db.execute(delete(Notification).where(Notification.user_id.in_(users)))
        db.execute(delete(Execution).where(Execution.strategy_id.in_(strategies)))
        db.execute(delete(Strategy).where(Strategy.id.in_(strategies)))
        db.execute(delete(PaperAccount).where(PaperAccount.id.in_(accounts)))
        db.execute(delete(LiveBar).where(LiveBar.instrument_id == instrument.id))
        db.execute(delete(Instrument).where(Instrument.id == instrument.id))
        db.execute(delete(User).where(User.id.in_(users)))
        db.commit()
        db.close()


def replay(world, strategy, *, timeframe="5M", speed=10, quantity=10, capital=500000, **kw):
    return S.create_session(
        world["db"],
        world["user"],
        strategy_id=strategy.id,
        instrument_id=world["instrument"].id,
        timeframe=timeframe,
        mode="REPLAY",
        replay_date=DAY,
        speed=speed,
        capital=capital,
        quantity=quantity,
        slippage_bps=5,
        loss_limit_pct=kw.pop("loss_limit_pct", None),
        max_position_value=kw.pop("max_position_value", None),
        now=kw.pop("now", EVENING.astimezone(timezone.utc)),
    )


def run(runner, start, until, step_seconds=6):
    at = start.astimezone(timezone.utc)
    while at <= until.astimezone(timezone.utc):
        runner.tick(at)
        at += timedelta(seconds=step_seconds)
    return at


def fills(db, s):
    return S.fills_view(db, db.get(LiveSession, s.id))


def reload(db, s):
    db.expire_all()
    return db.get(LiveSession, s.id)


def to_tick(price, side):
    tick = Decimal("0.05")
    p = Decimal(str(price))
    q = (p / tick).to_integral_value(rounding=ROUND_CEILING if side == "BUY" else ROUND_FLOOR)
    return float(q * tick)


# --- parity -----------------------------------------------------------------------------


def engine_trades(world, timeframe, quantity, params):
    one = world["one"]
    bars, _ = B.history(one, timeframe, session_close(DAY))
    result = BacktestEngine().run(
        strategy=build_strategy("momentum", params),
        data=bars,
        execution_id=uuid4(),
        instrument_id=world["instrument"].id,
        initial_capital=10_000_000,
        broker=SimulatedBroker(slippage_bps=5),
        quantity=quantity,
        trade_from=pd.Timestamp(session_open(DAY)).tz_convert("UTC"),
    )
    cutoff = ist(15, 20)
    out = []
    for t in result.trades:
        start = pd.Timestamp(t["timestamp"]).tz_convert("UTC").to_pydatetime()
        if B.bar_end(start, timeframe) <= cutoff:
            out.append((B.bar_end(start, timeframe), t["side"], t["quantity"], t["price"]))
    return out


@pytest.mark.parametrize("timeframe", ["5M", "15M"])
def test_a_replayed_day_trades_exactly_like_the_backtest_and_ends_flat(world, timeframe):
    db = world["db"]
    world["record"]()
    strategy = world["strategy"](lookback=6)
    s = replay(world, strategy, timeframe=timeframe)
    runner = LiveRunner(feed=None)
    run(runner, EVENING, EVENING + timedelta(minutes=40), step_seconds=30)
    s = reload(db, s)
    assert s.status == "COMPLETED" and s.status_reason == "The session ended at 15:30."
    got = fills(db, s)
    signals = [f for f in got if f["reason"].startswith("signal")]
    expected = engine_trades(world, timeframe, 10, {"lookback": 6})
    assert len(expected) >= 4
    assert [(f["filled_at"], f["side"], f["quantity"]) for f in signals] == [(e[0], e[1], e[2]) for e in expected]
    for f, e in zip(signals, expected):
        assert f["price"] == to_tick(e[3], f["side"])
    # Anything still held at 15:20 is squared off at the 15:19 bar's close.
    if s.squared_off and got[-1]["reason"].startswith("Auto square-off"):
        last_minute = world["one"].loc[pd.Timestamp(ist(15, 19)).tz_convert("UTC")]
        assert got[-1]["filled_at"] == ist(15, 20)
        assert got[-1]["bar_close"] == float(last_minute["close"])
    assert s.position_qty == 0 and s.squared_off
    # The money adds up: realised P&L from the fills, charges from the fills.
    assert float(s.realised_pnl) == pytest.approx(sum(f["realised_pnl"] or 0 for f in got))
    assert float(s.charges) == pytest.approx(sum(f["total_charges"] for f in got))
    assert s.summary["net_pnl"] == pytest.approx(float(s.realised_pnl) - float(s.charges))
    execution = db.get(Execution, s.id)
    assert execution.status == ExecutionStatus.COMPLETED
    titles = [n.title for n in db.scalars(select(Notification).where(Notification.user_id == world["user"].id))]
    assert titles.count("Live paper session started") == 1 and titles.count("Live paper session completed") == 1
    # Every fill is an intraday paper order of the user's account.
    orders = db.scalars(select(PaperOrder).where(PaperOrder.live_session_id == s.id)).all()
    assert {o.product for o in orders} == {"MIS"} and {o.source for o in orders} == {"LIVE"}


def _decisions(db, session):
    """Every signal this session acted on, as (bar, action, target)."""
    rows = db.scalars(
        select(LiveSessionEvent)
        .where(LiveSessionEvent.session_id == session.id, LiveSessionEvent.kind == "SIGNAL")
        .order_by(LiveSessionEvent.id)
    ).all()
    out = []
    for row in rows:
        data = row.data or {}
        out.append((str(data.get("bar"))[11:16], data.get("action"), data.get("target")))
    return out


def _bars_seen(db, session):
    """Every bar this session was given, by closing time."""
    rows = db.scalars(
        select(LiveSessionEvent)
        .where(LiveSessionEvent.session_id == session.id, LiveSessionEvent.kind == "BAR")
        .order_by(LiveSessionEvent.id)
    ).all()
    return [str((row.data or {}).get("bar"))[11:16] for row in rows]


def test_a_restart_catches_up_and_gives_the_same_trades(world):
    db = world["db"]
    world["record"]()
    strategy = world["strategy"](lookback=6)
    a = replay(world, strategy)
    b = replay(world, strategy)
    first = LiveRunner(feed=None)
    run(first, EVENING, EVENING + timedelta(minutes=10), step_seconds=30)  # until 11:55 market
    # "Restart": a new runner (nothing in memory), 20 minutes later; it catches up.
    second = LiveRunner(feed=None)
    run(second, EVENING + timedelta(minutes=30), EVENING + timedelta(minutes=40), step_seconds=30)
    a, b = reload(db, a), reload(db, b)
    assert a.status == b.status == "COMPLETED"
    # Sorted, because two fills can share an instant and their order within it
    # carries no meaning: the 15:15 signal fills at 15:20, and the 15:20
    # square-off is stamped 15:20 as well. Both sessions produce both fills; which
    # of the two the database returns first is its own business. Sorting compares
    # what the sessions did, not the order a query happened to return it in.
    at_the_same_instant = lambda f: (f["filled_at"], f["side"], f["quantity"], f["price"])
    fa = sorted((at_the_same_instant(f) for f in fills(db, a)))
    fb = sorted((at_the_same_instant(f) for f in fills(db, b)))
    assert fa, "the replay placed no orders at all"
    if fa != fb:
        # This has failed once, on a loaded Windows machine, and not since - two
        # replays of one recorded day ended holding opposite positions, so the
        # 15:20 square-off flattened one with a BUY and the other with a SELL.
        # A truncated list diff says nothing about why, so say which bars each
        # session actually traded and what it decided on them: if the two stepped
        # different bars the fault is in the clock, and if they decided
        # differently on the same bars it is in the strategy's view of them.
        raise AssertionError(
            "two replays of the same day gave different fills.\n"
            f"  A fills: {fa}\n"
            f"  B fills: {fb}\n"
            f"  A decided: {_decisions(db, a)}\n"
            f"  B decided: {_decisions(db, b)}\n"
            f"  A bars: {_bars_seen(db, a)}\n"
            f"  B bars: {_bars_seen(db, b)}"
        )
    caught = db.scalars(select(LiveSessionEvent).where(LiveSessionEvent.session_id == a.id, LiveSessionEvent.kind == "INFO")).all()
    assert any(e.message.startswith("Catching up") for e in caught)


# --- risk --------------------------------------------------------------------------------


def test_the_loss_limit_squares_off_and_pauses(world):
    db = world["db"]
    world["record"]()
    s = replay(world, world["strategy"](lookback=6), quantity=100, capital=500000, loss_limit_pct=0.05)
    run(LiveRunner(feed=None), EVENING, EVENING + timedelta(minutes=40), step_seconds=30)
    s = reload(db, s)
    events = db.scalars(select(LiveSessionEvent).where(LiveSessionEvent.session_id == s.id, LiveSessionEvent.kind == "RISK")).all()
    breach = [e for e in events if e.data.get("check") == "loss_limit"]
    assert breach and breach[0].data["loss"] >= breach[0].data["limit"] == 250.0
    got = fills(db, s)
    assert got[-1]["reason"] == "Daily loss limit reached"
    assert s.status == "COMPLETED"  # paused, then the day ended
    assert s.position_qty == 0
    # Nothing was traded after the breach.
    assert all(f["filled_at"] <= breach[0].market_time for f in got)
    r = S.view(db, s)["risk"]
    assert r["loss_limit"] == 250.0 and r["loss"] >= 250.0 and r["loss_used"] >= 1


def test_positions_above_the_limits_are_refused_and_logged(world):
    db = world["db"]
    world["record"]()
    s = replay(world, world["strategy"](lookback=6), quantity=10, max_position_value=1000)
    run(LiveRunner(feed=None), EVENING, EVENING + timedelta(minutes=40), step_seconds=30)
    s = reload(db, s)
    assert fills(db, s) == []
    refused = db.scalars(select(LiveSessionEvent).where(LiveSessionEvent.session_id == s.id, LiveSessionEvent.kind == "RISK")).all()
    assert refused and all(e.data["check"] == "max_position_value" for e in refused)
    assert "above the maximum position value" in refused[0].message
    # More than the capital is refused too (no leverage).
    t = replay(world, world["strategy"](lookback=6), quantity=1000, capital=100000)
    run(LiveRunner(feed=None), EVENING, EVENING + timedelta(minutes=40), step_seconds=30)
    checks = {e.data["check"] for e in db.scalars(select(LiveSessionEvent).where(LiveSessionEvent.session_id == t.id, LiveSessionEvent.kind == "RISK"))}
    assert checks == {"capital"} and fills(db, t) == []


def test_the_order_rate_guard_counts_orders_per_bar(world):
    db = world["db"]
    world["record"]()
    s = replay(world, world["strategy"](lookback=6))
    s.max_orders_per_bar = 0
    db.commit()
    run(LiveRunner(feed=None), EVENING, EVENING + timedelta(minutes=40), step_seconds=30)
    s = reload(db, s)
    refused = db.scalars(select(LiveSessionEvent).where(LiveSessionEvent.session_id == s.id, LiveSessionEvent.kind == "RISK")).all()
    assert refused and {e.data["check"] for e in refused} == {"order_rate"}
    assert refused[0].message == "Refused: the order-rate limit is 0 order(s) per bar."
    assert fills(db, s) == []


def test_the_kill_switch_squares_off_now_or_at_1520(world):
    db = world["db"]
    world["record"]()
    strategy = world["strategy"](lookback=6)
    now_ = replay(world, strategy, quantity=10)
    later = replay(world, strategy, quantity=10)
    runner = LiveRunner(feed=None)
    # Run until both hold a position.
    at = EVENING
    while True:
        runner.tick(at.astimezone(timezone.utc))
        at += timedelta(seconds=30)
        if reload(db, now_).position_qty and reload(db, later).position_qty:
            break
    a, b = reload(db, now_), reload(db, later)
    held = a.position_qty * float(a.last_price) + b.position_qty * float(b.last_price)
    r = S.view(db, a, at.astimezone(timezone.utc))["risk"]
    assert r["position_value"] == pytest.approx(abs(a.position_qty) * float(a.last_price))
    assert r["position_limit"] == 500000 and r["position_used"] == pytest.approx(r["position_value"] / 500000, abs=1e-4)
    assert r["loss_limit"] is None and r["loss_used"] is None
    view = paper.account_view(db, db.get(PaperAccount, a.account_id))
    assert view["live_positions_value"] == pytest.approx(held, abs=0.01)
    assert view["equity"] == pytest.approx(float(view["account"].cash) + view["holdings_value"] + held, abs=0.01)
    S.request_stop(db, world["user"], now_.id, True)
    S.request_stop(db, world["user"], later.id, False)
    runner.tick(at.astimezone(timezone.utc))
    a, b = reload(db, now_), reload(db, later)
    assert a.status == "STOPPED" and a.position_qty == 0
    assert fills(db, a)[-1]["reason"] == "Stopped by you (square off now)"
    assert b.status == "STOPPED" and b.position_qty != 0
    assert b.status_reason == "Stopped by you; the open position is squared off at 15:20."
    count = len(fills(db, b))
    run(runner, at, EVENING + timedelta(minutes=40), step_seconds=30)
    b = reload(db, b)
    assert b.position_qty == 0 and len(fills(db, b)) == count + 1
    assert fills(db, b)[-1]["reason"] == "Auto square-off at 15:20 (intraday)"
    assert b.status == "STOPPED" and b.summary["final_position"] == 0
    assert b.summary["net_pnl"] == pytest.approx(float(b.realised_pnl) - float(b.charges))
    assert db.get(Execution, b.id).execution_metrics["live_session"]["summary"]["final_position"] == 0
    assert db.get(Execution, a.id).status == ExecutionStatus.CANCELLED
    with pytest.raises(S.LiveSessionError):
        S.request_stop(db, world["user"], a.id, True)


def test_pause_and_resume_a_replay_continue_where_it_was(world):
    db = world["db"]
    world["record"]()
    s = replay(world, world["strategy"](lookback=6), speed=1)
    runner = LiveRunner(feed=None)
    run(runner, EVENING, EVENING + timedelta(minutes=30), step_seconds=60)
    paused = S.pause(db, world["user"], s.id, now=(EVENING + timedelta(minutes=30)).astimezone(timezone.utc))
    assert paused.status == "PAUSED"
    before = S.view(db, paused, (EVENING + timedelta(hours=2)).astimezone(timezone.utc))
    resumed = S.resume(db, world["user"], s.id, now=(EVENING + timedelta(hours=2)).astimezone(timezone.utc))
    view = S.view(db, resumed, (EVENING + timedelta(hours=2)).astimezone(timezone.utc))
    assert view["clock"]["market_time"].astimezone(IST).strftime("%H:%M") == "09:45"
    assert before["status"] == "PAUSED"
    with pytest.raises(S.LiveSessionError):
        S.resume(db, world["user"], s.id)


# --- the stale guard (delayed mode) ----------------------------------------------------------


def test_missing_live_data_makes_the_session_stale_then_paused_and_never_invents_bars(world):
    db = world["db"]
    one = world["one"]
    world["record"](one[one.index < pd.Timestamp(session_open(DAY)).tz_convert("UTC")])  # yesterday only
    symbol = f"{world['instrument'].symbol}.NS"
    today = one[one.index >= pd.Timestamp(session_open(DAY)).tz_convert("UTC")]
    gap = today[(today.index < pd.Timestamp(ist(10, 0)).tz_convert("UTC")) | (today.index >= pd.Timestamp(ist(10, 20)).tz_convert("UTC"))]
    clock_now = {"at": ist(9, 45).astimezone(timezone.utc)}
    feed = RecordedFeed({symbol: gap}, now=lambda: clock_now["at"])
    s = S.create_session(
        db, world["user"], strategy_id=world["strategy"](lookback=6).id, instrument_id=world["instrument"].id,
        timeframe="1M", mode="DELAYED", replay_date=None, speed=1, capital=500000, quantity=10,
        slippage_bps=5, loss_limit_pct=None, max_position_value=None, now=clock_now["at"],
    )
    runner = LiveRunner(feed=feed)

    def go(until):
        while clock_now["at"] < until.astimezone(timezone.utc):
            clock_now["at"] += timedelta(seconds=30)
            runner.tick(clock_now["at"])

    go(ist(10, 16, 30))  # market 10:01:30: the 10:00 bar is due at 10:02
    assert reload(db, s).status == "RUNNING"
    go(ist(10, 17, 30))  # market 10:02:30: 10:00 is missing
    s = reload(db, s)
    assert s.status == "STALE" and s.status_reason == "No bar for 10:00 yet: no signals until the data is current."
    last = s.last_bar_at
    go(ist(10, 24))
    s = reload(db, s)
    assert s.status == "STALE" and s.last_bar_at == last  # no bar handed to the strategy
    go(ist(10, 27, 30))  # 10 minutes without data
    s = reload(db, s)
    assert s.status == "PAUSED" and "for 10 minutes" in s.status_reason
    assert not db.scalars(select(LiveBar).where(LiveBar.instrument_id == s.instrument_id, LiveBar.timestamp == pd.Timestamp(ist(10, 0)).to_pydatetime())).first()
    kinds = [e.message for e in db.scalars(select(LiveSessionEvent).where(LiveSessionEvent.session_id == s.id, LiveSessionEvent.kind == "DATA"))]
    assert kinds[0].startswith("No bar for 10:00") and "Paused" in kinds[-1]


def test_stale_data_recovers_when_the_bar_arrives(world):
    db = world["db"]
    one = world["one"]
    world["record"](one[one.index < pd.Timestamp(session_open(DAY)).tz_convert("UTC")])
    symbol = f"{world['instrument'].symbol}.NS"
    today = one[one.index >= pd.Timestamp(session_open(DAY)).tz_convert("UTC")]
    clock_now = {"at": ist(9, 45).astimezone(timezone.utc)}
    feed = RecordedFeed({symbol: today}, now=lambda: clock_now["at"])
    s = S.create_session(
        db, world["user"], strategy_id=world["strategy"](lookback=6).id, instrument_id=world["instrument"].id,
        timeframe="5M", mode="DELAYED", replay_date=None, speed=1, capital=500000, quantity=10,
        slippage_bps=5, loss_limit_pct=None, max_position_value=None, now=clock_now["at"],
    )
    runner = LiveRunner(feed=feed)
    feed.fail = [__import__("app.live.feed", fromlist=["FeedError"]).FeedError("HTTP 429 Too Many Requests", rate_limited=True)]
    clock_now["at"] = ist(9, 50).astimezone(timezone.utc)
    runner.tick(clock_now["at"])  # the poll fails: nothing stored for today yet
    s = reload(db, s)
    assert s.status == "STALE" and s.state["feed_error"] == "HTTP 429 Too Many Requests"
    for _ in range(6):
        clock_now["at"] += timedelta(seconds=30)
        runner.tick(clock_now["at"])
    s = reload(db, s)
    assert s.status == "RUNNING" and s.last_bar_at is not None
    assert not s.state.get("feed_error")


# --- money -------------------------------------------------------------------------------------


def test_intraday_charges_by_hand():
    buy = calculate_mis_charges(side="BUY", trade_value=Decimal("100000"), brokerage=Decimal("20"))
    # exchange 2.97, SEBI 0.10, stamp 3.00, GST 18% of (20 + 2.97 + 0.10) = 4.15
    assert buy == {"brokerage": 20.0, "stt": 0.0, "exchange": 2.97, "sebi": 0.1, "stamp_duty": 3.0, "gst": 4.15, "total": 30.22}
    sell = calculate_mis_charges(side="SELL", trade_value=Decimal("100000"), brokerage=Decimal("0"))
    # STT 0.025% = 25.00; no stamp duty; GST on 3.07 = 0.55
    assert sell == {"brokerage": 0.0, "stt": 25.0, "exchange": 2.97, "sebi": 0.1, "stamp_duty": 0.0, "gst": 0.55, "total": 28.62}


def test_positions_go_long_short_and_flip_with_realised_pnl():
    s = LiveSession(position_qty=0, average_price=None, realised_pnl=Decimal("0"))
    assert apply_fill(s, "SELL", 10, Decimal("100")) is None  # a short, intraday
    assert s.position_qty == -10 and s.average_price == Decimal("100")
    assert apply_fill(s, "BUY", 25, Decimal("90")) == Decimal("100.00")  # covers at a profit, then long 15
    assert s.position_qty == 15 and s.average_price == Decimal("90")
    assert apply_fill(s, "SELL", 15, Decimal("92")) == Decimal("30.00")
    assert s.position_qty == 0 and s.average_price is None and s.realised_pnl == Decimal("130.00")


# --- the API -----------------------------------------------------------------------------------


def test_the_api_runs_a_replay_and_only_the_owner_sees_it(world, monkeypatch):
    db = world["db"]
    world["record"]()
    strategy = world["strategy"](lookback=6)
    monkeypatch.setattr("app.api.live.routes._now", lambda: EVENING.astimezone(timezone.utc))
    body = {
        "strategy_id": str(strategy.id),
        "instrument_id": str(world["instrument"].id),
        "timeframe": "5M",
        "mode": "REPLAY",
        "replay_date": DAY.isoformat(),
        "speed": 10,
        "capital": 500000,
        "quantity": 10,
        "name": "  Morning replay  ",
    }
    created = client.post("/live/sessions", json=body)
    assert created.status_code == 201, created.text
    s = created.json()
    assert s["status"] == "RUNNING" and s["label"] == "Virtual money \u00b7 simulated orders"
    assert s["name"] == "Morning replay"
    assert s["clock"]["label"] == "Replay of 16 Oct 2026 \u00b7 10x" and s["loss_limit_pct"] == 2.0
    days = client.get("/live/replay-days", params={"instrument_id": str(world["instrument"].id)}).json()
    assert days[0]["day"] == "2026-10-16" and days[0]["bars"] == 375 and days[0]["replayable"]

    run(LiveRunner(feed=None), EVENING, EVENING + timedelta(minutes=12), step_seconds=30)
    monkeypatch.setattr("app.api.live.routes._now", lambda: (EVENING + timedelta(minutes=12)).astimezone(timezone.utc))
    detail = client.get(f"/live/sessions/{s['id']}").json()
    assert detail["clock"]["market_time"].startswith("2026-10-16T11:15")
    bars = client.get(f"/live/sessions/{s['id']}/bars").json()
    assert len(bars["bars"]) == 24  # 09:15 to 11:10, closed by 11:15
    events = client.get(f"/live/sessions/{s['id']}/events").json()
    assert [e["kind"] for e in events][0] == "STATUS"
    assert sum(1 for e in events if e["kind"] == "BAR") == 24
    got = client.get(f"/live/sessions/{s['id']}/fills").json()
    db.expire_all()
    mine = fills(db, db.get(LiveSession, UUID_(s["id"])))
    assert [(f["side"], f["quantity"], f["price"]) for f in got] == [(f["side"], f["quantity"], f["price"]) for f in mine]
    assert client.get("/live/sessions").json()[0]["id"] == s["id"]

    # The kill switch through the API, then the stream replays the log and ends.
    stopped = client.post(f"/live/sessions/{s['id']}/stop", json={"square_off": True})
    assert stopped.status_code == 200 and stopped.json()["stop_requested"] == "SQUARE_OFF"
    LiveRunner(feed=None).tick((EVENING + timedelta(minutes=12, seconds=1)).astimezone(timezone.utc))
    assert client.post(f"/live/sessions/{s['id']}/stop", json={}).status_code == 409
    with client.stream("GET", f"/live/sessions/{s['id']}/stream") as response:
        text = "".join(response.iter_text())
    kinds = [line.split(": ", 1)[1] for line in text.splitlines() if line.startswith("event: ")]
    assert kinds[0] == "status" and kinds[-1] == "end" and "bar" in kinds and "snapshot" in kinds
    ids = [int(line.split(": ", 1)[1]) for line in text.splitlines() if line.startswith("id: ")]
    assert ids == sorted(ids) and len(ids) == len(client.get(f"/live/sessions/{s['id']}/events").json())

    app.dependency_overrides[get_current_user] = lambda: world["other"]
    assert client.get(f"/live/sessions/{s['id']}").status_code == 404
    assert client.post(f"/live/sessions/{s['id']}/stop", json={}).status_code == 404
    assert client.get("/live/sessions").json() == []


def test_sessions_that_cannot_start_say_why(world, monkeypatch):
    world["record"]()
    momentum = world["strategy"](lookback=6)
    pairs = world["strategy"]("statistical_arbitrage")
    base = {"strategy_id": str(momentum.id), "instrument_id": str(world["instrument"].id), "capital": 500000, "quantity": 10}
    monkeypatch.setattr("app.api.live.routes._now", lambda: EVENING.astimezone(timezone.utc))
    closed = client.post("/live/sessions", json={**base, "mode": "DELAYED"})
    assert closed.status_code == 422 and "market is closed" in closed.json()["detail"]
    none = client.post("/live/sessions", json={**base, "mode": "REPLAY", "replay_date": "2026-10-14"})
    assert none.status_code == 422 and "No recorded 1-minute bars" in none.json()["detail"]
    rich = client.post("/live/sessions", json={**base, "mode": "REPLAY", "replay_date": DAY.isoformat(), "capital": 5e7})
    assert rich.status_code == 422 and "more than the paper account's available cash" in rich.json()["detail"]
    pair = client.post("/live/sessions", json={**base, "strategy_id": str(pairs.id), "mode": "REPLAY", "replay_date": DAY.isoformat()})
    assert pair.status_code == 422 and "one instrument" in pair.json()["detail"]
    for _ in range(3):
        assert client.post("/live/sessions", json={**base, "mode": "REPLAY", "replay_date": DAY.isoformat()}).status_code == 201
    fourth = client.post("/live/sessions", json={**base, "mode": "REPLAY", "replay_date": DAY.isoformat()})
    assert fourth.status_code == 422 and "At most 3" in fourth.json()["detail"]
    assert client.post("/live/stop-all").json() == {"stopping": 3}
    status = client.get("/live/status").json()
    assert status["delayed_day"] is None and status["delay_minutes"] == 15
    assert client.get("/live/charges").json()["product"] == "MIS (equity intraday)"
