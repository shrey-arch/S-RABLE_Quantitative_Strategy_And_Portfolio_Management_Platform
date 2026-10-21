"""Session clocks for live paper trading (Feature 7).

A clock says what market time a session is at. Bars are released by market
time: the 1-minute bar starting at m is complete once the clock reaches m + 1 min.

- DelayedClock: market time = now - delay (15 minutes by default), so every bar
  is already published by Yahoo when the session reaches it. Bars arrive one per
  minute, like a live platform, just behind the market - and the screen says so.
- ReplayClock: a recorded trading day from 09:15, at 1x, 5x or 10x speed.

Both run only inside the NSE session (09:15-15:30 IST) on trading days."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from app.services.paper import clock as nse

IST = nse.IST
OPEN = time(9, 15)
CLOSE = time(15, 30)
SQUARE_OFF = time(15, 20)
MINUTE = timedelta(minutes=1)
SESSION_MINUTES = 375  # 09:15 to 15:30
SPEEDS = (1, 5, 10)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def session_open(day: date) -> datetime:
    return datetime.combine(day, OPEN, tzinfo=IST)


def session_close(day: date) -> datetime:
    return datetime.combine(day, CLOSE, tzinfo=IST)


def square_off_time(day: date) -> datetime:
    return datetime.combine(day, SQUARE_OFF, tzinfo=IST)


def minute_floor(at: datetime) -> datetime:
    return at.replace(second=0, microsecond=0)


def session_minutes(day: date) -> list[datetime]:
    """The start of every 1-minute bar of the day's session (IST)."""
    start = session_open(day)
    return [start + i * MINUTE for i in range(SESSION_MINUTES)]


@dataclass
class ClockState:
    market_time: datetime  # where the session is (IST)
    day: date
    open: bool  # inside 09:15-15:30 of a trading day
    finished: bool  # at or after 15:30 of the session day


class SessionClock:
    """Base: subclasses define market_time(); everything else follows from it."""

    day: date

    def market_time(self) -> datetime:  # pragma: no cover - abstract
        raise NotImplementedError

    def state(self) -> ClockState:
        at = self.market_time()
        trading = nse.is_trading_day(self.day)
        return ClockState(
            market_time=at,
            day=self.day,
            open=trading and session_open(self.day) <= at < session_close(self.day),
            finished=at >= session_close(self.day),
        )

    def released_minutes(self) -> list[datetime]:
        """The 1-minute bars of the session that are complete by market time."""
        at = self.market_time()
        return [m for m in session_minutes(self.day) if m + MINUTE <= at]

    def label(self) -> str:  # pragma: no cover - abstract
        raise NotImplementedError


class DelayedClock(SessionClock):
    def __init__(self, day: date, delay_minutes: int = 15, now: Callable[[], datetime] = utcnow):
        self.day = day
        self.delay = timedelta(minutes=delay_minutes)
        self.now = now

    def market_time(self) -> datetime:
        return (self.now() - self.delay).astimezone(IST)

    def label(self) -> str:
        return f"Market time {self.market_time():%H:%M} \u00b7 {int(self.delay.total_seconds() // 60)} min behind live"


class ReplayClock(SessionClock):
    def __init__(
        self,
        day: date,
        started_at: datetime,
        speed: int = 1,
        now: Callable[[], datetime] = utcnow,
    ):
        if speed not in SPEEDS:
            raise ValueError("speed must be 1, 5 or 10.")
        self.day = day
        self.started_at = started_at
        self.speed = speed
        self.now = now

    def market_time(self) -> datetime:
        elapsed = (self.now() - self.started_at) * self.speed
        at = session_open(self.day) + max(elapsed, timedelta(0))
        return min(at, session_close(self.day))

    def label(self) -> str:
        return f"Replay of {self.day:%d %b %Y} \u00b7 {self.speed}x"


def delayed_session_day(now: datetime, delay_minutes: int = 15) -> date | None:
    """The trading day a delayed session started now would run on: today, while
    the delayed clock is inside today's session. None when it would not trade."""
    at = (now - timedelta(minutes=delay_minutes)).astimezone(IST)
    day = at.date()
    if not nse.is_trading_day(day):
        return None
    if not (session_open(day) <= at < session_close(day)):
        return None
    return day
