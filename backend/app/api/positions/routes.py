"""Simulated positions of the user's backtests (Phase 15).

One position per instrument of a stored backtest. They are stored from completed
backtests and cannot be created here. Every route needs a login and only sees
the user's own records (404 otherwise).
"""

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import PositionStatus
from app.models import User
from app.schemas.positions import PositionResponse, UpdatePositionRequest
from app.services.positions.position_service import PositionService
from app.services.records import service as records


router = APIRouter(
    prefix="/positions",
    tags=["Positions"],
)


def _to_response(position) -> PositionResponse:
    return PositionResponse(
        id=position.id,
        execution_id=position.execution_id,
        instrument_id=position.instrument_id,
        broker_account_id=position.broker_account_id,
        direction=position.direction or "LONG",
        quantity=position.quantity,
        average_price=position.average_price,
        current_price=position.current_price,
        market_value=position.market_value,
        realized_pnl=position.realized_pnl,
        unrealized_pnl=position.unrealized_pnl,
        position_status=position.position_status,
        last_updated_at=position.last_updated_at,
        closed_at=position.closed_at,
        created_at=position.created_at,
        updated_at=position.updated_at,
    )


def _owned(db: Session, user: User, position_id: UUID):
    position = records.owned_position(db, user.id, position_id)
    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found.",
        )
    return position


@router.get(
    "",
    response_model=list[PositionResponse],
)
def list_positions(
    execution_id: UUID | None = None,
    instrument_id: UUID | None = None,
    status_filter: PositionStatus | None = Query(default=None, alias="status"),
    direction: Literal["LONG", "SHORT"] | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The user's simulated positions, latest update first. Dates (IST days) apply
    to the last update."""
    positions = records.list_positions(
        db,
        current_user.id,
        execution_id=execution_id,
        instrument_id=instrument_id,
        status=status_filter,
        direction=direction,
        start=start_date,
        end=end_date,
        limit=limit,
    )
    return [_to_response(position) for position in positions]


@router.get(
    "/{position_id}",
    response_model=PositionResponse,
)
def get_position(
    position_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _to_response(_owned(db, current_user, position_id))


@router.patch(
    "/{position_id}",
    response_model=PositionResponse,
)
def update_position(
    position_id: UUID,
    request: UpdatePositionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    position = _owned(db, current_user, position_id)
    try:
        position = PositionService(db).update_position(
            position=position,
            broker_account_id=request.broker_account_id,
            quantity=request.quantity,
            average_price=request.average_price,
            current_price=request.current_price,
            market_value=request.market_value,
            realized_pnl=request.realized_pnl,
            unrealized_pnl=request.unrealized_pnl,
            position_status=request.position_status,
            last_updated_at=request.last_updated_at,
            closed_at=request.closed_at,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return _to_response(position)


@router.delete(
    "/{position_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_position(
    position_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Deletes the position record. Orders and trades are not changed."""
    PositionService(db).delete_position(position=_owned(db, current_user, position_id))
