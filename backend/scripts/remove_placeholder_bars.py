"""
Finds stored daily bars that are zero-volume placeholders on days NSE was closed
(the importer now skips these) and, with --apply, deletes them.

Run from the backend folder:
  python -m scripts.remove_placeholder_bars           # list only, changes nothing
  python -m scripts.remove_placeholder_bars --apply   # delete the listed rows
"""

import sys

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.enums import Timeframe
from app.models import Instrument, MarketData
from app.services.market_data.coverage import trading_date
from app.services.market_data.importer import is_closed_day_placeholder


def main(apply: bool) -> None:
    with SessionLocal() as db:
        rows = db.execute(
            select(MarketData.id, MarketData.timestamp, MarketData.volume, Instrument.symbol)
            .join(Instrument, Instrument.id == MarketData.instrument_id)
            .where(MarketData.timeframe == Timeframe.ONE_DAY, MarketData.volume == 0)
        ).all()
        found = [row for row in rows if is_closed_day_placeholder(row)]

        for row in found:
            day = trading_date(row.timestamp)
            print(f"  {row.symbol}: {day} {day:%a}, volume 0")
        print(f"{len(found)} placeholder bar(s) found.")

        if not found:
            return
        if not apply:
            print("Nothing deleted. Run again with --apply to delete them.")
            return

        db.execute(delete(MarketData).where(MarketData.id.in_([row.id for row in found])))
        db.commit()
        print(f"Deleted {len(found)} row(s).")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv[1:])
