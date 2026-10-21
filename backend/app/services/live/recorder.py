"""The recorder (Feature 7): polls the live feed for instruments and stores their
1-minute bars. One batched request per poll for all symbols; the feed's backoff
decides when it may ask again."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.live.clock import session_open
from app.live.feed import FeedError, LiveFeed
from app.models import Instrument
from app.services.live import store
from app.services.paper.quotes import yahoo_symbol

logger = logging.getLogger(__name__)


def poll(db: Session, feed: LiveFeed, instrument_ids: list[UUID], day) -> dict:
    """Fetch and store new 1-minute bars of the instruments for `day`.
    Returns {instrument_id: new bars} and the error, if any."""
    symbols: dict[str, UUID] = {}
    since: datetime | None = None
    for instrument_id in dict.fromkeys(instrument_ids):
        instrument = db.get(Instrument, instrument_id)
        if instrument is None:
            continue
        symbols[yahoo_symbol(instrument)] = instrument.id
        last = store.last_bar_time(db, instrument.id)
        start = session_open(day)
        begin = max(last + timedelta(minutes=1), start) if last is not None and last >= start else start
        since = begin if since is None else min(since, begin)
    if not symbols:
        return {"new": {}, "error": None}
    try:
        fetched = feed.fetch_1m(list(symbols), since)
    except FeedError as exc:
        return {"new": {}, "error": str(exc), "rate_limited": exc.rate_limited}
    new = {}
    for symbol, rows in fetched.items():
        instrument_id = symbols.get(symbol)
        if instrument_id is not None:
            new[str(instrument_id)] = store.save_bars(db, instrument_id, rows, feed.source)
    return {"new": new, "error": None}
