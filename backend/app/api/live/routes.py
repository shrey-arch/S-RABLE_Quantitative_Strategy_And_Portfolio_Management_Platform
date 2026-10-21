"""Live paper trading (Feature 7): intraday sessions on delayed live data or a
replayed day, with simulated orders in the user's paper account. Virtual money
only; nothing is ever sent to a broker. Only the owner sees a session (404)."""

from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.dependencies import get_current_user
from app.db import SessionLocal, get_db
from app.live.clock import delayed_session_day
from app.models import Instrument, LiveSession, User
from app.schemas.live import (
    CreateLiveSessionRequest,
    LiveBars,
    LiveEvent,
    LiveFill,
    LiveSessionOut,
    LiveStatusOut,
    ReplayDay,
    StopRequest,
)
from app.services.live import sessions as S
from app.services.live import store
from app.services.live.runner import OPEN_STATUSES
from app.services.paper import clock as nse
from app.services.paper.charges import mis_rate_table

router = APIRouter(prefix="/live", tags=["Live paper trading"])

HEARTBEAT_SECONDS = 15
STREAM_POLL_SECONDS = 1.0


def _now() -> datetime:
    return nse.now_utc()


def _owned(db: Session, user: User, session_id: UUID, lock: bool = False) -> LiveSession:
    try:
        return S.owned(db, user, session_id, lock=lock)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Live session not found.") from exc


@router.post("/sessions", response_model=LiveSessionOut, status_code=201)
def create_session(
    request: CreateLiveSessionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        s = S.create_session(
            db,
            current_user,
            strategy_id=request.strategy_id,
            instrument_id=request.instrument_id,
            timeframe=request.timeframe,
            mode=request.mode,
            replay_date=request.replay_date,
            speed=request.speed,
            capital=request.capital,
            quantity=request.quantity,
            slippage_bps=request.slippage_bps,
            loss_limit_pct=request.loss_limit_pct,
            max_position_value=request.max_position_value,
            now=_now(),
            name=request.name,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except S.LiveSessionError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return S.view(db, s, _now())


@router.get("/sessions", response_model=list[LiveSessionOut])
def list_sessions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The user's live sessions, newest first."""
    rows = db.scalars(
        select(LiveSession).where(LiveSession.user_id == current_user.id).order_by(LiveSession.created_at.desc()).limit(200)
    ).all()
    now = _now()
    return [S.view(db, s, now) for s in rows]


@router.get("/sessions/{session_id}", response_model=LiveSessionOut)
def get_session(session_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return S.view(db, _owned(db, current_user, session_id), _now())


@router.get("/sessions/{session_id}/bars", response_model=LiveBars)
def get_bars(session_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The day's closed bars by the session clock and the forming one."""
    return S.bars_view(db, _owned(db, current_user, session_id), _now())


@router.get("/sessions/{session_id}/events", response_model=list[LiveEvent])
def get_events(
    session_id: UUID,
    after: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The audit log in order: every bar, signal, order, fill, risk check and data event."""
    return S.events_view(db, _owned(db, current_user, session_id), after, limit)


@router.get("/sessions/{session_id}/fills", response_model=list[LiveFill])
def get_fills(session_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return S.fills_view(db, _owned(db, current_user, session_id))


def _plain(value):
    """JSON for the stream: times as ISO 8601 (as the REST endpoints give them)."""
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _sse(kind: str, data: dict, event_id: int | None = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {kind}\ndata: {json.dumps(data, default=_plain)}\n\n"


@router.get("/sessions/{session_id}/stream")
async def stream(
    session_id: UUID,
    request: Request,
    after: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Server-Sent Events: the audit log as it grows (event: bar, signal, fill,
    equity, risk, data, status...), the forming bar and the session snapshot every
    second, and a heartbeat every 15 seconds. It ends when the session has ended."""
    _owned(db, current_user, session_id)
    user = current_user

    async def events():
        last = after
        beat = 0.0
        while True:
            if await request.is_disconnected():
                return
            local = SessionLocal()
            try:
                s = S.owned(local, user, session_id)
                for row in S.events_view(local, s, last, 500):
                    last = row.id
                    yield _sse(
                        row.kind.lower(),
                        {
                            "id": row.id,
                            "kind": row.kind,
                            "market_time": row.market_time,
                            "message": row.message,
                            "data": row.data,
                            "created_at": row.created_at,
                        },
                        row.id,
                    )
                now = _now()
                yield _sse("snapshot", S.view(local, s, now))
                forming = S.bars_view(local, s, now)["forming"]
                yield _sse("forming", forming or {})
                ended = s.status not in OPEN_STATUSES and not (s.status == "STOPPED" and s.position_qty)
            finally:
                local.close()
            if ended:
                yield _sse("end", {"status": s.status})
                return
            await asyncio.sleep(STREAM_POLL_SECONDS)
            beat += STREAM_POLL_SECONDS
            if beat >= HEARTBEAT_SECONDS:
                beat = 0
                yield ": heartbeat\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


def _control(fn, db: Session, *args):
    try:
        return fn(db, *args)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Live session not found.") from exc
    except S.LiveSessionError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/pause", response_model=LiveSessionOut)
def pause_session(session_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = _control(lambda d, *a: S.pause(d, *a, now=_now()), db, current_user, session_id)
    return S.view(db, s, _now())


@router.post("/sessions/{session_id}/resume", response_model=LiveSessionOut)
def resume_session(session_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = _control(lambda d, *a: S.resume(d, *a, now=_now()), db, current_user, session_id)
    return S.view(db, s, _now())


@router.post("/sessions/{session_id}/stop", response_model=LiveSessionOut)
def stop_session(
    session_id: UUID,
    request: StopRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The kill switch: the runner stops the session on its next tick (within a
    second): square off now, or leave the position for the 15:20 square-off."""
    square_off = True if request is None else request.square_off
    s = _control(S.request_stop, db, current_user, session_id, square_off)
    return S.view(db, s, _now())


@router.post("/stop-all")
def stop_all(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Stop every running session of the user and square off now."""
    return {"stopping": S.stop_all(db, current_user)}


@router.get("/replay-days", response_model=list[ReplayDay])
def replay_days(
    instrument_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Days with recorded 1-minute bars of the instrument, newest first."""
    if db.get(Instrument, instrument_id) is None:
        raise HTTPException(status_code=404, detail="Instrument not found.")
    return store.replay_days(db, instrument_id)


@router.get("/status", response_model=LiveStatusOut)
def status(current_user: User = Depends(get_current_user)):
    from app.services.live.runner import _runner

    now = _now()
    feed = _runner.feed.health.as_dict() if _runner is not None and _runner.feed is not None else None
    return {
        "market": nse.market_status(now),
        "delayed_day": delayed_session_day(now),
        "delay_minutes": 15,
        "runner_enabled": settings.live_runner_enabled,
        "feed": feed,
        "label": S.LABEL,
    }


@router.get("/charges")
def charges(current_user: User = Depends(get_current_user)):
    """The intraday (MIS) charges every live fill pays."""
    return mis_rate_table()
