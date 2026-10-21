"""Market-regime models (Phase 12, Feature 2): train one from the website, and
classify the reference instrument's days with the active model.

- GMM (Phase 12): app.ml features, chronological split, Gaussian mixture chosen
  by validation BIC. Classification describes each day's recent behaviour.
- RF / XGB / AUTO (Feature 2): app.ml.supervised. Three classifiers predict the
  volatility, trend and risk sentiment of the next `horizon_days` trading days
  from features known that day; the test-split accuracy is stored with the model.

The fitted model is stored in the regime_models table.
"""

from __future__ import annotations

import logging
import tempfile
import threading
from datetime import date, datetime, time, timezone
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.data.loaders import MarketDatasetLoader
from app.db import SessionLocal
from app.enums import Timeframe
from app.ml.dataset import prepare_regime_dataset
from app.ml.features import FEATURE_COLUMNS, generate_regime_features
from app.ml.labels import name_regimes
from app.ml.model import RegimeModel, predict_regimes, train_regime_model
from app.ml import supervised as sup
from app.ml.persistence import MODEL_VERSION, load_regime_model, save_regime_model
from app.ml.supervised_persistence import (
    MODEL_VERSION as SUPERVISED_VERSION,
    load_supervised_model,
    save_supervised_model,
    xgboost_version,
)
from app.models import RegimeModelRecord

logger = logging.getLogger(__name__)

# Dates on the page are Indian market days.
IST = ZoneInfo("Asia/Kolkata")

TRAINING = "TRAINING"
READY = "READY"
FAILED = "FAILED"

MODEL_TYPE = "Gaussian mixture (scikit-learn GaussianMixture, full covariance)"
MODEL_KINDS = ("GMM", "RF", "XGB", "AUTO")
SUPERVISED_TYPES = {
    "RF": "Random Forest (scikit-learn RandomForestClassifier), one per dimension",
    "XGB": "XGBoost (XGBClassifier), one per dimension",
    "AUTO": "Random Forest or XGBoost per dimension, the better on the validation split",
}
VOLUME_NOTE = {
    True: "The index's volume is used (a 60-day z-score of log volume).",
    False: (
        "Volume is not used: fewer than 80% of the reference's stored bars have volume "
        "(Yahoo reports none for some indices), or it never changes."
    ),
}
COMBINED_RULE = (
    "The combined regime is the three dimensions' predicted classes together. Codes: "
    "HV / LV volatility, UP / SW / DN trend, ON / OFF risk. Training days and share "
    "count the actual classes of the training days."
)
SPLIT = {"train": 0.70, "validation": 0.15, "test": 0.15}
N_INIT = 5

FEATURES = {
    "log_return": "Daily log return of the close.",
    "realized_volatility": "Standard deviation of daily log returns over the volatility window.",
    "trend_strength": "Mean daily log return over the trend window divided by its standard deviation.",
}

LOST_MESSAGE = "The server restarted while this model was training."

# One training at a time (checked and started under this lock).
training_lock = threading.Lock()

_cache: dict[UUID, object] = {}
_cache_lock = threading.Lock()


def _iso(value) -> str:
    return pd.Timestamp(value).isoformat()


def day_bounds(start: date | None, end: date | None) -> tuple[datetime | None, datetime | None]:
    """The first and last moment of the given IST days."""
    return (
        datetime.combine(start, time.min, tzinfo=IST) if start else None,
        datetime.combine(end, time.max, tzinfo=IST) if end else None,
    )


def load_closes(db: Session, instrument_id: UUID, start: date | None = None, end: date | None = None):
    """Stored daily bars of the instrument (all of them unless dates are given)."""
    first, last = day_bounds(start, end)
    return MarketDatasetLoader(db).load(
        instrument_id=instrument_id,
        frequency=Timeframe.ONE_DAY,
        start_timestamp=first,
        end_timestamp=last,
    )


def is_supervised(record: RegimeModelRecord) -> bool:
    return (record.model_kind or "GMM") != "GMM"


def model_version_for(kind: str) -> str:
    return MODEL_VERSION if kind == "GMM" else SUPERVISED_VERSION


def align_to(index: pd.DatetimeIndex, other: pd.DataFrame | None) -> pd.Series | None:
    """Another instrument's closes on the reference's days (same IST date; a missing
    day keeps the last known close for at most 3 days, so only the past is used)."""
    if other is None or other.empty:
        return None
    by_day = pd.Series(
        other["close"].to_numpy(dtype=float),
        index=pd.DatetimeIndex(other.index).tz_convert(IST).normalize(),
    )
    by_day = by_day[~by_day.index.duplicated(keep="last")]
    days = pd.DatetimeIndex(index).tz_convert(IST).normalize()
    union = by_day.index.union(days)
    aligned = by_day.reindex(union).ffill(limit=3).reindex(days)
    return pd.Series(aligned.to_numpy(), index=index)


def next_number(db: Session) -> int:
    return int(db.scalar(select(func.coalesce(func.max(RegimeModelRecord.number), 0)))) + 1


def active_model(db: Session) -> RegimeModelRecord | None:
    """The newest READY model."""
    return db.scalars(
        select(RegimeModelRecord)
        .where(RegimeModelRecord.status == READY)
        .order_by(RegimeModelRecord.number.desc())
        .limit(1)
    ).first()


def training_model(db: Session) -> RegimeModelRecord | None:
    return db.scalars(
        select(RegimeModelRecord).where(RegimeModelRecord.status == TRAINING).limit(1)
    ).first()


def train_model(record_id: UUID) -> None:
    """Background task: train, name the clusters and store the model."""
    db = SessionLocal()
    try:
        record = db.get(RegimeModelRecord, record_id)
        if record is None or record.status != TRAINING:
            return
        record.started_at = datetime.now(timezone.utc)
        db.commit()
        evaluation = label_definition = None
        try:
            if is_supervised(record):
                metadata, artifact = _fit_supervised(db, record)
                evaluation = metadata["evaluation"]
                label_definition = metadata["label_definition"]
            else:
                metadata, artifact = _fit(db, record)
        except Exception as exc:  # stored on the model, shown on the page
            logger.exception("Regime model training failed: %s", record_id)
            db.rollback()
            record = db.get(RegimeModelRecord, record_id)
            record.status = FAILED
            record.error_message = str(exc) or type(exc).__name__
            record.completed_at = datetime.now(timezone.utc)
            db.commit()
            return
        record.model_metadata = metadata
        record.artifact = artifact
        record.evaluation = evaluation
        record.label_definition = label_definition
        record.status = READY
        record.completed_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


def _fit(db: Session, record: RegimeModelRecord) -> tuple[dict, bytes]:
    settings = record.settings
    if record.instrument_id is None:
        raise ValueError("The reference instrument no longer exists.")
    dataset = load_closes(
        db,
        record.instrument_id,
        date.fromisoformat(settings["start_date"]) if settings.get("start_date") else None,
        date.fromisoformat(settings["end_date"]) if settings.get("end_date") else None,
    )
    data = dataset.ohlcv
    if data is None or data.empty:
        raise ValueError("No stored daily bars for the reference instrument in this range.")

    prepared = prepare_regime_dataset(
        data,
        train_ratio=SPLIT["train"],
        validation_ratio=SPLIT["validation"],
        test_ratio=SPLIT["test"],
        volatility_window=settings["volatility_window"],
        trend_window=settings["trend_window"],
    )
    model, evaluation = train_regime_model(
        prepared,
        candidate_components=tuple(settings["candidate_components"]),
        random_state=settings["random_state"],
        n_init=N_INIT,
    )
    labels = name_regimes(model, prepared.features.train)

    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "regime_model.joblib"
        saved = save_regime_model(
            model,
            evaluation,
            path,
            training_start=_iso(prepared.training_start),
            training_end=_iso(prepared.training_end),
            model_version=MODEL_VERSION,
            feature_parameters={
                "volatility_window": settings["volatility_window"],
                "trend_window": settings["trend_window"],
            },
        )
        artifact = path.read_bytes()

    split = prepared.features
    provenance = dataset.metadata if isinstance(dataset.metadata, dict) else {}
    metadata = {
        **saved,
        "model_type": MODEL_TYPE,
        "candidate_components": list(settings["candidate_components"]),
        "selection": "The candidate cluster count with the lowest BIC on the validation split.",
        "features": [{"name": name, "description": FEATURES[name]} for name in FEATURE_COLUMNS],
        "labels": labels,
        "dataset": {
            "bars": len(data),
            "first_bar": _iso(data.index[0]),
            "last_bar": _iso(data.index[-1]),
            "dropped_warm_up_rows": prepared.dropped_warmup_rows,
            "ratios": SPLIT,
            "splits": [
                {
                    "name": name,
                    "rows": len(frame),
                    "start": _iso(frame.index[0]),
                    "end": _iso(frame.index[-1]),
                }
                for name, frame in (
                    ("train", split.train),
                    ("validation", split.validation),
                    ("test", split.test),
                )
            ],
            "data_fingerprint": provenance.get("data_fingerprint"),
            "provider": provenance.get("provider"),
        },
    }
    return metadata, artifact


def _fit_supervised(db: Session, record: RegimeModelRecord) -> tuple[dict, bytes]:
    settings = record.settings
    if record.instrument_id is None:
        raise ValueError("The reference instrument no longer exists.")
    start = date.fromisoformat(settings["start_date"]) if settings.get("start_date") else None
    end = date.fromisoformat(settings["end_date"]) if settings.get("end_date") else None
    dataset = load_closes(db, record.instrument_id, start, end)
    data = dataset.ohlcv
    if data is None or data.empty:
        raise ValueError("No stored daily bars for the reference instrument in this range.")
    vix_data = None
    if settings.get("vix_instrument_id"):
        if record.vix_instrument_id is None:
            raise ValueError("The India VIX instrument no longer exists.")
        vix_data = load_closes(db, record.vix_instrument_id, start, end).ohlcv
        if vix_data is None or vix_data.empty:
            raise ValueError("No stored daily bars for the India VIX instrument in this range.")
    vix = align_to(data.index, vix_data)

    prepared = sup.prepare_dataset(data, vix, horizon=settings["horizon_days"])
    model, evaluation = sup.train_supervised(
        prepared, model_kind=record.model_kind, random_state=settings["random_state"]
    )

    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "regime_model.joblib"
        saved = save_supervised_model(
            model,
            path,
            training_start=_iso(prepared.train[0]),
            training_end=_iso(prepared.train[-1]),
        )
        artifact = path.read_bytes()

    horizon = prepared.horizon
    train_labels = prepared.labels.loc[prepared.train]
    regimes = []
    for combo in sup.combos():
        days = int(
            (
                (train_labels["volatility"] == combo["volatility_state"])
                & (train_labels["trend"] == combo["trend_state"])
                & (train_labels["risk"] == combo["risk_state"])
            ).sum()
        )
        regimes.append({**combo, "training_days": days, "training_share": days / len(train_labels)})
    label_definition = {
        "horizon_days": horizon,
        "volatility_threshold": prepared.volatility_threshold,
        "trend_threshold": sup.TREND_THRESHOLD,
        "drawdown_threshold": sup.DRAWDOWN_THRESHOLD,
        "uses_vix": prepared.use_vix,
        "vix_median_window": sup.VIX_MEDIAN_WINDOW,
        "rules": sup.label_rules(
            horizon,
            volatility_threshold=prepared.volatility_threshold,
            trend_threshold=sup.TREND_THRESHOLD,
            drawdown_threshold=sup.DRAWDOWN_THRESHOLD,
            uses_vix=prepared.use_vix,
        ),
    }

    def window_end(rows) -> str:
        last = int(prepared.positions[rows[-1]]) + horizon
        return _iso(data.index[min(last, len(data.index) - 1)])

    provenance = dataset.metadata if isinstance(dataset.metadata, dict) else {}
    metadata = {
        **saved,
        "model_type": SUPERVISED_TYPES[record.model_kind],
        "selection": evaluation["selection"],
        "features": [
            {"name": name, "description": sup.FEATURE_DESCRIPTIONS[name]} for name in model.feature_columns
        ],
        "labels": {"rule": COMBINED_RULE, "regimes": regimes},
        "label_definition": label_definition,
        "evaluation": evaluation,
        "uses_volume": prepared.use_volume,
        "volume_note": VOLUME_NOTE[prepared.use_volume],
        "xgboost_version": xgboost_version(),
        "dataset": {
            "bars": len(data),
            "first_bar": _iso(data.index[0]),
            "last_bar": _iso(data.index[-1]),
            "dropped_warm_up_rows": prepared.warm_up_rows,
            "unlabelled_rows": prepared.unlabelled_rows,
            "vix_bars": None if vix_data is None else len(vix_data),
            "ratios": sup.SPLIT,
            "splits": [
                {
                    "name": name,
                    "rows": len(rows),
                    "start": _iso(rows[0]),
                    "end": _iso(rows[-1]),
                    "label_window_end": window_end(rows),
                }
                for name, rows in (
                    ("train", prepared.train),
                    ("validation", prepared.validation),
                    ("test", prepared.test),
                )
            ],
            "purges": prepared.purges,
            "data_fingerprint": provenance.get("data_fingerprint"),
            "provider": provenance.get("provider"),
        },
    }
    return metadata, artifact


def fitted_model(record: RegimeModelRecord):
    """The stored model, loaded once per process."""
    with _cache_lock:
        if record.id in _cache:
            return _cache[record.id]
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "regime_model.joblib"
        path.write_bytes(record.artifact)
        if is_supervised(record):
            model, _ = load_supervised_model(path)
        else:
            model, _ = load_regime_model(path, expected_model_version=record.model_version)
    with _cache_lock:
        _cache[record.id] = model
    return model


def classify_stored(db: Session, record: RegimeModelRecord) -> tuple[pd.DataFrame, pd.DataFrame]:
    """The reference instrument's stored bars and the model's classification of them.
    ValueError says why it cannot be done (shown to the user)."""
    if record.instrument_id is None:
        raise ValueError("The model's reference instrument no longer exists.")
    data = load_closes(db, record.instrument_id).ohlcv
    if data is None or data.empty:
        raise ValueError("The reference instrument has no stored daily bars.")
    vix = None
    if is_supervised(record) and record.settings.get("vix_instrument_id"):
        if record.vix_instrument_id is None:
            raise ValueError("The model's India VIX instrument no longer exists.")
        vix = align_to(data.index, load_closes(db, record.vix_instrument_id).ohlcv)
        if vix is None:
            raise ValueError("The India VIX instrument has no stored daily bars.")
    return data, classify(record, data, vix)


def classify(record: RegimeModelRecord, data: pd.DataFrame, vix: pd.Series | None = None) -> pd.DataFrame:
    """Regime, confidence and probabilities of every day that has complete features.

    Features only use each day's past, so a day's regime does not depend on later
    prices. A supervised model's regime of a day is its classification of the
    next horizon_days days, made with what was known that day.
    """
    if is_supervised(record):
        model = fitted_model(record)
        if model.use_vix and vix is None:
            raise ValueError("This model needs the India VIX instrument's closes.")
        features = sup.generate_features(data, vix if model.use_vix else None, use_volume=model.use_volume)
        features = features.loc[:, list(model.feature_columns)].dropna(axis=0, how="any")
        if features.empty:
            return pd.DataFrame(columns=["regime_id", "confidence"])
        return sup.predict_supervised(model, features)
    parameters = record.model_metadata["feature_parameters"]
    features = generate_regime_features(
        data,
        volatility_window=parameters["volatility_window"],
        trend_window=parameters["trend_window"],
    ).dropna(axis=0, how="any")
    if features.empty:
        return pd.DataFrame(columns=["regime_id", "confidence"])
    return predict_regimes(fitted_model(record), features)


def fail_stranded_training() -> int:
    """On startup: a model left TRAINING belonged to the previous server process."""
    db = SessionLocal()
    try:
        stranded = list(
            db.scalars(select(RegimeModelRecord).where(RegimeModelRecord.status == TRAINING)).all()
        )
        for record in stranded:
            record.status = FAILED
            record.error_message = LOST_MESSAGE
            record.completed_at = datetime.now(timezone.utc)
        db.commit()
        return len(stranded)
    finally:
        db.close()
