from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.positions import (
    CreatePositionRequest,
    PositionResponse,
    UpdatePositionRequest,
)
from app.services.positions.position_service import PositionService


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


@router.post(
    "",
    response_model=PositionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_position(
    request: CreatePositionRequest,
    db: Session = Depends(get_db),
):
    position_service = PositionService(db)

    position = position_service.create_position(
        execution_id=request.execution_id,
        instrument_id=request.instrument_id,
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

    return _to_response(position)


@router.get(
    "",
    response_model=list[PositionResponse],
)
def list_positions(
    db: Session = Depends(get_db),
):
    position_service = PositionService(db)

    positions = position_service.list_positions()

    return [_to_response(position) for position in positions]


@router.get(
    "/{position_id}",
    response_model=PositionResponse,
)
def get_position(
    position_id: UUID,
    db: Session = Depends(get_db),
):
    position_service = PositionService(db)

    position = position_service.get_position(
        position_id=position_id,
    )

    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found.",
        )

    return _to_response(position)


@router.patch(
    "/{position_id}",
    response_model=PositionResponse,
)
def update_position(
    position_id: UUID,
    request: UpdatePositionRequest,
    db: Session = Depends(get_db),
):
    position_service = PositionService(db)

    position = position_service.get_position(
        position_id=position_id,
    )

    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found.",
        )

    position = position_service.update_position(
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

    return _to_response(position)


@router.delete(
    "/{position_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_position(
    position_id: UUID,
    db: Session = Depends(get_db),
):
    position_service = PositionService(db)

    position = position_service.get_position(
        position_id=position_id,
    )

    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Position not found.",
        )

    position_service.delete_position(
        position=position,
    )
