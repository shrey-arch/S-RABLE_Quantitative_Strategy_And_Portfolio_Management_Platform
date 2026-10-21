"""Feature 7, P1: live bars, feeds, clocks and bar building (no network).

Clocks with a fake time source; 1-minute bars into 5 and 15-minute bars across
minute boundaries, the 09:15 open and the 15:30 close; duplicates and late bars;
the stored-bar table; the recorder against a recorded feed; backoff on errors
and HTTP 429."""

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pandas as pd
import pytest
from sqlalchemy import delete

from app.db import SessionLocal
from app.enums import Exchange, InstrumentType
from app.live import bars as B
from app.live.clock import (
    IST,
    DelayedClock,
    ReplayClock,
    delayed_session_day,
    session_minutes,
    session_open,
)
from app.live.feed import BACKOFF_MAX, FeedError, RecordedFeed
from app.models import Instrument, LiveBar
from app.services.instruments.instrument_service import InstrumentService
from app.services.live import recorder, store
from tests.live_synth import intraday_day

DAY = date(2026, 10, 16)  # a Friday, an NSE trading day
PREV = date(2026, 10, 15)


def ist(h, m, s=0, day=DAY):
    return datetime(day.year, day.month, day.day, h, m, s, tzinfo=IST)


class FakeNow:
    def __init__(self, at):
        self.at = at.astimezone(timezone.utc)

    def __call__(self):
        return self.at

    def advance(self, **kw):
        self.at += timedelta(**kw)


# --- clocks ---------------------------------------------------------------------------


def test_the_delayed_clock_is_fifteen_minutes_behind_and_releases_complete_bars():
    now = FakeNow(ist(9, 32, 10))
    clock = DelayedClock(DAY, 15, now)
    assert clock.market_time() == ist(9, 17, 10)
    # 09:15 and 09:16 are complete by 09:17:10; 09:17 is not.
    assert clock.released_minutes() == [ist(9, 15), ist(9, 16)]
    state = clock.state()
    assert state.open and not state.finished
    assert "15 min behind live" in clock.label() and "09:17" in clock.label()
    now.advance(hours=6, minutes=30)  # 16:02 wall -> 15:47 market
    assert clock.state().finished and not clock.state().open
    assert len(clock.released_minutes()) == 375


def test_before_the_open_nothing_is_released():
    clock = DelayedClock(DAY, 15, FakeNow(ist(9, 20)))
    assert clock.released_minutes() == [] and not clock.state().open


def test_the_replay_clock_runs_the_day_at_its_speed_and_stops_at_the_close():
    started = ist(18, 0)  # an evening: the replay is of the day's recorded bars
    now = FakeNow(started)
    clock = ReplayClock(DAY, started, speed=5, now=now)
    assert clock.market_time() == ist(9, 15)
    now.advance(minutes=2)
    assert clock.market_time() == ist(9, 25)
    assert len(clock.released_minutes()) == 10
    now.advance(hours=2)
    assert clock.market_time() == ist(15, 30)
    assert clock.state().finished
    assert clock.label() == "Replay of 16 Oct 2026 \u00b7 5x"
    with pytest.raises(ValueError):
        ReplayClock(DAY, started, speed=3)


def test_a_delayed_session_runs_only_while_the_delayed_clock_is_in_the_session():
    assert delayed_session_day(ist(9, 25).astimezone(timezone.utc)) is None  # 09:10 market
    assert delayed_session_day(ist(9, 31).astimezone(timezone.utc)) == DAY
    assert delayed_session_day(ist(15, 44).astimezone(timezone.utc)) == DAY
    assert delayed_session_day(ist(15, 46).astimezone(timezone.utc)) is None
    saturday = date(2026, 10, 17)
    assert delayed_session_day(ist(11, 0, day=saturday).astimezone(timezone.utc)) is None


# --- bars -----------------------------------------------------------------------------


def test_one_minute_bars_build_five_and_fifteen_minute_bars_aligned_to_the_open():
    one = intraday_day(DAY, seed=3)
    closed, forming = B.aggregate(one, "5M", DAY, ist(9, 27, 30))
    # 09:15 and 09:20 are closed; 09:25 is forming with its two complete minutes.
    assert [t.tz_convert(IST).strftime("%H:%M") for t in closed.index] == ["09:15", "09:20"]
    first = one.iloc[0:5]
    row = closed.iloc[0]
    assert row["open"] == first["open"].iloc[0]
    assert row["high"] == first["high"].max() and row["low"] == first["low"].min()
    assert row["close"] == first["close"].iloc[-1] and row["volume"] == first["volume"].sum()
    assert forming["minutes"] == 2 and forming["of"] == 5
    assert forming["close"] == one["close"].iloc[11]
    # At the close every bucket is closed: 75 five-minute and 25 fifteen-minute bars.
    assert len(B.aggregate(one, "5M", DAY, ist(15, 30))[0]) == 75
    fifteen, none = B.aggregate(one, "15M", DAY, ist(15, 30))
    assert len(fifteen) == 25 and none is None
    assert fifteen.index[-1].tz_convert(IST).strftime("%H:%M") == "15:15"
    assert fifteen["close"].iloc[-1] == one["close"].iloc[-1]
    # 1-minute bars are themselves.
    ones, _ = B.aggregate(one, "1M", DAY, ist(9, 20))
    assert ones.equals(one.iloc[0:5].astype(float))


def test_a_bar_is_closed_exactly_at_its_end():
    one = intraday_day(DAY, seed=3)
    assert len(B.aggregate(one, "5M", DAY, ist(9, 19, 59))[0]) == 0
    assert len(B.aggregate(one, "5M", DAY, ist(9, 20, 0))[0]) == 1


def test_the_first_minute_of_the_day_is_one_bar_on_every_timeframe():
    one = intraday_day(DAY, seed=3)
    at = datetime(2026, 10, 16, 9, 16, tzinfo=IST)  # only the 09:15 bar is complete
    first = one.iloc[0]
    closed, forming = B.aggregate(one, "1M", DAY, at)
    assert len(closed) == 1 and forming is None
    assert closed["close"].iloc[0] == pytest.approx(first["close"])
    closed, forming = B.aggregate(one, "5M", DAY, at)
    assert closed.empty and forming["minutes"] == 1 and forming["of"] == 5
    assert forming["timestamp"] == pd.Timestamp("2026-10-16T03:45:00Z")
    bars, forming = B.history(one, "15M", at)
    assert bars.empty and forming["minutes"] == 1


def test_missing_and_duplicate_minutes_are_never_invented_or_counted_twice():
    one = intraday_day(DAY, seed=4)
    gappy = one.drop(one.index[2])
    closed, _ = B.aggregate(gappy, "5M", DAY, ist(9, 20))
    assert closed["volume"].iloc[0] == one["volume"].iloc[[0, 1, 3, 4]].sum()
    rows = [{"timestamp": t, **r} for t, r in one.iloc[0:3].to_dict("index").items()]
    assert len(B.frame(rows + rows[:2])) == 3


def test_history_gives_earlier_days_as_warm_up_and_todays_forming_bar():
    one = pd.concat([intraday_day(PREV, seed=1), intraday_day(DAY, seed=2)])
    bars, forming = B.history(one, "15M", ist(10, 7))
    assert len(bars) == 25 + 3  # all of yesterday, 09:15/09:30/09:45 today
    assert forming["minutes"] == 7


def test_bars_outside_the_session_are_ignored():
    one = intraday_day(DAY, seed=3)
    late = one.iloc[[-1]].copy()
    late.index = late.index + timedelta(minutes=5)  # 15:34
    closed, _ = B.aggregate(pd.concat([one, late]), "15M", DAY, ist(16, 0))
    assert len(closed) == 25


# --- the store and the recorder -------------------------------------------------------


@pytest.fixture
def instrument():
    db = SessionLocal()
    row = InstrumentService(db).create_instrument(
        symbol=f"LV{uuid4().hex[:5].upper()}",
        trading_symbol=f"LV-{uuid4().hex[:6]}",
        name="Live test",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin=None,
        lot_size=1,
        tick_size=0.05,
    )
    try:
        yield db, row
    finally:
        db.rollback()
        db.execute(delete(LiveBar).where(LiveBar.instrument_id == row.id))
        db.execute(delete(Instrument).where(Instrument.id == row.id))
        db.commit()
        db.close()


def rows_of(df):
    return [{"timestamp": t.to_pydatetime(), **r} for t, r in df.to_dict("index").items()]


def test_stored_bars_ignore_duplicates_and_bars_outside_the_session(instrument):
    db, inst = instrument
    one = intraday_day(DAY, seed=5)
    assert store.save_bars(db, inst.id, rows_of(one.iloc[:10]), "recorded") == 10
    assert store.save_bars(db, inst.id, rows_of(one.iloc[5:20]), "recorded") == 10
    outside = rows_of(one.iloc[:1])
    outside[0]["timestamp"] = ist(16, 0)
    assert store.save_bars(db, inst.id, outside, "recorded") == 0
    loaded = store.load_1m(db, inst.id, session_open(DAY), session_open(DAY) + timedelta(hours=7))
    assert len(loaded) == 20
    assert loaded["close"].tolist() == one["close"].iloc[:20].tolist()
    days = store.replay_days(db, inst.id)
    assert days == [
        {
            "day": "2026-10-16",
            "bars": 20,
            "first": loaded.index[0].isoformat(),
            "last": loaded.index[-1].isoformat(),
            "replayable": False,
        }
    ]
    store.save_bars(db, inst.id, rows_of(one), "recorded")
    assert store.replay_days(db, inst.id)[0]["replayable"] is True


def test_the_recorder_stores_only_published_bars_and_then_only_new_ones(instrument):
    db, inst = instrument
    one = intraday_day(DAY, seed=6)
    now = FakeNow(ist(9, 20, 30))
    feed = RecordedFeed({f"{inst.symbol}.NS": one}, now)
    first = recorder.poll(db, feed, [inst.id], DAY)
    assert first == {"new": {str(inst.id): 5}, "error": None}  # 09:15-09:19 are complete
    now.advance(minutes=3)
    assert recorder.poll(db, feed, [inst.id], DAY)["new"] == {str(inst.id): 3}
    assert feed.health.polls == 2 and feed.health.bars_received == 8
    assert store.last_bar_time(db, inst.id) == one.index[7].to_pydatetime()


def test_errors_back_off_exponentially_and_429_is_reported(instrument):
    db, inst = instrument
    now = FakeNow(ist(10, 0))
    feed = RecordedFeed({f"{inst.symbol}.NS": intraday_day(DAY, seed=6)}, now)
    feed.fail = [FeedError("HTTP 429 Too Many Requests", rate_limited=True), FeedError("timeout")]
    out = recorder.poll(db, feed, [inst.id], DAY)
    assert out["error"] == "HTTP 429 Too Many Requests" and out["rate_limited"] is True
    assert feed.health.backoff_until == now() + timedelta(seconds=60)
    # While backing off the source is not asked again.
    blocked = recorder.poll(db, feed, [inst.id], DAY)
    assert "Waiting until" in blocked["error"] and feed.health.polls == 1
    now.advance(seconds=61)
    recorder.poll(db, feed, [inst.id], DAY)
    assert feed.health.consecutive_errors == 2
    assert feed.health.backoff_until == now() + timedelta(seconds=120)
    now.advance(seconds=121)
    ok = recorder.poll(db, feed, [inst.id], DAY)
    assert ok["error"] is None and ok["new"][str(inst.id)] > 0
    assert feed.health.consecutive_errors == 0 and feed.health.backoff_until is None
    # The wait never exceeds the maximum.
    feed.fail = [FeedError("x")] * 12
    for _ in range(12):
        now.advance(seconds=BACKOFF_MAX + 1)
        recorder.poll(db, feed, [inst.id], DAY)
    assert feed.health.backoff_until == now() + timedelta(seconds=BACKOFF_MAX)


def test_session_minutes_cover_the_whole_session():
    minutes = session_minutes(DAY)
    assert len(minutes) == 375
    assert minutes[0] == ist(9, 15) and minutes[-1] == ist(15, 29)
