"""Simulated trades (fills) of the user's backtests (Phase 15).

Each trade belongs to an order of one of the user's executions. They are stored
from completed backtests and cannot be created here. Every route needs a login
and only sees the user's own records (404 otherwise).
"""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import OrderSide
from app.models import User
from app.schemas.trades import TradeResponse, UpdateTradeRequest
from app.services.records import service as records
from app.services.trades.trade_service import TradeService


router = APIRouter(
    prefix="/trades",
    tags=["Trades"],
)


def _to_response(trade) -> TradeResponse:
    order = trade.order
    return TradeResponse(
        id=trade.id,
        order_id=trade.order_id,
        execution_id=order.execution_id if order is not None else None,
        instrument_id=order.instrument_id if order is not None else None,
        order_side=order.order_side if order is not None else None,
        broker_trade_id=trade.broker_trade_id,
        executed_quantity=trade.executed_quantity,
        executed_price=trade.executed_price,
        brokerage=trade.brokerage,
        total_charges=trade.total_charges,
        trade_timestamp=trade.trade_timestamp,
        created_at=trade.created_at,
        updated_at=trade.updated_at,
    )


def _owned(db: Session, user: User, trade_id: UUID):
    trade = records.owned_trade(db, user.id, trade_id)
    if not trade:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade not found.",
        )
    return trade


@router.get(
    "",
    response_model=list[TradeResponse],
)
def list_trades(
    execution_id: UUID | None = None,
    instrument_id: UUID | None = None,
    order_id: UUID | None = None,
    side: OrderSide | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The user's simulated trades, newest first. Dates are IST days."""
    trades = records.list_trades(
        db,
        current_user.id,
        execution_id=execution_id,
        instrument_id=instrument_id,
        order_id=order_id,
        side=side,
        start=start_date,
        end=end_date,
        limit=limit,
    )
    return [_to_response(trade) for trade in trades]


@router.get(
    "/{trade_id}",
    response_model=TradeResponse,
)
def get_trade(
    trade_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _to_response(_owned(db, current_user, trade_id))


@router.patch(
    "/{trade_id}",
    response_model=TradeResponse,
)
def update_trade(
    trade_id: UUID,
    request: UpdateTradeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    trade = _owned(db, current_user, trade_id)
    try:
        trade = TradeService(db).update_trade(
            trade=trade,
            broker_trade_id=request.broker_trade_id,
            executed_quantity=request.executed_quantity,
            executed_price=request.executed_price,
            brokerage=request.brokerage,
            total_charges=request.total_charges,
            trade_timestamp=request.trade_timestamp,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return _to_response(trade)


@router.delete(
    "/{trade_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_trade(
    trade_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Deletes the trade record. Its order and the position are not changed."""
    TradeService(db).delete_trade(trade=_owned(db, current_user, trade_id))
