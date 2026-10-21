"""A backtest's stored trading records (Phase 15)."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.models import Order, Position, Trade, User
from app.schemas.records import RecordCounts
from app.services.executions.execution_service import ExecutionService
from app.services.records import service as records


router = APIRouter(
    prefix="/executions",
    tags=["Trading records"],
)


def _execution(db: Session, user: User, execution_id: UUID):
    execution = ExecutionService(db).get_for_user(execution_id=execution_id, user_id=user.id)
    if not execution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Execution not found.")
    return execution


def _counts(db: Session, execution_id: UUID) -> RecordCounts:
    count = lambda statement: db.scalar(statement) or 0  # noqa: E731
    orders = count(select(func.count()).select_from(Order).where(Order.execution_id == execution_id))
    trades = count(
        select(func.count())
        .select_from(Trade)
        .join(Order, Order.id == Trade.order_id)
        .where(Order.execution_id == execution_id)
    )
    positions = count(
        select(func.count()).select_from(Position).where(Position.execution_id == execution_id)
    )
    return RecordCounts(
        execution_id=execution_id,
        stored=orders > 0 or positions > 0,
        orders=orders,
        trades=trades,
        positions=positions,
    )


@router.get("/{execution_id}/records", response_model=RecordCounts)
def record_counts(
    execution_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """How many orders, trades and positions this run has stored."""
    return _counts(db, _execution(db, current_user, execution_id).id)


@router.post(
    "/{execution_id}/records",
    response_model=RecordCounts,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "Already stored, not completed, or not a backtest."}},
)
def store_records(
    execution_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Store a completed backtest's simulated orders, trades and positions (for runs
    completed before records were stored automatically)."""
    execution = _execution(db, current_user, execution_id)
    try:
        records.store_backtest_records(db, execution)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _counts(db, execution.id)
