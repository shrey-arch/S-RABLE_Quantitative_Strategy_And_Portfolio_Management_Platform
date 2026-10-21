"""Creating, controlling and reading live paper sessions (Feature 7).

A session is also an Execution of type LIVE (mode paper) with the same id, so it
appears in the run history and its finish is notified like any run."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.enums import ExecutionStatus, ExecutionType, NotificationPriority, NotificationType, StrategyType
from app.live import bars as B
from app.live.clock import IST, delayed_session_day, session_close, session_open
from app.models import Instrument, LiveSession, LiveSessionEvent, PaperFill, PaperOrder, Strategy, User
from app.services.executions.execution_service import ExecutionService
from app.services.live import store
from app.services.live.runner import ACTIVE, OPEN_STATUSES, clock_for, notify
from app.services.live.trading import equity, event
from app.services.paper import service as paper
from app.services.paper.quotes import QuoteUnavailable, yahoo_symbol
from app.strategies.factory import RULES_KEY, build_strategy, instrument_layout
from app.strategies.registry import StrategyRegistry

MAX_ACTIVE = 3
LABEL = "Virtual money \u00b7 simulated orders"


class LiveSessionError(Exception):
    pass


def _template_key(strategy: Strategy) -> str | None:
    config = strategy.strategy_config if isinstance(strategy.strategy_config, dict) else {}
    parameters = config.get("parameters") if isinstance(config.get("parameters"), dict) else {}
    key = parameters.get("template")
    return key if isinstance(key, str) and key else None


def resolve(strategy: Strategy) -> tuple[str, dict, dict | None]:
    """The strategy's template key and parameters (or its no-code rules)."""
    if not strategy.is_active:
        raise LiveSessionError("This strategy is inactive. Turn it on to run it live.")
    key = _template_key(strategy)
    if key is None and strategy.strategy_type == StrategyType.NO_CODE:
        rules = strategy.strategy_config if isinstance(strategy.strategy_config, dict) else {}
        build_strategy(RULES_KEY, rules)
        return RULES_KEY, {}, rules
    if key is None or key not in StrategyRegistry.available():
        raise LiveSessionError(
            "Only strategies made from a core template or built without code can run live. "
            "Custom Python code can be backtested, validated and test-run, but a live "
            "session does not use the sandbox yet."
        )
    if instrument_layout(key) != "single":
        raise LiveSessionError(
            "Live sessions trade one instrument; this strategy needs several (pairs or rotation)."
        )
    config = strategy.strategy_config.get("parameters") or {}
    parameters = {k: v for k, v in config.items() if k != "template"}
    build_strategy(key, parameters)
    return key, parameters, None


def create_session(
    db: Session,
    user: User,
    *,
    strategy_id: UUID,
    instrument_id: UUID,
    timeframe: str,
    mode: str,
    replay_date: date | None,
    speed: int,
    capital,
    quantity: int,
    slippage_bps: float,
    loss_limit_pct: float | None,
    max_position_value,
    now: datetime | None = None,
    name: str | None = None,
) -> LiveSession:
    now = now or datetime.now(timezone.utc)
    strategy = db.scalar(select(Strategy).where(Strategy.id == strategy_id, Strategy.user_id == user.id))
    if strategy is None:
        raise LookupError("Strategy not found.")
    key, parameters, rules = resolve(strategy)
    instrument = db.get(Instrument, instrument_id)
    if instrument is None:
        raise LiveSessionError("The instrument does not exist.")
    try:
        yahoo_symbol(instrument)
    except QuoteUnavailable as exc:
        raise LiveSessionError(str(exc)) from exc
    active = db.scalar(
        select(func.count()).select_from(LiveSession).where(LiveSession.user_id == user.id, LiveSession.status.in_(OPEN_STATUSES))
    )
    if active >= MAX_ACTIVE:
        raise LiveSessionError(f"At most {MAX_ACTIVE} live sessions can run at once. Stop one first.")
    if mode == "DELAYED":
        day = delayed_session_day(now)
        if day is None:
            raise LiveSessionError(
                "The market is closed for a delayed live session (it runs 15 minutes behind NSE "
                "hours, 09:30-15:45 IST on trading days). Use Replay of a recorded day."
            )
    else:
        if replay_date is None:
            raise LiveSessionError("Choose the day to replay.")
        days = {d["day"]: d for d in store.replay_days(db, instrument.id)}
        found = days.get(replay_date.isoformat())
        if found is None or not found["replayable"]:
            raise LiveSessionError(
                f"No recorded 1-minute bars of {instrument.symbol} for {replay_date:%d %b %Y}"
                + (f" (only {found['bars']} of 375)." if found else ".")
                + " Days are recorded while a delayed live session runs."
            )
        day = replay_date
    account = paper.get_account(db, user, lock=True)
    available = paper._d(account.cash) - paper.blocked_cash(db, account)
    capital = paper._money(capital)
    if capital > available:
        raise LiveSessionError(
            f"The capital ({paper.inr(capital)}) is more than the paper account's available cash ({paper.inr(available)})."
        )
    execution_service = ExecutionService(db)
    execution = execution_service.create_execution(
        strategy_id=strategy.id,
        broker_account_id=None,
        instrument_id=instrument.id,
        execution_type=ExecutionType.LIVE,
        status=ExecutionStatus.PENDING,
        timeframe=timeframe,
        initial_capital=float(capital),
        execution_config=parameters,
        run_settings={
            "mode": "paper",
            "session_mode": mode,
            "strategy_key": key,
            "strategy_version": strategy.version,
            "rules": rules,
            "session_date": day.isoformat(),
            "quantity": quantity,
            "slippage_bps": slippage_bps,
        },
    )
    s = LiveSession(
        id=execution.id,
        user_id=user.id,
        account_id=account.id,
        execution_id=execution.id,
        strategy_id=strategy.id,
        name=(name or "").strip()[:150] or strategy.name,
        strategy_key=key,
        strategy_version=strategy.version,
        parameters=parameters,
        rules=rules,
        instrument_id=instrument.id,
        timeframe=timeframe,
        mode=mode,
        session_date=day,
        speed=speed if mode == "REPLAY" else 1,
        delay_minutes=15,
        started_at=now,
        capital=capital,
        quantity=quantity,
        slippage_bps=slippage_bps,
        loss_limit_pct=loss_limit_pct,
        max_position_value=max_position_value,
        max_orders_per_bar=2,
        status="RUNNING",
        state={},
    )
    db.add(s)
    db.flush()
    execution_service.start_execution(execution=execution)
    clock = clock_for(s, now)
    event(
        db,
        s,
        "STATUS",
        f"Started: {strategy.name} on {instrument.symbol}, {timeframe} bars, {clock.label()}. {LABEL}.",
        clock.market_time(),
        status="RUNNING",
    )
    notify(
        db,
        s,
        NotificationType.INFO,
        NotificationPriority.LOW,
        "Live paper session started",
        f'"{strategy.name}" on {instrument.symbol} ({timeframe}): '
        + ("15 minutes behind live." if mode == "DELAYED" else f"replay of {day:%d %b %Y} at {s.speed}x.")
        + " Virtual money, simulated orders.",
    )
    db.commit()
    db.refresh(s)
    return s


def owned(db: Session, user: User, session_id: UUID, *, lock: bool = False) -> LiveSession:
    statement = select(LiveSession).where(LiveSession.id == session_id, LiveSession.user_id == user.id)
    if lock:
        statement = statement.with_for_update()
    s = db.scalar(statement)
    if s is None:
        raise LookupError("Live session not found.")
    return s


def request_stop(db: Session, user: User, session_id: UUID, square_off: bool) -> LiveSession:
    s = owned(db, user, session_id, lock=True)
    if s.status not in OPEN_STATUSES:
        raise LiveSessionError(f"The session is already {s.status.lower()}.")
    s.stop_requested = "SQUARE_OFF" if square_off else "STOP"
    event(db, s, "STOP", "Stop requested" + (" (square off now)." if square_off else " (square off at 15:20)."), None, square_off=square_off)
    db.commit()
    db.refresh(s)
    return s


def stop_all(db: Session, user: User) -> int:
    rows = db.scalars(
        select(LiveSession).where(LiveSession.user_id == user.id, LiveSession.status.in_(OPEN_STATUSES)).with_for_update()
    ).all()
    for s in rows:
        s.stop_requested = "SQUARE_OFF"
        event(db, s, "STOP", "Stop all: square off now.", None, square_off=True)
    db.commit()
    return len(rows)


def pause(db: Session, user: User, session_id: UUID, now: datetime | None = None) -> LiveSession:
    now = now or datetime.now(timezone.utc)
    s = owned(db, user, session_id, lock=True)
    if s.status not in ACTIVE:
        raise LiveSessionError(f"Only a running session can be paused (it is {s.status.lower()}).")
    s.status = "PAUSED"
    s.status_reason = "Paused by you: no new orders until you resume."
    s.state = {**(s.state or {}), "paused_market_time": clock_for(s, now).market_time().isoformat()}
    event(db, s, "STATUS", s.status_reason, clock_for(s, now).market_time(), status="PAUSED")
    db.commit()
    db.refresh(s)
    return s


def resume(db: Session, user: User, session_id: UUID, now: datetime | None = None) -> LiveSession:
    """A replay continues where it was paused. A delayed session continues at the
    current market time; the bars closed while it was paused are not traded."""
    now = now or datetime.now(timezone.utc)
    s = owned(db, user, session_id, lock=True)
    if s.status != "PAUSED":
        raise LiveSessionError(f"Only a paused session can be resumed (it is {s.status.lower()}).")
    if s.squared_off:
        raise LiveSessionError("After 15:20 a session places no new orders; it ends at 15:30.")
    state = dict(s.state or {})
    paused_at = state.pop("paused_market_time", None)
    if s.mode == "REPLAY" and paused_at:
        at = datetime.fromisoformat(paused_at)
        s.started_at = now - (at - session_open(s.session_date)) / s.speed
        message = "Resumed: the replay continues where it was paused."
    else:
        mt = clock_for(s, now).market_time()
        one = store.load_1m(db, s.instrument_id, store.warmup_start(s.session_date), session_close(s.session_date))
        closed, _ = B.history(one, s.timeframe, mt)
        today = closed[closed.index.tz_convert(IST) >= session_open(s.session_date)] if not closed.empty else closed
        if not today.empty:
            s.last_bar_at = today.index[-1].to_pydatetime()
        message = "Resumed: bars that closed while paused were not traded."
    s.state = state
    s.status = "RUNNING"
    s.status_reason = None
    s.stale_since = None
    event(db, s, "STATUS", message, clock_for(s, now).market_time(), status="RUNNING")
    db.commit()
    db.refresh(s)
    return s


# --- reading ----------------------------------------------------------------------------


def risk(s: LiveSession, money: dict) -> dict:
    """The risk meter: loss so far against the daily limit, and the position's
    value against the maximum (and the capital: no leverage)."""
    capital = float(s.capital)
    loss = round(max(0.0, capital - money["equity"]), 2)
    limit = round(capital * s.loss_limit_pct / 100, 2) if s.loss_limit_pct else None
    value = money["position_value"] if s.position_qty else 0.0
    cap = float(s.max_position_value) if s.max_position_value is not None else capital
    return {
        "loss": loss,
        "loss_limit": limit,
        "loss_used": round(loss / limit, 4) if limit else None,
        "position_value": value,
        "position_limit": cap,
        "position_used": round(value / cap, 4) if value is not None and cap else None,
    }


def view(db: Session, s: LiveSession, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    clock = clock_for(s, now)
    instrument = db.get(Instrument, s.instrument_id)
    price = float(s.last_price) if s.last_price is not None else None
    data_age = None
    if s.last_price_at is not None and s.status in ACTIVE:
        data_age = max(0, int((clock.market_time() - s.last_price_at.astimezone(IST)).total_seconds()))
    return {
        "id": s.id,
        "name": s.name,
        "strategy_id": s.strategy_id,
        "strategy_key": s.strategy_key,
        "strategy_version": s.strategy_version,
        "parameters": s.parameters,
        "rules": s.rules,
        "instrument_id": s.instrument_id,
        "symbol": instrument.symbol if instrument else None,
        "tick_size": float(instrument.tick_size) if instrument else None,
        "timeframe": s.timeframe,
        "mode": s.mode,
        "session_date": s.session_date,
        "speed": s.speed,
        "delay_minutes": s.delay_minutes,
        "clock": {
            "market_time": clock.market_time(),
            "label": clock.label(),
            "open": clock.state().open,
            "finished": clock.state().finished,
        },
        "status": s.status,
        "status_reason": s.status_reason,
        "stop_requested": s.stop_requested,
        "capital": float(s.capital),
        "quantity": s.quantity,
        "slippage_bps": s.slippage_bps,
        "loss_limit_pct": s.loss_limit_pct,
        "max_position_value": float(s.max_position_value) if s.max_position_value is not None else None,
        "max_orders_per_bar": s.max_orders_per_bar,
        "position_qty": s.position_qty,
        "average_price": float(s.average_price) if s.average_price is not None else None,
        "last_price": price,
        "last_price_at": s.last_price_at,
        "last_bar_at": s.last_bar_at,
        "data_age_seconds": data_age,
        "squared_off": s.squared_off,
        "money": (money := equity(s, price)),
        "risk": risk(s, money),
        "order_count": s.order_count,
        "summary": s.summary,
        "label": LABEL,
        "execution_id": s.execution_id,
        "started_at": s.started_at,
        "completed_at": s.completed_at,
        "created_at": s.created_at,
    }


def bars_view(db: Session, s: LiveSession, now: datetime | None = None) -> dict:
    """The session day's closed bars by its clock, the forming one, and the fills."""
    now = now or datetime.now(timezone.utc)
    mt = clock_for(s, now).market_time()
    one = store.load_1m(db, s.instrument_id, session_open(s.session_date), session_close(s.session_date))
    closed, forming = B.aggregate(one, s.timeframe, s.session_date, mt) if not one.empty else (B.frame([]), None)
    return {
        "market_time": mt,
        "timeframe": s.timeframe,
        "bars": [
            {"time": t.to_pydatetime(), **{k: float(v) for k, v in row.items()}}
            for t, row in closed.to_dict("index").items()
        ],
        "forming": (
            {**{k: v for k, v in forming.items() if k != "timestamp"}, "time": forming["timestamp"].to_pydatetime()}
            if forming
            else None
        ),
    }


def events_view(db: Session, s: LiveSession, after: int = 0, limit: int = 500) -> list[LiveSessionEvent]:
    return db.scalars(
        select(LiveSessionEvent)
        .where(LiveSessionEvent.session_id == s.id, LiveSessionEvent.id > after)
        .order_by(LiveSessionEvent.id)
        .limit(limit)
    ).all()


def fills_view(db: Session, s: LiveSession) -> list[dict]:
    rows = db.execute(
        select(PaperFill, PaperOrder.note)
        .join(PaperOrder, PaperOrder.id == PaperFill.order_id)
        .where(PaperOrder.live_session_id == s.id)
        # id last, so the order never changes between two reads. Two fills can
        # share an instant - the bar's own signal and the 15:20 square-off are
        # both stamped 15:20, and created_at is the transaction's clock, so it
        # matches too. Without a unique tie-break the database may hand them back
        # either way round, and a list that reshuffles between page loads is a
        # fault even when every row in it is right.
        .order_by(PaperFill.filled_at, PaperFill.created_at, PaperFill.id)
    ).all()
    return [
        {
            "id": f.id,
            "order_id": f.order_id,
            "side": f.side,
            "quantity": f.quantity,
            "price": float(f.price),
            "bar_close": float(f.quote_price),
            "trade_value": float(f.trade_value),
            "charges": f.charges,
            "total_charges": float(f.total_charges),
            "net_amount": float(f.net_amount),
            "realised_pnl": float(f.realised_pnl) if f.realised_pnl is not None else None,
            "filled_at": f.filled_at,
            "reason": note,
        }
        for f, note in rows
    ]


def live_positions_value(db: Session, account_id: UUID) -> float:
    """Open intraday positions of the account's live sessions at their last price
    (a short is negative: it is owed back)."""
    rows = db.execute(
        select(LiveSession.position_qty, LiveSession.last_price).where(
            LiveSession.account_id == account_id, LiveSession.position_qty != 0
        )
    ).all()
    return float(sum(q * float(p) for q, p in rows if p is not None))
