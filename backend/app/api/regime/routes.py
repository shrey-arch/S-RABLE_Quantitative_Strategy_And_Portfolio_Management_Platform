"""Market regime (Phase 12, Feature 2): train the regime model and read what it classifies.

One model is shared by the platform; the newest READY model is active. Training
runs in the background after POST /regime/models returns (TRAINING), and the
page follows it with GET /regime/models/{id}. Every label, confidence and date
returned here comes from the stored model.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import Timeframe
from app.ml import supervised as sup
from app.models import Instrument, MarketData, RegimeModelRecord, User
from app.schemas.regime import (
    SUPERVISED_STATEMENT,
    STATEMENT,
    CurrentRegime,
    RegimeHistory,
    RegimeModelDetail,
    RegimeModelSummary,
    TrainRegimeModelRequest,
)
from app.services.regime import service as regime

router = APIRouter(prefix="/regime", tags=["Market regime"])

MIN_COMPLETE_ROWS = 100
NO_MODEL = "No regime model has been trained yet. Train one on the Market regime page."
PERFORMANCE_NOTE = (
    "The model is unsupervised: there are no true regime labels to compare with, so "
    "it has no accuracy figure. BIC measures fit (lower is better); the mean highest "
    "probability and entropy show how clearly the test days fall into one cluster."
)
SUPERVISED_NOTE = (
    "Each dimension is a classifier of the next {horizon} trading days. Accuracy is measured "
    "once, on the test split (the last 15% of the labelled days, after a {horizon}-day purge "
    "gap), against the {target:.0%} target, and compared with two baselines: always the most "
    "common training class, and persistence (the next days repeat the last days). Balanced "
    "accuracy averages the recall of each class, so it is not inflated by a common class."
)
WARM_UP = "Warm-up (features not complete yet)"


def _instrument(db: Session, instrument_id: UUID | None) -> dict:
    instrument = db.get(Instrument, instrument_id) if instrument_id else None
    return {
        "id": instrument.id if instrument else None,
        "symbol": instrument.symbol if instrument else None,
        "trading_symbol": instrument.trading_symbol if instrument else None,
    }


def _summary(db: Session, record: RegimeModelRecord, user: User, active_id: UUID | None) -> dict:
    return {
        "id": record.id,
        "number": record.number,
        "status": record.status,
        "is_active": record.id == active_id,
        "model_version": record.model_version,
        "model_kind": record.model_kind or "GMM",
        "instrument": _instrument(db, record.instrument_id),
        "vix_instrument": (
            _instrument(db, record.vix_instrument_id)
            if record.settings.get("vix_instrument_id")
            else None
        ),
        "settings": record.settings,
        "trained_by_you": record.trained_by_user_id == user.id,
        "error_message": record.error_message,
        "created_at": record.created_at,
        "started_at": record.started_at,
        "completed_at": record.completed_at,
    }


def _card(record: RegimeModelRecord) -> dict | None:
    m = record.model_metadata
    if record.status != regime.READY or not m:
        return None
    if regime.is_supervised(record):
        return {
            "model_kind": record.model_kind,
            "model_type": m["model_type"],
            "model_version": m["model_version"],
            "training_start": m["training_start"],
            "training_end": m["training_end"],
            "selection": m["selection"],
            "random_state": m["random_state"],
            "features": m["features"],
            "performance_note": SUPERVISED_NOTE.format(
                horizon=m["horizon_days"], target=sup.TARGET_ACCURACY
            ),
            "labels": m["labels"],
            "dataset": m["dataset"],
            "scikit_learn_version": m["scikit_learn_version"],
            "created_at": m["created_at"],
            "supervised": {
                "label_definition": m["label_definition"],
                "evaluation": m["evaluation"],
                "uses_volume": m["uses_volume"],
                "volume_note": m["volume_note"],
                "xgboost_version": m["xgboost_version"],
            },
        }
    return {
        "model_kind": "GMM",
        "model_type": m["model_type"],
        "model_version": m["model_version"],
        "training_start": m["training_start"],
        "training_end": m["training_end"],
        "n_components": m["n_components"],
        "candidate_components": m["candidate_components"],
        "selection": m["selection"],
        "random_state": m["random_state"],
        "features": m["features"],
        "feature_parameters": m["feature_parameters"],
        "parameters": m["parameters"],
        "evaluation": m["evaluation"],
        "performance_note": PERFORMANCE_NOTE,
        "labels": m["labels"],
        "dataset": m["dataset"],
        "scikit_learn_version": m["scikit_learn_version"],
        "created_at": m["created_at"],
    }


def _active_id(db: Session) -> UUID | None:
    active = regime.active_model(db)
    return active.id if active else None


@router.get("/models", response_model=list[RegimeModelSummary])
def list_models(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every regime model, newest first."""
    active_id = _active_id(db)
    records = db.scalars(
        select(RegimeModelRecord).order_by(RegimeModelRecord.number.desc())
    ).all()
    return [_summary(db, r, current_user, active_id) for r in records]


@router.get("/models/{model_id}", response_model=RegimeModelDetail)
def get_model(
    model_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = db.get(RegimeModelRecord, model_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Regime model not found.")
    return {**_summary(db, record, current_user, _active_id(db)), "card": _card(record)}


@router.post(
    "/models",
    response_model=RegimeModelDetail,
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        409: {"description": "A regime model is already training."},
        422: {"description": "The instrument or the settings cannot be used."},
    },
)
def train_model(
    request: TrainRegimeModelRequest,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start training a new model on the reference instrument. When it is READY it
    becomes the active model for everyone."""
    instrument = db.get(Instrument, request.instrument_id)
    if instrument is None:
        raise HTTPException(status_code=422, detail="This instrument does not exist.")
    if not instrument.is_active:
        raise HTTPException(status_code=422, detail=f"{instrument.trading_symbol} is inactive.")

    first, last = regime.day_bounds(request.start_date, request.end_date)

    def stored_bars(instrument_id: UUID) -> int:
        query = select(func.count()).select_from(MarketData).where(
            MarketData.instrument_id == instrument_id,
            MarketData.timeframe == Timeframe.ONE_DAY,
        )
        if first is not None:
            query = query.where(MarketData.timestamp >= first)
        if last is not None:
            query = query.where(MarketData.timestamp <= last)
        return int(db.scalar(query) or 0)

    bars = stored_bars(instrument.id)
    supervised = request.model_kind != "GMM"
    vix = None
    if supervised:
        # 252 days of feature warm-up and the label horizon at the end have no rows.
        complete = max(0, bars - 252 - request.horizon_days)
        if complete < sup.MIN_LABELLED_ROWS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"A supervised model needs at least {sup.MIN_LABELLED_ROWS} labelled days. "
                    f"{instrument.symbol} has {bars} daily bars in this range; 252 days of feature "
                    f"warm-up and the {request.horizon_days}-day horizon leave {complete}. Choose a "
                    "longer range or import more data (Nifty 50 from 2010 is recommended)."
                ),
            )
        if request.vix_instrument_id is not None:
            vix = db.get(Instrument, request.vix_instrument_id)
            if vix is None:
                raise HTTPException(status_code=422, detail="The India VIX instrument does not exist.")
            if vix.id == instrument.id:
                raise HTTPException(
                    status_code=422, detail="India VIX must be a different instrument from the reference."
                )
            if stored_bars(vix.id) == 0:
                raise HTTPException(
                    status_code=422,
                    detail=f"{vix.symbol} has no stored daily bars in this range. Import its data first.",
                )
    else:
        window = max(request.volatility_window, request.trend_window)
        complete = max(0, bars - window)
        if complete < MIN_COMPLETE_ROWS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Training needs at least {MIN_COMPLETE_ROWS} days with complete features. "
                    f"{instrument.symbol} has {bars} daily bars in this range and the "
                    f"{window}-day window leaves {complete}. Choose a longer range or import "
                    "more data."
                ),
            )

    with regime.training_lock:
        if regime.training_model(db) is not None:
            raise HTTPException(
                status_code=409,
                detail="A regime model is already training. Wait for it to finish, then try again.",
            )
        common = {
            "instrument_id": str(instrument.id),
            "start_date": request.start_date.isoformat() if request.start_date else None,
            "end_date": request.end_date.isoformat() if request.end_date else None,
            "random_state": request.random_state,
            "model_kind": request.model_kind,
        }
        settings = (
            {
                **common,
                "horizon_days": request.horizon_days,
                "vix_instrument_id": str(vix.id) if vix else None,
            }
            if supervised
            else {
                **common,
                "volatility_window": request.volatility_window,
                "trend_window": request.trend_window,
                "candidate_components": request.candidate_components,
            }
        )
        record = RegimeModelRecord(
            number=regime.next_number(db),
            status=regime.TRAINING,
            model_version=regime.model_version_for(request.model_kind),
            model_kind=request.model_kind,
            instrument_id=instrument.id,
            vix_instrument_id=vix.id if vix else None,
            trained_by_user_id=current_user.id,
            settings=settings,
        )
        db.add(record)
        db.commit()
        db.refresh(record)

    background.add_task(regime.train_model, record.id)
    return {**_summary(db, record, current_user, _active_id(db)), "card": None}


def _ready_model(db: Session, model_id: UUID | None) -> RegimeModelRecord:
    if model_id is None:
        record = regime.active_model(db)
        if record is None:
            raise HTTPException(status_code=404, detail=NO_MODEL)
        return record
    record = db.get(RegimeModelRecord, model_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Regime model not found.")
    if record.status != regime.READY:
        raise HTTPException(status_code=409, detail="This model is not ready.")
    return record


def _classified(db: Session, record: RegimeModelRecord) -> tuple[pd.DataFrame, pd.DataFrame]:
    try:
        return regime.classify_stored(db, record)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _statement(record: RegimeModelRecord) -> str:
    if regime.is_supervised(record):
        return SUPERVISED_STATEMENT.format(horizon=record.settings["horizon_days"])
    return STATEMENT


def _dimension_readings(row: pd.Series) -> list[dict]:
    return [
        {
            "key": key,
            "name": sup.DIMENSION_NAMES[key],
            "label": row[f"{key}_label"],
            "probability": float(row[f"{key}_probability"]),
            "probabilities": [
                {"label": name, "probability": float(row[f"{key}_p::{name}"])}
                for name in sup.CLASSES[key]
            ],
        }
        for key in sup.DIMENSIONS
    ]


def _labels(record: RegimeModelRecord) -> dict[int, dict]:
    return {row["regime_id"]: row for row in record.model_metadata["labels"]["regimes"]}


@router.get(
    "/current",
    response_model=CurrentRegime,
    responses={404: {"description": "No regime model has been trained yet."}},
)
def current_regime(
    model_id: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The active model's regime on the reference instrument's last stored bar."""
    record = _ready_model(db, model_id)
    _, classified = _classified(db, record)
    if classified.empty:
        raise HTTPException(
            status_code=409,
            detail="Not enough stored daily bars to compute the model's features.",
        )
    labels = _labels(record)
    last = classified.iloc[-1]
    regime_id = int(last["regime_id"])
    supervised = regime.is_supervised(record)
    return {
        "statement": _statement(record),
        "horizon_days": record.settings["horizon_days"] if supervised else None,
        "dimensions": _dimension_readings(last) if supervised else None,
        "model": _summary(db, record, current_user, _active_id(db)),
        "instrument": _instrument(db, record.instrument_id),
        "as_of": pd.Timestamp(classified.index[-1]).isoformat(),
        "regime": labels[regime_id],
        "confidence": float(last["confidence"]),
        "probabilities": [
            {
                "regime_id": rid,
                "code": label["code"],
                "name": label["name"],
                "probability": float(last[f"probability_{rid}"]),
            }
            for rid, label in sorted(labels.items(), key=lambda item: item[1]["code"])
        ],
    }


@router.get(
    "/history",
    response_model=RegimeHistory,
    responses={404: {"description": "No regime model has been trained yet."}},
)
def regime_history(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    model_id: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The reference instrument's closes with the regime of each day, its periods and
    the transitions between them. Features use all stored bars before each day, so
    a range's first days are classified like any other day."""
    if start_date and end_date and end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date.")
    record = _ready_model(db, model_id)
    data, classified = _classified(db, record)
    labels = _labels(record)

    days = pd.Series(data.index.tz_convert(regime.IST).date, index=data.index)
    mask = pd.Series(True, index=data.index)
    if start_date:
        mask &= days >= start_date
    if end_date:
        mask &= days <= end_date
    window = data[mask.to_numpy()]
    if window.empty:
        raise HTTPException(status_code=422, detail="No stored daily bars in this range.")

    supervised = regime.is_supervised(record)
    points, periods, transitions = [], [], []
    bands = {key: [] for key in sup.DIMENSIONS} if supervised else {}
    previous: int | None = None
    for timestamp, row in window.iterrows():
        stamp = pd.Timestamp(timestamp).isoformat()
        known = timestamp in classified.index
        regime_id = int(classified.at[timestamp, "regime_id"]) if known else None
        confidence = float(classified.at[timestamp, "confidence"]) if known else None
        dimensions = (
            {key: classified.at[timestamp, f"{key}_label"] for key in sup.DIMENSIONS}
            if supervised and known
            else None
        )
        points.append(
            {
                "timestamp": stamp,
                "close": float(row["close"]),
                "regime_id": regime_id,
                "confidence": confidence,
                "dimensions": dimensions,
            }
        )
        for key, band in bands.items():
            label = dimensions[key] if dimensions else None
            if band and band[-1]["label"] == label:
                band[-1]["end"] = stamp
                band[-1]["bars"] += 1
            else:
                band.append({"label": label, "start": stamp, "end": stamp, "bars": 1})
        if periods and periods[-1]["regime_id"] == regime_id:
            periods[-1]["end"] = stamp
            periods[-1]["bars"] += 1
        else:
            label = labels.get(regime_id) if regime_id is not None else None
            periods.append(
                {
                    "regime_id": regime_id,
                    "code": label["code"] if label else None,
                    "name": label["name"] if label else WARM_UP,
                    "start": stamp,
                    "end": stamp,
                    "bars": 1,
                }
            )
            if previous is not None and regime_id is not None and previous != regime_id:
                transitions.append(
                    {
                        "timestamp": stamp,
                        "from_regime_id": previous,
                        "from_code": labels[previous]["code"],
                        "from_name": labels[previous]["name"],
                        "to_regime_id": regime_id,
                        "to_code": label["code"],
                        "to_name": label["name"],
                        "confidence": confidence,
                    }
                )
        if regime_id is not None:
            previous = regime_id

    meta = record.model_metadata
    return {
        "statement": _statement(record),
        "horizon_days": record.settings["horizon_days"] if supervised else None,
        "dimension_periods": (
            [
                {
                    "key": key,
                    "name": sup.DIMENSION_NAMES[key],
                    "classes": list(sup.CLASSES[key]),
                    "periods": bands[key],
                }
                for key in sup.DIMENSIONS
            ]
            if supervised
            else None
        ),
        "model": _summary(db, record, current_user, _active_id(db)),
        "instrument": _instrument(db, record.instrument_id),
        "start": points[0]["timestamp"],
        "end": points[-1]["timestamp"],
        "training_start": meta["training_start"],
        "training_end": meta["training_end"],
        "regimes": sorted(labels.values(), key=lambda label: label["code"]),
        "points": points,
        "periods": periods,
        "transitions": transitions,
    }
