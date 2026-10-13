from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.executions import (
    CreateExecutionRequest,
    ExecutionResponse,
    FailExecutionRequest,
    UpdateExecutionRequest,
)
from app.services.executions.execution_service import ExecutionService

router = APIRouter(
    prefix="/executions",
    tags=["Executions"],
)


def _to_response(execution) -> ExecutionResponse:
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
        error_message=execution.error_message,
        started_at=execution.started_at,
        completed_at=execution.completed_at,
        created_at=execution.created_at,
        updated_at=execution.updated_at,
    )


@router.post(
    "",
    response_model=ExecutionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_execution(
    request: CreateExecutionRequest,
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)

    execution = execution_service.create_execution(
        strategy_id=request.strategy_id,
        broker_account_id=request.broker_account_id,
        instrument_id=request.instrument_id,
        execution_type=request.execution_type,
        status=request.status,
        timeframe=request.timeframe,
        initial_capital=request.initial_capital,
        execution_config=request.execution_config,
    )

    return _to_response(execution)


@router.get(
    "",
    response_model=list[ExecutionResponse],
)
def list_executions(
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)

    executions = execution_service.list_executions()

    return [_to_response(execution) for execution in executions]


@router.get(
    "/{execution_id}",
    response_model=ExecutionResponse,
)
def get_execution(
    execution_id: UUID,
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)

    execution = execution_service.get_execution(
        execution_id=execution_id,
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Execution not found.",
        )

    return _to_response(execution)


@router.post(
    "/{execution_id}/start",
    response_model=ExecutionResponse,
)
def start_execution(
    execution_id: UUID,
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)

    execution = execution_service.get_execution(
        execution_id=execution_id,
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Execution not found.",
        )

    try:
        execution = execution_service.start_execution(
            execution=execution,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    return _to_response(execution)


@router.patch(
    "/{execution_id}",
    response_model=ExecutionResponse,
)
def update_execution(
    execution_id: UUID,
    request: UpdateExecutionRequest,
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)

    execution = execution_service.get_execution(
        execution_id=execution_id,
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Execution not found.",
        )

    execution = execution_service.update_execution(
        execution=execution,
        execution_config=request.execution_config,
    )

    return _to_response(execution)


@router.delete(
    "/{execution_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_execution(
    execution_id: UUID,
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)

    execution = execution_service.get_execution(
        execution_id=execution_id,
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Execution not found.",
        )

    execution_service.delete_execution(
        execution=execution,
    )
@router.post(
    "/{execution_id}/complete",
    response_model=ExecutionResponse,
)
def complete_execution(
    execution_id: UUID,
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)

    execution = execution_service.get_execution(
        execution_id=execution_id,
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Execution not found.",
        )

    try:
        execution = execution_service.complete_execution(
            execution=execution,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    return _to_response(execution)

@router.post(
    "/{execution_id}/fail",
    response_model=ExecutionResponse,
)
def fail_execution(
    execution_id: UUID,
    request: FailExecutionRequest,
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)

    execution = execution_service.get_execution(
        execution_id=execution_id,
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Execution not found.",
        )

    try:
        execution = execution_service.fail_execution(
            execution=execution,
            error_message=request.error_message,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    return _to_response(execution)
@router.post(
    "/{execution_id}/cancel",
    response_model=ExecutionResponse,
)
def cancel_execution(
    execution_id: UUID,
    db: Session = Depends(get_db),
):
    execution_service = ExecutionService(db)

    execution = execution_service.get_execution(
        execution_id=execution_id,
    )

    if not execution:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Execution not found.",
        )

    try:
        execution = execution_service.cancel_execution(
            execution=execution,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    return _to_response(execution)
