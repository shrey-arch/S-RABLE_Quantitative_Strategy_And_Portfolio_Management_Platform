"""Multi-factor scoring of the user's strategies (Phase 13).

Each saved strategy made from a core template is scored on the instruments of
its latest completed backtest, from their stored daily closes up to the last
stored bar (app.ml.factors). The composite score and each factor's share of it
come from app.ml.scoring. Regime compatibility uses the documented rule table
(app.ml.factor_definitions) and the active regime model (Phase 12); it never
changes a score. Nothing here is stored.
"""

from __future__ import annotations

from collections.abc import Mapping
from uuid import UUID

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import ExecutionStatus, ExecutionType
from app.ml.factor_definitions import FACTORS, regime_compatibility
from app.ml.factors import calculate_strategy_factors
from app.ml.result_factors import result_score
from app.ml.scoring import (
    DEFAULT_STRATEGY_WEIGHTS,
    STRATEGY_FACTORS,
    calculate_composite_score,
    score_breakdown,
    validate_strategy_weights,
)
from app.models import Execution, Instrument, Strategy
from app.services.backtesting.backtest_service import BacktestService
from app.services.regime import service as regime_service
from app.services.validation.eligibility import validation_statuses
from app.strategies.factory import PYTHON_KEY

NO_BACKTEST = "No completed backtest yet. Backtest it to score it."
NOT_A_TEMPLATE = (
    "Only strategies made from the five core templates have a factor model; "
    "no-code rules are not scored."
)


def _run_metrics(run) -> dict:
    """The metrics a completed backtest stored (canonical result, else the summary)."""
    stored = run.execution_metrics if isinstance(run.execution_metrics, dict) else {}
    canonical = stored.get("canonical_result")
    if isinstance(canonical, dict) and isinstance(canonical.get("metrics"), dict):
        return canonical["metrics"]
    return {
        "total_return": stored.get("total_return"),
        "max_drawdown": stored.get("max_drawdown"),
        "trade_count": stored.get("trade_count"),
        "sharpe_ratio": None,
    }


def resolve_weights(custom: Mapping[str, Mapping[str, float]] | None) -> dict[str, dict[str, float]]:
    """Default weights, with any custom ones validated and put in their place."""
    weights = {key: dict(value) for key, value in DEFAULT_STRATEGY_WEIGHTS.items()}
    for key, value in (custom or {}).items():
        if key not in STRATEGY_FACTORS:
            raise ValueError(f"{key} is not a core strategy with factors.")
        try:
            weights[key] = dict(validate_strategy_weights(key, value))
        except ValueError as exc:
            raise ValueError(f"Weights for {key}: {exc}") from exc
    return weights


def current_regime(db: Session) -> dict | None:
    """The active regime model's regime on its reference instrument's last bar."""
    record = regime_service.active_model(db)
    if record is None or record.instrument_id is None:
        return None
    try:
        _, classified = regime_service.classify_stored(db, record)
    except ValueError:
        return None
    if classified.empty:
        return None
    last = classified.iloc[-1]
    labels = {row["regime_id"]: row for row in record.model_metadata["labels"]["regimes"]}
    label = labels[int(last["regime_id"])]
    instrument = db.get(Instrument, record.instrument_id)
    return {
        "model_number": record.number,
        "model_version": record.model_version,
        "instrument_symbol": instrument.symbol if instrument else None,
        "as_of": pd.Timestamp(classified.index[-1]).isoformat(),
        "code": label["code"],
        "name": label["name"],
        "volatility_state": label["volatility_state"],
        "trend_state": label["trend_state"],
        "confidence": float(last["confidence"]),
    }


def latest_backtests(db: Session, strategy_ids: list[UUID]) -> dict[UUID, Execution]:
    """The latest completed backtest of each strategy."""
    if not strategy_ids:
        return {}
    runs = db.scalars(
        select(Execution)
        .where(
            Execution.strategy_id.in_(strategy_ids),
            Execution.execution_type == ExecutionType.BACKTEST,
            Execution.status == ExecutionStatus.COMPLETED,
        )
        .order_by(Execution.completed_at.desc(), Execution.created_at.desc())
    ).all()
    latest: dict[UUID, Execution] = {}
    for run in runs:
        latest.setdefault(run.strategy_id, run)
    return latest


class _Data:
    """Stored daily bars, loaded once per instrument per request."""

    def __init__(self, db: Session):
        self.db = db
        self.datasets: dict[UUID, object] = {}

    def dataset(self, instrument_id: UUID):
        if instrument_id not in self.datasets:
            self.datasets[instrument_id] = regime_service.load_closes(self.db, instrument_id)
        return self.datasets[instrument_id]

    def frame(self, strategy_key: str, instrument_ids: list[UUID]) -> pd.DataFrame:
        if strategy_key == "statistical_arbitrage":
            if len(instrument_ids) < 2:
                raise ValueError("The backtest has no second instrument (B).")
            frame, _ = BacktestService.combine_closes(
                [self.dataset(i) for i in instrument_ids[:2]], "pair"
            )
            return frame
        data = self.dataset(instrument_ids[0]).ohlcv
        if data is None or data.empty:
            raise ValueError("The instrument has no stored daily bars.")
        return data


def _instruments(db: Session, ids: list[UUID]) -> list[dict]:
    out = []
    for instrument_id in ids:
        instrument = db.get(Instrument, instrument_id)
        out.append(
            {
                "id": instrument_id,
                "symbol": instrument.symbol if instrument else None,
            }
        )
    return out


def score_strategies(
    db: Session,
    user_id: UUID,
    custom_weights: Mapping[str, Mapping[str, float]] | None = None,
) -> dict:
    weights = resolve_weights(custom_weights)
    strategies = db.scalars(
        select(Strategy).where(Strategy.user_id == user_id).order_by(Strategy.name, Strategy.id)
    ).all()
    latest = latest_backtests(db, [s.id for s in strategies])
    validations = validation_statuses(db, strategies)
    regime = current_regime(db)
    data = _Data(db)

    rows = []
    for strategy in strategies:
        row = {
            "strategy_id": strategy.id,
            "name": strategy.name,
            "strategy_type": strategy.strategy_type,
            "version": strategy.version,
            "is_active": strategy.is_active,
            "status": "UNSCORED",
            "reason": None,
            # Feature 6: "factor_model" for a template, "backtest_results" for Python.
            "basis": "factor_model",
            "strategy_key": None,
            "rank": None,
            "composite_score": None,
            "factors": [],
            "as_of": None,
            "instruments": [],
            "source_execution_id": None,
            "source_completed_at": None,
            "regime_compatibility": None,
            # Feature 5: only validated strategies are eligible for capital.
            "validation": validations[strategy.id],
        }
        rows.append(row)
        run = latest.get(strategy.id)
        if run is None:
            row["reason"] = NO_BACKTEST
            continue
        settings = run.run_settings if isinstance(run.run_settings, dict) else {}
        key = settings.get("strategy_key")
        ids = [run.instrument_id] + [UUID(str(i)) for i in settings.get("other_instrument_ids") or []]
        row.update(
            strategy_key=key,
            source_execution_id=run.id,
            source_completed_at=run.completed_at,
            instruments=_instruments(db, ids),
        )
        if key == PYTHON_KEY:
            # Feature 6: custom Python code has no factor model, so it is scored on
            # what its latest backtest actually did (app.ml.result_factors).
            metrics = _run_metrics(run)
            try:
                composite, parts = result_score(metrics)
            except ValueError as exc:
                row["reason"] = str(exc)
                continue
            row.update(
                status="SCORED",
                basis="backtest_results",
                composite_score=composite,
                factors=parts,
                as_of=run.completed_at.isoformat() if run.completed_at else None,
            )
            continue
        if key not in STRATEGY_FACTORS:
            row["reason"] = NOT_A_TEMPLATE
            continue
        try:
            frame = data.frame(key, ids)
            raw: dict[str, float] = {}
            factors = calculate_strategy_factors(key, frame, raw_values=raw)
        except ValueError as exc:
            row["reason"] = f"The factors could not be computed: {exc}"
            continue

        parts = score_breakdown(key, factors, weights[key])
        row.update(
            status="SCORED",
            composite_score=calculate_composite_score(key, factors, weights[key]),
            factors=[
                {**part, "label": FACTORS[part["factor"]]["label"], "raw": raw[part["factor"]]}
                for part in parts
            ],
            as_of=pd.Timestamp(frame.index[-1]).isoformat(),
            regime_compatibility=regime_compatibility(key, regime),
        )

    scored = sorted(
        (r for r in rows if r["status"] == "SCORED"),
        key=lambda r: (-r["composite_score"], r["name"], str(r["strategy_id"])),
    )
    for rank, row in enumerate(scored, start=1):
        row["rank"] = rank
    unscored = [r for r in rows if r["status"] != "SCORED"]
    return {
        "regime": regime,
        "weights": weights,
        "custom_weights": bool(custom_weights),
        "rows": scored + unscored,
    }
