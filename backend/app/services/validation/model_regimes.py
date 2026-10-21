"""Feature 3: the market regime model as the source of validation stage 3.

The validation job loads the chosen model's classification of its reference
instrument (the same code as GET /regime/history) and the pipeline splits the
backtest's days by it. The model is resolved when the validation is submitted,
so the report always names the exact model it used.
"""

from __future__ import annotations

from uuid import UUID

import pandas as pd
from sqlalchemy.orm import Session

from app.ml import supervised as sup
from app.models import Instrument, RegimeModelRecord
from app.services.regime import service as regime
from app.validation.pipeline import ModelRegimes

KIND_NAMES = {**sup.KIND_NAMES, "GMM": "Gaussian mixture"}
NO_MODEL = "No regime model has been trained yet. Train one on the Market Regime page first."


def resolve_model(db: Session, model_id: UUID | None) -> RegimeModelRecord:
    """The chosen READY model, or the active one. ValueError says why it cannot be used."""
    if model_id is None:
        record = regime.active_model(db)
        if record is None:
            raise ValueError(NO_MODEL)
        return record
    record = db.get(RegimeModelRecord, model_id)
    if record is None:
        raise ValueError("This regime model does not exist.")
    if record.status != regime.READY:
        raise ValueError(f"Model {record.number} is not ready (it is {record.status.lower()}).")
    return record


def model_reference(db: Session, record: RegimeModelRecord) -> dict:
    """What the report records about the model, so the result can be reproduced."""
    meta = record.model_metadata or {}
    splits = {s["name"]: s for s in (meta.get("dataset") or {}).get("splits", [])}
    instrument = db.get(Instrument, record.instrument_id) if record.instrument_id else None
    kind = record.model_kind or "GMM"
    return {
        "id": str(record.id),
        "number": record.number,
        "name": f"Model {record.number}",
        "kind": kind,
        "kind_name": KIND_NAMES[kind],
        "version": record.model_version,
        "training_start": meta.get("training_start"),
        "training_end": meta.get("training_end"),
        # A supervised model's training labels look ahead: it has seen prices up to
        # the training split's label window end.
        "in_sample_end": (splits.get("train") or {}).get("label_window_end") or meta.get("training_end"),
        "instrument_id": str(record.instrument_id) if record.instrument_id else None,
        "instrument_symbol": instrument.symbol if instrument else None,
        "horizon_days": record.settings.get("horizon_days") if kind != "GMM" else None,
        "random_state": record.settings.get("random_state"),
    }


def load_model_regimes(db: Session, model_id: UUID) -> ModelRegimes:
    """The model's classification of every reference day, by IST date."""
    record = resolve_model(db, model_id)
    reference = model_reference(db, record)
    data, classified = regime.classify_stored(db, record)
    supervised = regime.is_supervised(record)
    ist = lambda ts: pd.Timestamp(ts).tz_convert(regime.IST).date()  # noqa: E731
    days = {}
    for timestamp, row in classified.iterrows():
        days[ist(timestamp)] = {
            "regime_id": int(row["regime_id"]),
            "dimensions": (
                {key: row[f"{key}_label"] for key in sup.DIMENSIONS} if supervised else None
            ),
        }
    return ModelRegimes(
        model=reference,
        labels=[
            {
                "regime_id": r["regime_id"],
                "code": r["code"],
                "name": r["name"],
            }
            for r in record.model_metadata["labels"]["regimes"]
        ],
        days=days,
        reference_days={ist(t) for t in data.index},
        dimensions=(
            [
                {"key": key, "name": sup.DIMENSION_NAMES[key], "classes": list(sup.CLASSES[key])}
                for key in sup.DIMENSIONS
            ]
            if supervised
            else None
        ),
    )
