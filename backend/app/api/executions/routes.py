from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import ExecutionStatus, ExecutionType, Timeframe
from app.models import MarketData, Strategy, User
from app.schemas.executions.response import ExecutionErrorInfo, ExecutionResponse
from app.schemas.executions.results import ExecutionResultsResponse
from app.services.backtesting import results_analytics
from app.services.backtesting.executor_instance import backtest_executor
from app.services.executions.execution_service import ExecutionService

# Executions are read, cancelled and deleted here, only by the owner of the
# strategy they ran. Creating them is POST /backtests; start, complete and fail
# are done by the backtest worker itself and are not API actions.
router = APIRouter(
    prefix="/executions",
    tags=["Executions"],
)

TERMINAL = {
    ExecutionStatus.COMPLETED,
    ExecutionStatus.FAILED,
    ExecutionStatus.CANCELLED,
}


def _error(execution) -> ExecutionErrorInfo | None:
    metrics = execution.execution_metrics if isinstance(execution.execution_metrics, dict) else {}
    details = metrics.get("error") if isinstance(metrics.get("error"), dict) else None
    if details is None and not execution.error_message:
        return None
    details = details or {}
    strategy_error = details.get("strategy_error")
    return ExecutionErrorInfo(
        category=details.get("category"),
        code=details.get("code"),
        message=details.get("message") or execution.error_message,
        stage=details.get("stage"),
        strategy_error=strategy_error if isinstance(strategy_error, dict) else None,
    )


def _to_response(execution) -> ExecutionResponse:
    run_settings = getattr(execution, "run_settings", None)
    return ExecutionResponse(
        id=execution.id,
        strategy_id=execution.strategy_id,
        broker_account_id=execution.broker_account_id,
        instrument_id=execution.instrument_id,
        execution_type=execution.execution_type,
        status=execution.status,
        timeframe=execution.timeframe,
        initial_capital=execution.initial_capital,
        execution_config=execution.execution_config,
        execution_metrics=execution.execution_metrics,
        run_settings=run_settings if isinstance(run_settings, dict) else None,
        error_message=execution.error_message,
        error=_error(execution),
        started_at=execution.started_at,
        completed_at=execution.completed_at,
        created_at=execution.created_at,
        updated_at=execution.updated_at,
    )


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Execution not found.",
    )


@router.get(
    "",
    response_model=list[ExecutionResponse],
)
def list_executions(
    status_filter: ExecutionStatus | None = Query(default=None, alias="status"),
    execution_type: ExecutionType | None = None,
    strategy_id: UUID | None = None,
    instrument_id: UUID | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The current user's executions, newest first."""
    executions = ExecutionService(db).list_for_user(
        user_id=current_user.id,
        status=status_filter,
        execution_type=execution_type,
        strategy_id=strategy_id,
        instrument_id=instrument_id,
        created_from=created_from,
        created_to=created_to,
        limit=limit,
    )
    return [_to_response(execution) for execution in executions]


@router.get(
    "/{execution_id}",
    response_model=ExecutionResponse,
)
def get_execution(
    execution_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    execution = ExecutionService(db).get_for_user(
        execution_id=execution_id,
        user_id=current_user.id,
    )
    if not execution:
        raise _not_found()
    return _to_response(execution)


def _closes(db: Session, instrument_ids: list[str], timeframe: str, first: str, last: str):
    """Stored closes of each instrument between the run's first and last bar,
    keyed by the same ISO timestamps the equity curve uses."""
    start = datetime.fromisoformat(first)
    end = datetime.fromisoformat(last)
    closes: dict[str, dict[str, float]] = {}
    for instrument_id in instrument_ids:
        rows = db.execute(
            select(MarketData.timestamp, MarketData.close).where(
                MarketData.instrument_id == UUID(instrument_id),
                MarketData.timeframe == Timeframe(timeframe),
                MarketData.timestamp >= start,
                MarketData.timestamp <= end,
            )
        ).all()
        by_time: dict[str, float] = {}
        for timestamp, close in rows:
            by_time[timestamp.isoformat()] = float(close)
            by_time[timestamp.astimezone(start.tzinfo).isoformat()] = float(close)
        closes[instrument_id] = by_time
    return closes


def _provenance(raw: dict) -> dict:
    fields = (
        "instrument_id",
        "provider",
        "frequency",
        "requested_start_date",
        "requested_end_date",
        "row_count",
        "cache_hit",
        "dataset_cache_key",
        "data_fingerprint",
        "data_version",
        "data_acquired_at",
    )

    def entry(item: dict) -> dict:
        values = {name: item.get(name) for name in fields}
        if values["data_version"] is not None:
            values["data_version"] = str(values["data_version"])
        return values

    if not raw:
        return {"datasets": [], "aligned_rows": None}
    datasets = raw.get("instruments") if isinstance(raw.get("instruments"), list) else [raw]
    return {
        "datasets": [entry(item) for item in datasets if isinstance(item, dict)],
        "aligned_rows": raw.get("aligned_rows"),
    }


@router.get(
    "/{execution_id}/results",
    response_model=ExecutionResultsResponse,
    responses={409: {"description": "The run has not completed, or has no stored result."}},
)
def get_execution_results(
    execution_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Analytics of a completed run, computed on the server from its stored result
    (equity curve and fills). Annualised with 252 bars a year and a 6.5% risk-free rate."""
    execution = ExecutionService(db).get_for_user(
        execution_id=execution_id,
        user_id=current_user.id,
    )
    if not execution:
        raise _not_found()
    if execution.status != ExecutionStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Results are available once the backtest has completed "
                f"(it is {execution.status.value})."
            ),
        )
    metrics = execution.execution_metrics if isinstance(execution.execution_metrics, dict) else {}
    canonical = metrics.get("canonical_result")
    if not isinstance(canonical, dict) or not canonical.get("equity_curve"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This run has no stored result.",
        )

    curve = canonical["equity_curve"]
    instrument_ids = [str(i) for i in canonical.get("metadata", {}).get("instrument_ids") or []]
    initial_capital = float(execution.initial_capital)
    analytics = results_analytics.build_results(
        canonical=canonical,
        initial_capital=initial_capital,
        closes_by_instrument=_closes(
            db, instrument_ids, execution.timeframe, curve[0]["timestamp"], curve[-1]["timestamp"]
        ),
    )

    rs = execution.run_settings if isinstance(execution.run_settings, dict) else {}
    strategy = db.get(Strategy, execution.strategy_id)
    null_reasons = dict(analytics["null_reasons"])
    if rs.get("strategy_version") is None:
        null_reasons["strategy_version"] = results_analytics.NOT_RECORDED
    if rs.get("engine_version") is None:
        null_reasons["engine_version"] = results_analytics.NOT_RECORDED

    return {
        "execution_id": execution.id,
        "basis": {
            "periods_per_year": results_analytics.PERIODS_PER_YEAR,
            "risk_free_rate_annual": results_analytics.RISK_FREE_RATE_ANNUAL,
            "risk_free_rate_per_period": results_analytics.RISK_FREE_RATE_PER_PERIOD,
            "return_frequency": "per bar (daily bars)",
            "cagr_year_days": 365.2425,
        },
        **{key: value for key, value in analytics.items() if key != "null_reasons"},
        "null_reasons": null_reasons,
        "configuration": {
            "strategy_id": execution.strategy_id,
            "strategy_name": strategy.name if strategy else None,
            "strategy_key": rs.get("strategy_key"),
            "strategy_version": rs.get("strategy_version"),
            "current_strategy_version": strategy.version if strategy else None,
            "parameters": execution.execution_config or {},
            "instrument_ids": instrument_ids,
            "timeframe": execution.timeframe,
            "initial_capital": initial_capital,
            "quantity": rs.get("quantity"),
            "slippage_bps": rs.get("slippage_bps"),
            "brokerage_rate": rs.get("brokerage_rate"),
            "requested_start": rs.get("start_timestamp"),
            "requested_end": rs.get("end_timestamp"),
            "engine_version": rs.get("engine_version"),
            "rules": rs.get("rules"),
        },
        "provenance": _provenance(canonical.get("provenance") or {}),
    }


@router.post(
    "/{execution_id}/cancel",
    response_model=ExecutionResponse,
    responses={409: {"description": "The execution has already finished."}},
)
def cancel_execution(
    execution_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cancel a PENDING or RUNNING execution and stop its worker."""
    execution_service = ExecutionService(db)
    execution = execution_service.get_for_user(
        execution_id=execution_id,
        user_id=current_user.id,
    )
    if not execution:
        raise _not_found()

    try:
        execution = execution_service.cancel_execution(execution=execution)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This execution has already finished ({execution.status.value}).",
        )

    # The status is CANCELLED first, then the worker is stopped: whatever the
    # worker tries afterwards is refused by the lifecycle.
    backtest_executor.cancel(execution.id)
    return _to_response(execution)


@router.delete(
    "/{execution_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={409: {"description": "The execution is still running."}},
)
def delete_execution(
    execution_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)
    execution = execution_service.get_for_user(
        execution_id=execution_id,
        user_id=current_user.id,
    )
    if not execution:
        raise _not_found()
    if execution.status not in TERMINAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cancel this execution before deleting it.",
        )
    execution_service.delete_execution(execution=execution)
