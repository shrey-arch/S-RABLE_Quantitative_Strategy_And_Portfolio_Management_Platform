"""Background work for paper trading, inside the FastAPI process.

- Every 60 seconds during NSE market hours (and once just after the close, to
  expire day orders) it matches every account's open orders against the
  latest quotes. Pages also match the user's own orders when they load.
- Once a session's close has settled (about 16:00 IST) it runs the daily job
  for strategy deployments and account snapshots (P2/P3). The job is safe to
  repeat; `python -m scripts.run_paper_daily` runs the same job without the
  server (for Windows Task Scheduler)."""

import asyncio
import logging

from starlette.concurrency import run_in_threadpool

from app.db import SessionLocal
from app.services.paper import clock
from app.services.paper.service import match_all

logger = logging.getLogger(__name__)
INTERVAL_SECONDS = 60


def run_once() -> int:
    db = SessionLocal()
    try:
        return match_all(db)
    except Exception:
        db.rollback()
        logger.exception("Paper order matching failed.")
        return 0
    finally:
        db.close()


def run_daily() -> dict | None:
    from app.services.paper.deployments import run_due

    db = SessionLocal()
    try:
        return run_due(db)
    except Exception:
        db.rollback()
        logger.exception("The paper trading daily job failed.")
        return None
    finally:
        db.close()


async def matcher_loop() -> None:
    from app.services.paper.deployments import due_day

    was_open = False
    last_daily = None
    while True:
        await asyncio.sleep(INTERVAL_SECONDS)
        now = clock.now_utc()
        open_now = clock.is_market_open(now)
        if open_now or was_open:  # the run after the close expires day orders
            await run_in_threadpool(run_once)
        was_open = open_now
        due = due_day(now)
        if due != last_daily:
            result = await run_in_threadpool(run_daily)
            if result is not None:
                last_daily = due
