"""
Paper trading daily job: runs every active strategy deployment up to the latest
settled NSE close (catching up missed days) and records each account's value.

Run from the backend folder:  python -m scripts.run_paper_daily
Safe to run any number of times. The backend does the same on its own while it
is running; schedule this (for example Windows Task Scheduler, 16:30 on
weekdays) for days the backend is not running.
"""

from app.db import SessionLocal
from app.services.paper.deployments import run_due


def main() -> None:
    with SessionLocal() as db:
        result = run_due(db)
    print(
        f"Processed up to {result['through']}: {result['deployments']} active deployment(s), "
        f"{result['days_processed']} day(s) processed, {result['snapshots']} account snapshot(s)."
    )


if __name__ == "__main__":
    main()
