"""
Compares the NSE holiday calendar with the daily bars stored in the database.

Run from the backend folder:  python -m scripts.check_nse_calendar
Nothing is changed; it only reads market_data and prints what disagrees.
"""

from sqlalchemy import select

from app.db import SessionLocal
from app.enums import Timeframe
from app.models import MarketData
from app.services.market_data.calendar_audit import audit_calendar


def main() -> None:
    with SessionLocal() as db:
        rows = db.execute(
            select(MarketData.instrument_id, MarketData.timestamp, MarketData.volume).where(
                MarketData.timeframe == Timeframe.ONE_DAY
            )
        ).all()

    audit = audit_calendar(rows)
    print(f"Instruments with daily data: {audit.instruments}")
    print(f"Trading days checked (2+ instruments with data around them): {audit.days_checked}")

    print("\nClosed days that have bars (holiday or weekend; not a special session):")
    for item in audit.closed_days_with_bars:
        print(
            f"  {item.day} {item.day:%a}: {item.instruments} bar(s),"
            f" {item.zero_volume_bars} with zero volume"
        )
    if not audit.closed_days_with_bars:
        print("  none")

    print("\nTrading days with no bar for any instrument (possible missing holiday):")
    for day in audit.trading_days_without_bars:
        print(f"  {day} {day:%a}")
    if not audit.trading_days_without_bars:
        print("  none")

    print("\nSpecial sessions that have bars (expected; shown for information):")
    print("  " + (", ".join(str(d) for d in audit.special_sessions_with_bars) or "none"))


if __name__ == "__main__":
    main()
