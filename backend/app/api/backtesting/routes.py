from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.executions.routes import _to_response
from app.db import get_db
from app.enums.execution_status import ExecutionStatus
from app.enums.execution_type import ExecutionType
from app.exceptions.backtesting_errors import (
    build_backtest_error_payload,
    classify_backtest_error,
)
from app.schemas.backtesting.create import CreateBacktestRequest
from app.schemas.executions.response import ExecutionResponse
from app.services.backtesting.executor import BacktestExecutor
from app.services.executions.execution_service import ExecutionService


logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/backtests",
    tags=["Backtests"],
)

_executor = BacktestExecutor(max_workers=1)


@router.post(
    "",
    response_model=ExecutionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_backtest(
    request: CreateBacktestRequest,
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)

    execution = execution_service.create_execution(
        strategy_id=request.strategy_id,
        broker_account_id=None,
        instrument_id=request.instrument_id,
        execution_type=ExecutionType.BACKTEST,
        status=ExecutionStatus.PENDING,
        timeframe=request.timeframe,
        initial_capital=request.initial_capital,
        execution_config=request.execution_config,
    )

    try:
        _executor.submit(
            execution_id=execution.id,
            strategy_key=request.strategy_key,
            strategy_config=request.execution_config,
            start_timestamp=request.start_timestamp,
            end_timestamp=request.end_timestamp,
            quantity=request.quantity,
        )
    except Exception as exc:
        classification = classify_backtest_error(
            exc,
            context="worker_submission",
        )
        logger.exception(
            "Backtest submission failed: category=%s code=%s execution_id=%s",
            classification.category,
            classification.code,
            execution.id,
        )

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
            logger.exception(
                "Could not persist backtest submission failure: execution_id=%s",
                execution.id,
            )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to submit backtest job.",
        ) from exc

    return _to_response(execution)
