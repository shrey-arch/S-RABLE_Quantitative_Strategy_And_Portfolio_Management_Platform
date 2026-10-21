"""Stored live 1-minute bars (Feature 7). Kept apart from the historical bars in
market_data; duplicates are ignored, so a bar is stored once however often it is
fetched. Replay reads only from here. Every timestamp this module returns is in
IST, whatever the database connection's session timezone."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from uuid import UUID

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.live import bars as B
from app.live.clock import IST, session_close, session_open
from app.models import LiveBar

# A day can be replayed when most of its session is stored.
REPLAY_MIN_BARS = 300


def save_bars(db: Session, instrument_id: UUID, rows: list[dict], source: str) -> int:
    """Store 1-minute bars inside the NSE session; returns how many were new."""
    values = []
    for row in rows:
        stamp = pd.Timestamp(row["timestamp"])
        stamp = stamp.tz_localize("UTC") if stamp.tzinfo is None else stamp.tz_convert("UTC")
        local = stamp.tz_convert(IST).to_pydatetime()
        day = local.date()
        if not (session_open(day) <= local < session_close(day)):
            continue
        values.append(
            {
                "instrument_id": instrument_id,
                "timestamp": stamp.to_pydatetime(),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": int(row.get("volume") or 0),
                "source": source,
            }
        )
    if not values:
        return 0
    statement = (
        insert(LiveBar)
        .values(values)
        .on_conflict_do_nothing(index_elements=["instrument_id", "timestamp"])
        .returning(LiveBar.id)
    )
    inserted = len(db.execute(statement).all())
    db.commit()
    return inserted


def last_bar_time(db: Session, instrument_id: UUID) -> datetime | None:
    """Newest stored bar time for the instrument, in IST, or None."""
    stamp = db.scalar(select(func.max(LiveBar.timestamp)).where(LiveBar.instrument_id == instrument_id))
    return stamp.astimezone(IST) if stamp is not None else None


def load_1m(db: Session, instrument_id: UUID, start: datetime, end: datetime) -> pd.DataFrame:
    """Stored 1-minute bars with start <= timestamp < end, indexed in IST."""
    rows = db.scalars(
        select(LiveBar)
        .where(LiveBar.instrument_id == instrument_id, LiveBar.timestamp >= start, LiveBar.timestamp < end)
        .order_by(LiveBar.timestamp)
    ).all()
    frame = B.frame(rows)
    if len(frame):
        index = pd.DatetimeIndex(frame.index)
        frame.index = index.tz_localize("UTC").tz_convert(IST) if index.tz is None else index.tz_convert(IST)
    return frame


def warmup_start(day: date, days: int = 5) -> datetime:
    """Where a session's history starts: a few calendar days before its day."""
    return session_open(day) - timedelta(days=days)


def replay_days(db: Session, instrument_id: UUID) -> list[dict]:
    """Days with stored 1-minute bars, newest first, and whether each can be replayed."""
    local_day = func.date(func.timezone("Asia/Kolkata", LiveBar.timestamp))
    rows = db.execute(
        select(local_day, func.count(), func.min(LiveBar.timestamp), func.max(LiveBar.timestamp))
        .where(LiveBar.instrument_id == instrument_id)
        .group_by(local_day)
        .order_by(local_day.desc())
    ).all()
    return [
        {
            "day": d.isoformat(),
            "bars": int(n),
            "first": first.astimezone(IST).isoformat(),
            "last": last.astimezone(IST).isoformat(),
            "replayable": int(n) >= REPLAY_MIN_BARS,
        }
        for d, n, first, last in rows
    ]