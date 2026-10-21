"""NSE market hours for paper trading (IST). Regular session 09:15-15:30 on
NSE trading days (the holiday calendar from Phase 6)."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.data.calendars.nse import NSEMarketCalendar

IST = ZoneInfo("Asia/Kolkata")
OPEN_TIME = time(9, 15)
CLOSE_TIME = time(15, 30)
_calendar = NSEMarketCalendar()


def now_utc() -> datetime:
    """The current time; tests replace this function."""
    return datetime.now(timezone.utc)


def to_ist(value: datetime) -> datetime:
    return value.astimezone(IST)


def is_trading_day(day: date) -> bool:
    return _calendar.is_trading_day(day)


def trading_days(start: date, end: date) -> list[date]:
    return _calendar.trading_days(start, end)


def next_trading_day(day: date) -> date:
    current = day + timedelta(days=1)
    while not is_trading_day(current):
        current += timedelta(days=1)
    return current


def session_open(day: date) -> datetime:
    return datetime.combine(day, OPEN_TIME, tzinfo=IST)


def session_close(day: date) -> datetime:
    return datetime.combine(day, CLOSE_TIME, tzinfo=IST)


def is_market_open(at: datetime) -> bool:
    local = to_ist(at)
    return is_trading_day(local.date()) and OPEN_TIME <= local.time() < CLOSE_TIME


def order_session(at: datetime) -> tuple[date, bool]:
    """The session an order placed at `at` is valid for, and whether it is an
    after-market order (placed while the market is closed)."""
    local = to_ist(at)
    today = local.date()
    if is_trading_day(today) and local.time() < CLOSE_TIME:
        return today, local.time() < OPEN_TIME
    return next_trading_day(today), True


def market_status(at: datetime) -> dict:
    local = to_ist(at)
    open_now = is_market_open(at)
    today = local.date()
    if open_now:
        next_open = None
    elif is_trading_day(today) and local.time() < OPEN_TIME:
        next_open = session_open(today)
    else:
        next_open = session_open(next_trading_day(today))
    return {
        "is_open": open_now,
        "now": local.isoformat(),
        "session": "09:15-15:30 IST",
        "closes_at": session_close(today).isoformat() if open_now else None,
        "next_open": next_open.isoformat() if next_open else None,
    }
