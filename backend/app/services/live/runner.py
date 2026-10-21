"""The live session runner (Feature 7).

Each tick (about once a second) it advances every active session to its clock:

1. A stop request is handled first (square off now, or leave the position for
   the 15:20 square-off), then nothing else happens for the session.
2. Delayed sessions poll the live feed (one batched request, at most once a
   minute; the feed backs off after errors) and store new 1-minute bars.
3. Stale-data guard: if the 1-minute bar the clock has reached is missing 60
   seconds after it was due, the session is STALE and no bar is handed to the
   strategy until it arrives; after 10 minutes it is PAUSED. Nothing is invented.
4. Every newly closed bar (1, 5 or 15 minutes) goes to the strategy with the
   history before it - the backtest engine's own signal logic - and the signal
   becomes a target position (BUY +qty, SELL -qty, EXIT 0, HOLD unchanged).
   The difference is one MARKET MIS order filled at the bar close +/- slippage
   (app.services.live.trading). Risk checks: position value within the
   capital and the maximum position value, the order-rate guard, and the daily
   loss limit (square off and pause on a breach).
5. At 15:20 the position is squared off; at 15:30 the session completes.

Everything is in the database, so after a restart sessions continue from
their last processed bar (delayed sessions catch up in order). Every decision
is written to the session's audit log (live_session_events)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.enums import ExecutionStatus, NotificationPriority, NotificationType
from app.live import bars as B
from app.live.clock import (
    IST,
    MINUTE,
    DelayedClock,
    ReplayClock,
    SessionClock,
    session_close,
    session_open,
    square_off_time,
)
from app.live.feed import LiveFeed
from app.models import Execution, Instrument, LiveSession, Notification, PaperAccount
from app.services.executions.execution_service import ExecutionService
from app.services.live import recorder, store
from app.services.live.trading import equity, event, place
from app.strategies.context import StrategyContext
from app.strategies.factory import build_strategy
from app.strategies.signal import SignalAction

logger = logging.getLogger(__name__)

GRACE = timedelta(seconds=60)
STALE_PAUSE = timedelta(minutes=10)
POLL_EVERY = timedelta(seconds=60)
ACTIVE = ("RUNNING", "STALE")
OPEN_STATUSES = ("RUNNING", "STALE", "PAUSED")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def clock_for(s: LiveSession, now: datetime) -> SessionClock:
    if s.mode == "REPLAY":
        return ReplayClock(s.session_date, s.started_at, s.speed, lambda: now)
    return DelayedClock(s.session_date, s.delay_minutes, lambda: now)


def notify(db: Session, s: LiveSession, kind, priority, title: str, message: str) -> None:
    db.add(
        Notification(
            user_id=s.user_id,
            execution_id=s.execution_id,
            notification_type=kind,
            priority=priority,
            title=title[:150],
            message=message,
            is_read=False,
            notification_data={"event": "LIVE_SESSION", "session_id": str(s.id), "status": s.status},
        )
    )


def _hm(at: datetime) -> str:
    return at.astimezone(IST).strftime("%H:%M")


def _orders_at(db: Session, s: LiveSession, at: datetime) -> int:
    """Orders the session placed on the bar that closes at `at`."""
    from app.models import PaperOrder

    return db.scalar(
        select(func.count()).select_from(PaperOrder).where(PaperOrder.live_session_id == s.id, PaperOrder.filled_at == at)
    ) or 0


def summary(db: Session, s: LiveSession) -> dict:
    from app.models import PaperFill, PaperOrder

    fills = db.execute(
        select(PaperFill.realised_pnl).join(PaperOrder, PaperOrder.id == PaperFill.order_id).where(PaperOrder.live_session_id == s.id)
    ).all()
    closed = [float(r[0]) for r in fills if r[0] is not None]
    money = equity(s, float(s.last_price) if s.last_price is not None else None)
    return {
        **money,
        "fills": len(fills),
        "closed_trades": len(closed),
        "winning_trades": sum(1 for v in closed if v > 0),
        "win_rate": (sum(1 for v in closed if v > 0) / len(closed)) if closed else None,
        "final_position": s.position_qty,
    }


def _finish_execution(db: Session, s: LiveSession, target: ExecutionStatus, message: str | None = None) -> None:
    if s.execution_id is None:
        return
    execution = db.get(Execution, s.execution_id)
    if execution is None or execution.status in (ExecutionStatus.COMPLETED, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED):
        return
    execution.execution_metrics = {"live_session": {"id": str(s.id), "summary": s.summary}}
    service = ExecutionService(db)
    if target == ExecutionStatus.FAILED:
        service.fail_execution(execution=execution, error_message=message or "The live session failed.")
    elif target == ExecutionStatus.CANCELLED:
        service.cancel_execution(execution=execution)
    else:
        service.complete_execution(execution=execution)


class Context:
    """What one tick of one session works with."""

    def __init__(self, db: Session, s: LiveSession, now: datetime):
        self.db = db
        self.s = s
        self.now = now
        self.clock = clock_for(s, now)
        self.state = self.clock.state()
        self.mt = self.state.market_time
        self.day = s.session_date
        self.instrument = db.get(Instrument, s.instrument_id)
        self.account = db.scalar(select(PaperAccount).where(PaperAccount.id == s.account_id).with_for_update())
        self.one = store.load_1m(db, s.instrument_id, store.warmup_start(self.day), session_close(self.day))
        local = self.one.index.tz_convert(IST) if not self.one.empty else self.one.index
        self.today = self.one[(local >= session_open(self.day))] if not self.one.empty else self.one

    def latest_close(self) -> tuple[float | None, datetime | None]:
        """The newest complete 1-minute bar by market time."""
        if self.today.empty:
            return None, None
        local = self.today.index.tz_convert(IST)
        done = self.today[local + pd.Timedelta(minutes=1) <= self.mt]
        if done.empty:
            return None, None
        stamp = done.index[-1].to_pydatetime()
        return float(done["close"].iloc[-1]), stamp + MINUTE


def square_off(c: Context, reason: str, at: datetime | None = None, price: float | None = None) -> None:
    s = c.s
    if not s.position_qty:
        return
    if price is None:
        price, at = c.latest_close()
    if price is None:
        event(c.db, s, "RISK", f"Could not square off ({reason}): no price yet.", c.mt)
        return
    side = "SELL" if s.position_qty > 0 else "BUY"
    place(c.db, s, c.account, c.instrument, side, abs(s.position_qty), price, at or c.mt, reason)
    s.last_price = price
    s.last_price_at = at or c.mt


def finish(c: Context, status: str, reason: str) -> None:
    s = c.s
    s.status = status
    s.status_reason = reason
    s.completed_at = c.now
    s.summary = summary(c.db, s)
    event(c.db, s, "STATUS", reason, c.mt, status=status, summary=s.summary)
    target = {"COMPLETED": ExecutionStatus.COMPLETED, "STOPPED": ExecutionStatus.CANCELLED, "FAILED": ExecutionStatus.FAILED}[status]
    _finish_execution(c.db, s, target, reason)
    if status == "COMPLETED":
        net = s.summary["net_pnl"]
        notify(
            c.db,
            s,
            NotificationType.INFO,
            NotificationPriority.MEDIUM,
            "Live paper session completed",
            f'"{s.name}" on the paper account finished the day: net P&L Rs {net:,.2f} after charges (virtual money).',
        )


def handle_stop(c: Context) -> None:
    s = c.s
    now_square = s.stop_requested == "SQUARE_OFF"
    s.stop_requested = None
    if now_square:
        square_off(c, "Stopped by you (square off now)")
    reason = (
        "Stopped by you; the position was squared off."
        if now_square or not s.position_qty
        else "Stopped by you; the open position is squared off at 15:20."
    )
    finish(c, "STOPPED", reason)


def decide(c: Context, history: pd.DataFrame, bar_ts: pd.Timestamp) -> SignalAction:
    s = c.s
    strategy = build_strategy(s.strategy_key, s.rules if s.rules is not None else s.parameters)
    prepare = getattr(strategy, "prepare", None)
    if callable(prepare):
        prepare(history)
    context = StrategyContext(
        instrument=None,
        timestamp=bar_ts.to_pydatetime(),
        market_data={"data": history, "current_allocations": None, "position_quantity": s.position_qty},
    )
    return strategy.generate_signal(context).action


def step(c: Context, history: pd.DataFrame, bar_ts: pd.Timestamp) -> bool:
    """One closed bar. Returns False when the session must stop processing (paused)."""
    s, db = c.s, c.db
    row = history.iloc[-1]
    close = float(row["close"])
    end = B.bar_end(bar_ts.to_pydatetime(), s.timeframe)
    bar_data = {
        "bar": bar_ts.isoformat(),
        "open": float(row["open"]),
        "high": float(row["high"]),
        "low": float(row["low"]),
        "close": close,
        "volume": float(row["volume"]),
    }
    event(db, s, "BAR", f"{s.timeframe} bar {_hm(bar_ts.to_pydatetime())} closed at {close}", end, **bar_data)
    action = decide(c, history, bar_ts)
    current = s.position_qty
    target = {SignalAction.BUY: s.quantity, SignalAction.SELL: -s.quantity, SignalAction.EXIT: 0}.get(action, current)
    if action != SignalAction.HOLD:
        event(db, s, "SIGNAL", f"{action.value}: hold {target} (now {current})", end, bar=bar_ts.isoformat(), action=action.value, target=target, position=current)
    delta = target - current
    s.last_bar_at = bar_ts.to_pydatetime()
    s.last_price = close
    s.last_price_at = end
    if delta:
        value = Decimal(str(abs(target))) * Decimal(str(close))
        if value > Decimal(str(s.capital)):
            event(db, s, "RISK", f"Refused: holding {target} is worth Rs {value:,.2f}, more than the session capital (no leverage).", end, check="capital", bar=bar_ts.isoformat())
        elif s.max_position_value is not None and value > Decimal(str(s.max_position_value)):
            event(db, s, "RISK", f"Refused: holding {target} is worth Rs {value:,.2f}, above the maximum position value.", end, check="max_position_value", bar=bar_ts.isoformat())
        elif _orders_at(db, s, end) >= s.max_orders_per_bar:
            event(
                db,
                s,
                "RISK",
                f"Refused: the order-rate limit is {s.max_orders_per_bar} order(s) per bar.",
                end,
                check="order_rate",
                bar=bar_ts.isoformat(),
            )
        else:
            side = "BUY" if delta > 0 else "SELL"
            fill = place(db, s, c.account, c.instrument, side, abs(delta), close, end, f"signal {action.value}")
            if fill is not None:
                fill_event_bar = bar_ts.isoformat()
                s.state = {**(s.state or {}), "last_fill_bar": fill_event_bar}
    money = equity(s, close)
    event(db, s, "EQUITY", f"Equity Rs {money['equity']:,.2f}", end, **money, position=s.position_qty)
    if s.loss_limit_pct:
        loss = float(s.capital) - money["equity"]
        limit = float(s.capital) * s.loss_limit_pct / 100
        if loss >= limit:
            square_off(c, "Daily loss limit reached", end, close)
            s.status = "PAUSED"
            s.status_reason = f"Daily loss limit reached: lost Rs {loss:,.2f} of the Rs {limit:,.2f} allowed. Squared off and paused."
            event(db, s, "RISK", s.status_reason, end, check="loss_limit", loss=loss, limit=limit)
            notify(db, s, NotificationType.WARNING, NotificationPriority.HIGH, "Live session paused: loss limit", f'"{s.name}": {s.status_reason}')
            return False
    return True


def stale_guard(c: Context) -> bool:
    """True when the data is current enough to hand bars to the strategy."""
    s = c.s
    released = c.clock.released_minutes()
    due = [m for m in released if m + MINUTE + GRACE <= c.mt]
    if not due:
        return True
    latest = due[-1]
    have = set(c.today.index.tz_convert(IST).to_pydatetime()) if not c.today.empty else set()
    if latest in have:
        if s.status == "STALE":
            s.status = "RUNNING"
            s.status_reason = None
            event(c.db, s, "DATA", f"Data is current again (bar {_hm(latest)} arrived).", c.mt, stale=False)
            s.stale_since = None
        return True
    if s.status != "STALE":
        s.status = "STALE"
        s.stale_since = latest
        s.status_reason = f"No bar for {_hm(latest)} yet: no signals until the data is current."
        event(c.db, s, "DATA", s.status_reason, c.mt, stale=True, missing=latest.isoformat())
    elif c.mt - s.stale_since.astimezone(IST) >= STALE_PAUSE:
        s.status = "PAUSED"
        s.status_reason = f"Paused: no market data since {_hm(s.stale_since)} for 10 minutes. Resume when the data is back."
        event(c.db, s, "DATA", s.status_reason, c.mt, stale=True, paused=True)
        notify(c.db, s, NotificationType.WARNING, NotificationPriority.HIGH, "Live session paused: no data", f'"{s.name}": {s.status_reason}')
    return False


def process(db: Session, s: LiveSession, now: datetime) -> None:
    """One tick of one session (the caller commits)."""
    c = Context(db, s, now)
    if s.stop_requested and s.status in OPEN_STATUSES:
        handle_stop(c)
        return
    execution = db.get(Execution, s.execution_id) if s.execution_id else None
    if execution is not None and execution.status == ExecutionStatus.CANCELLED and s.status in OPEN_STATUSES:
        s.stop_requested = "SQUARE_OFF"
        handle_stop(c)
        return

    if s.status in ACTIVE and not s.squared_off and stale_guard(c):
        bars, _forming = B.history(c.one, s.timeframe, c.mt)
        if not bars.empty:
            local = bars.index.tz_convert(IST)
            today = bars[local >= session_open(c.day)]
            last = pd.Timestamp(s.last_bar_at) if s.last_bar_at is not None else None
            new = today[today.index > last] if last is not None else today
            if len(new) > 3:
                event(db, s, "INFO", f"Catching up {len(new)} closed bars.", c.mt, bars=len(new))
            for ts in new.index:
                if B.bar_end(ts.to_pydatetime(), s.timeframe) > square_off_time(c.day):
                    break
                history = bars[bars.index <= ts]
                if not step(c, history, ts):
                    break

    if c.mt >= square_off_time(c.day) and not s.squared_off and s.status in ("RUNNING", "STALE", "PAUSED", "STOPPED"):
        # The 15:19 bar's close is the 15:20 price; without it, the newest close.
        cutoff = square_off_time(c.day)
        local = c.today.index.tz_convert(IST) if not c.today.empty else c.today.index
        before = c.today[local < cutoff] if not c.today.empty else c.today
        if not before.empty:
            price = float(before["close"].iloc[-1])
            if s.position_qty:
                square_off(c, "Auto square-off at 15:20 (intraday)", cutoff, price)
            s.squared_off = True
            event(db, s, "INFO", "15:20: intraday positions squared off; no new orders today.", cutoff)
            if s.status == "STOPPED":
                s.summary = summary(db, s)
                if s.execution_id is not None:
                    execution = db.get(Execution, s.execution_id)
                    if execution is not None:
                        execution.execution_metrics = {"live_session": {"id": str(s.id), "summary": s.summary}}

    if c.state.finished and s.status in ("RUNNING", "STALE", "PAUSED"):
        if s.position_qty:
            square_off(c, "Session end")
        finish(c, "COMPLETED", "The session ended at 15:30.")


class LiveRunner:
    """Advances every active session; one shared feed for delayed sessions."""

    def __init__(self, feed: LiveFeed | None = None, session_factory=None, now=utcnow):
        from app.db import SessionLocal

        self.feed = feed
        self.session_factory = session_factory or SessionLocal
        self.now = now
        self.last_poll: datetime | None = None

    def _feed(self) -> LiveFeed:
        if self.feed is None:
            from app.live.feed import YahooFeed

            self.feed = YahooFeed()
        return self.feed

    def poll(self, db: Session, now: datetime) -> None:
        sessions = db.scalars(
            select(LiveSession).where(LiveSession.mode == "DELAYED", LiveSession.status.in_(ACTIVE))
        ).all()
        if not sessions:
            return
        if self.last_poll is not None and now - self.last_poll < POLL_EVERY:
            return
        self.last_poll = now
        by_day: dict = {}
        for s in sessions:
            by_day.setdefault(s.session_date, []).append(s.instrument_id)
        for day, ids in by_day.items():
            out = recorder.poll(db, self._feed(), ids, day)
            if out.get("error"):
                for s in sessions:
                    if s.session_date == day and (s.state or {}).get("feed_error") != out["error"]:
                        s.state = {**(s.state or {}), "feed_error": out["error"]}
                        event(db, s, "DATA", f"Live feed: {out['error']}", None, rate_limited=out.get("rate_limited", False))
            else:
                for s in sessions:
                    if (s.state or {}).get("feed_error"):
                        s.state = {**(s.state or {}), "feed_error": None}
        db.commit()

    def tick(self, now: datetime | None = None) -> int:
        now = now or self.now()
        db = self.session_factory()
        processed = 0
        try:
            try:
                self.poll(db, now)
            except Exception:
                db.rollback()
                logger.exception("Live feed poll failed.")
            ids = db.scalars(
                select(LiveSession.id).where(
                    (LiveSession.status.in_(OPEN_STATUSES))
                    | ((LiveSession.status == "STOPPED") & (LiveSession.position_qty != 0))
                )
            ).all()
            for session_id in ids:
                try:
                    s = db.scalar(select(LiveSession).where(LiveSession.id == session_id).with_for_update())
                    if s is None:
                        continue
                    process(db, s, now)
                    db.commit()
                    processed += 1
                except Exception as exc:
                    db.rollback()
                    logger.exception("Live session %s failed.", session_id)
                    self._fail(db, session_id, exc, now)
        finally:
            db.close()
        return processed

    def _fail(self, db: Session, session_id: UUID, exc: Exception, now: datetime) -> None:
        try:
            s = db.get(LiveSession, session_id)
            if s is None:
                return
            c = Context(db, s, now)
            finish(c, "FAILED", f"The session stopped on an error: {str(exc) or type(exc).__name__}"[:300])
            notify(db, s, NotificationType.ERROR, NotificationPriority.HIGH, "Live session failed", f'"{s.name}": {s.status_reason}')
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Could not store the failure of live session %s.", session_id)


_runner: LiveRunner | None = None


def runner() -> LiveRunner:
    global _runner
    if _runner is None:
        _runner = LiveRunner()
    return _runner
