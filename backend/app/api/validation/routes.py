"""Validation runs (Phase 11): POST to start one, GET to follow it and read its
report. A validation is stored as an execution of type VALIDATION and runs in
the same worker as backtests (one at a time). Cancel and delete it with
POST /executions/{id}/cancel and DELETE /executions/{id}."""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.backtesting import routes as backtest_routes
from app.api.executions.routes import _error
from app.config import settings
from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import ExecutionStatus, ExecutionType
from app.exceptions.backtesting_errors import build_backtest_error_payload
from app.models import MarketData, Strategy, User
from app.schemas.executions.response import ExecutionResponse
from app.schemas.validation.create import CreateValidationRequest
from app.schemas.validation.report import ValidationReport, ValidationSummary
from app.services.executions.execution_service import ExecutionService
from app.services.validation.eligibility import report_of as _report_dict
from app.services.validation.job import run_validation_job
from app.strategies.registry import StrategyRegistry
from app.validation import thresholds
from app.validation.pipeline import (
    MAX_GRID_COMBINATIONS,
    VALIDATION_VERSION,
    grid_candidates,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/validations", tags=["Validation"])


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=message)


def _bar_count(db: Session, request: CreateValidationRequest) -> int:
    query = select(func.count()).select_from(MarketData).where(
        MarketData.instrument_id == request.instrument_id,
        MarketData.timeframe == request.timeframe,
    )
    if request.start_timestamp is not None:
        query = query.where(MarketData.timestamp >= request.start_timestamp)
    if request.end_timestamp is not None:
        query = query.where(MarketData.timestamp <= request.end_timestamp)
    return int(db.scalar(query) or 0)


def _check_settings(db: Session, request: CreateValidationRequest, resolved) -> None:
    wf = request.walk_forward
    grid = wf.parameter_grid
    if grid:
        if resolved.rules is not None:
            raise _unprocessable(
                "A no-code strategy has no parameters to search; leave the parameter grid empty."
            )
        candidates = grid_candidates(grid)
        if len(candidates) > MAX_GRID_COMBINATIONS:
            raise _unprocessable(
                f"The parameter grid has {len(candidates)} combinations; at most "
                f"{MAX_GRID_COMBINATIONS} are allowed. Give fewer values."
            )
        if resolved.python_code is not None:
            # A Python strategy reads its parameters from context.params; any names
            # are allowed, so there is nothing to check against a template here.
            pass
        else:
            known = set(StrategyRegistry.definition(resolved.strategy_key).default_parameters)
            unknown = sorted(set(grid) - known)
            if unknown:
                raise _unprocessable(
                    f"{resolved.strategy_key} has no parameter named {', '.join(unknown)}."
                )
            for candidate in candidates:
                try:
                    StrategyRegistry.get(resolved.strategy_key, **{**resolved.parameters, **candidate})
                except (TypeError, ValueError) as exc:
                    values = ", ".join(f"{k} = {v}" for k, v in candidate.items())
                    raise _unprocessable(f"Grid values {values}: {exc}") from exc

    bars = _bar_count(db, request)
    span = wf.train_bars + wf.validation_bars + wf.test_bars
    step = wf.step_bars or wf.test_bars
    windows = (bars - span) // step + 1 if bars >= span else 0
    if windows < thresholds.WALK_FORWARD_MIN_WINDOWS:
        raise _unprocessable(
            f"Walk-forward needs at least {thresholds.WALK_FORWARD_MIN_WINDOWS} windows. "
            f"With {bars} daily bars, windows of {wf.train_bars} + {wf.validation_bars} + "
            f"{wf.test_bars} bars, moving {step} bars at a time, give {windows}. Shorten "
            "the windows or choose a longer date range."
        )
    if request.regimes.source == "model":
        from app.services.validation.model_regimes import resolve_model

        try:
            resolve_model(db, request.regimes.model_id)
        except ValueError as exc:
            raise _unprocessable(str(exc)) from exc
        return
    needed = request.regimes.trend_window + request.regimes.volatility_window
    if bars <= needed:
        raise _unprocessable(
            f"Regime stress needs more than {needed} daily bars (trend average of "
            f"{request.regimes.trend_window} days plus volatility of "
            f"{request.regimes.volatility_window} days); the range has {bars}."
        )


@router.post(
    "",
    response_model=ExecutionResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        409: {"description": "Another backtest or validation is running."},
        422: {"description": "The strategy, instruments or validation settings are not valid."},
    },
)
def create_validation(
    request: CreateValidationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resolved = backtest_routes.resolve_strategy_run(db, request, current_user)
    _check_settings(db, request, resolved)

    execution_service = ExecutionService(db)
    if request.source_execution_id is not None:
        source = execution_service.get_for_user(
            execution_id=request.source_execution_id, user_id=current_user.id
        )
        if source is None or source.execution_type != ExecutionType.BACKTEST:
            raise _unprocessable("source_execution_id is not one of your backtests.")

    walk_forward = request.walk_forward.model_dump()
    walk_forward["step_bars"] = walk_forward["step_bars"] or walk_forward["test_bars"]
    regimes = request.regimes.model_dump(mode="json")
    if request.regimes.source == "model":
        # The exact model is fixed now, so the report always names the one it used.
        from app.services.validation.model_regimes import model_reference, resolve_model

        record = resolve_model(db, request.regimes.model_id)
        regimes["model_id"] = str(record.id)
        regimes["model"] = model_reference(db, record)
    run_settings = {
        **backtest_routes.base_run_settings(request, resolved),
        "walk_forward": walk_forward,
        "regimes": regimes,
        "monte_carlo": request.monte_carlo.model_dump(),
        "source_execution_id": (
            str(request.source_execution_id) if request.source_execution_id else None
        ),
        "validation_version": VALIDATION_VERSION,
    }
    run_options = {
        "other_instrument_ids": run_settings["other_instrument_ids"],
        "slippage_bps": run_settings["slippage_bps"],
        "brokerage_rate": run_settings["brokerage_rate"],
        "walk_forward": walk_forward,
        "regimes": run_settings["regimes"],
        "monte_carlo": run_settings["monte_carlo"],
    }

    with backtest_routes._submit_lock:
        executor = backtest_routes._executor
        if not executor.has_capacity():
            raise HTTPException(status_code=409, detail=backtest_routes.BUSY_MESSAGE)

        execution = execution_service.create_execution(
            strategy_id=request.strategy_id,
            broker_account_id=None,
            instrument_id=request.instrument_id,
            execution_type=ExecutionType.VALIDATION,
            status=ExecutionStatus.PENDING,
            timeframe=request.timeframe.value,
            initial_capital=request.initial_capital,
            execution_config=resolved.parameters,
            run_settings=run_settings,
        )
        try:
            executor.submit(
                execution_id=execution.id,
                strategy_key=resolved.strategy_key,
                strategy_config=backtest_routes.worker_config(resolved),
                start_timestamp=request.start_timestamp,
                end_timestamp=request.end_timestamp,
                quantity=request.quantity,
                worker_target=run_validation_job,
                run_options=run_options,
                timeout_seconds=settings.validation_timeout_seconds,
            )
        except Exception as exc:
            logger.exception("Validation submission failed: execution_id=%s", execution.id)
            try:
                execution_service.fail_execution(
                    execution=execution,
                    error_message=str(exc) or type(exc).__name__,
                    error_details=build_backtest_error_payload(
                        exc,
                        execution_id=execution.id,
                        stage="worker_submission",
                        context="worker_submission",
                    ),
                )
            except Exception:
                logger.exception("Could not store the submission failure: %s", execution.id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to submit the validation job.",
            ) from exc

    return backtest_routes._to_response(execution)


def _summary_fields(execution, strategy: Strategy | None, report: dict) -> dict:
    rs = execution.run_settings if isinstance(execution.run_settings, dict) else {}
    return {
        "id": execution.id,
        "status": execution.status,
        "strategy_id": execution.strategy_id,
        "strategy_name": strategy.name if strategy else None,
        "instrument_id": execution.instrument_id,
        "created_at": execution.created_at,
        "started_at": execution.started_at,
        "completed_at": execution.completed_at,
        "verdict": report["verdict"],
        "stage_statuses": {key: stage["status"] for key, stage in report["stages"].items()},
        "source_execution_id": rs.get("source_execution_id"),
        "error": _error(execution),
    }


def _get_validation(db: Session, execution_id: UUID, user: User):
    execution = ExecutionService(db).get_for_user(execution_id=execution_id, user_id=user.id)
    if execution is None or execution.execution_type != ExecutionType.VALIDATION:
        raise HTTPException(status_code=404, detail="Validation not found.")
    return execution


@router.get("", response_model=list[ValidationSummary])
def list_validations(
    strategy_id: UUID | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The current user's validation runs, newest first, with their verdicts."""
    executions = ExecutionService(db).list_for_user(
        user_id=current_user.id,
        execution_type=ExecutionType.VALIDATION,
        strategy_id=strategy_id,
        limit=limit,
    )
    strategies = {
        s.id: s
        for s in db.scalars(
            select(Strategy).where(Strategy.id.in_({e.strategy_id for e in executions}))
        ).all()
    } if executions else {}
    return [
        _summary_fields(e, strategies.get(e.strategy_id), _report_dict(e)) for e in executions
    ]


@router.get("/{execution_id}", response_model=ValidationReport)
def get_validation(
    execution_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The validation's stages, checks, thresholds and configuration. While it runs,
    the stages that have finished are already filled in."""
    execution = _get_validation(db, execution_id, current_user)
    strategy = db.get(Strategy, execution.strategy_id)
    report = _report_dict(execution)
    rs = execution.run_settings if isinstance(execution.run_settings, dict) else {}
    metrics = execution.execution_metrics if isinstance(execution.execution_metrics, dict) else {}
    return {
        **_summary_fields(execution, strategy, report),
        "configuration": {
            "strategy_id": execution.strategy_id,
            "strategy_name": strategy.name if strategy else None,
            "strategy_key": rs.get("strategy_key"),
            "strategy_version": rs.get("strategy_version"),
            "current_strategy_version": strategy.version if strategy else None,
            "parameters": execution.execution_config or {},
            "rules": rs.get("rules"),
            "instrument_ids": [str(execution.instrument_id)] + list(rs.get("other_instrument_ids") or []),
            "timeframe": execution.timeframe,
            "initial_capital": float(execution.initial_capital),
            "quantity": rs.get("quantity"),
            "slippage_bps": rs.get("slippage_bps"),
            "brokerage_rate": rs.get("brokerage_rate"),
            "requested_start": rs.get("start_timestamp"),
            "requested_end": rs.get("end_timestamp"),
            "walk_forward": rs.get("walk_forward") or {},
            "regimes": rs.get("regimes") or {},
            "monte_carlo": rs.get("monte_carlo") or {},
            "engine_version": rs.get("engine_version"),
            "validation_version": rs.get("validation_version"),
            "source_execution_id": rs.get("source_execution_id"),
        },
        "stages": report["stages"],
        "thresholds": thresholds.definitions(),
        "thresholds_source": report.get("thresholds_source", thresholds.SOURCE),
        "basis": report.get("basis", []),
        "data_provenance": metrics.get("data_provenance"),
        "bars": metrics.get("bars"),
    }
