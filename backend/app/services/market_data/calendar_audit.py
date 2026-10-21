"""
Cross-checks the NSE calendar against stored daily bars.

Two kinds of disagreement are reported:
  * a closed day (holiday or weekend, not a special session) that has bars, and
  * a trading day on which no instrument has a bar although several instruments
    have data around it, which usually means a holiday is missing from the calendar.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from uuid import UUID

from app.data.calendars import NSEMarketCalendar
from app.services.market_data.coverage import trading_date


@dataclass
class ClosedDayWithBars:
    day: date
    instruments: int
    zero_volume_bars: int


@dataclass
class CalendarAudit:
    instruments: int
    days_checked: int
    closed_days_with_bars: list[ClosedDayWithBars] = field(default_factory=list)
    trading_days_without_bars: list[date] = field(default_factory=list)
    special_sessions_with_bars: list[date] = field(default_factory=list)


def audit_calendar(
    rows,
    *,
    calendar: NSEMarketCalendar | None = None,
    min_instruments: int = 2,
) -> CalendarAudit:
    """
    `rows` are daily bars with `instrument_id`, `timestamp` and `volume`.
    Only years whose holidays the calendar knows are checked. A trading day counts
    as "without bars" only when at least `min_instruments` instruments have data
    both before and after it, and none of them has a bar that day.
    """
    calendar = calendar or NSEMarketCalendar()
    known = calendar.known_holiday_years
    bars_by_day: dict[date, list[int]] = defaultdict(list)
    span: dict[UUID, list[date]] = {}

    for row in rows:
        day = trading_date(row.timestamp)
        bars_by_day[day].append(row.volume)
        first_last = span.setdefault(row.instrument_id, [day, day])
        first_last[0] = min(first_last[0], day)
        first_last[1] = max(first_last[1], day)

    audit = CalendarAudit(instruments=len(span), days_checked=0)
    if not span:
        return audit

    for day, volumes in sorted(bars_by_day.items()):
        if day.year not in known or calendar.is_trading_day(day):
            continue
        if calendar.is_special_session(day):
            audit.special_sessions_with_bars.append(day)
        else:
            audit.closed_days_with_bars.append(
                ClosedDayWithBars(day, len(volumes), sum(1 for v in volumes if v == 0))
            )

    start = min(first for first, _ in span.values())
    end = max(last for _, last in span.values())
    for day in calendar.trading_days(start, end):
        if day.year not in known:
            continue
        covering = sum(1 for first, last in span.values() if first < day < last)
        if covering < min_instruments:
            continue
        audit.days_checked += 1
        if day not in bars_by_day:
            audit.trading_days_without_bars.append(day)

    return audit
