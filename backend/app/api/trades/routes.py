from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.trades import (
    CreateTradeRequest,
    TradeResponse,
    UpdateTradeRequest,
)
from app.services.trades.trade_service import TradeService


router = APIRouter(
    prefix="/trades",
    tags=["Trades"],
)


def _to_response(trade) -> TradeResponse:
    return TradeResponse(
        id=trade.id,
        order_id=trade.order_id,
        broker_trade_id=trade.broker_trade_id,
        executed_quantity=trade.executed_quantity,
        executed_price=trade.executed_price,
        brokerage=trade.brokerage,
        total_charges=trade.total_charges,
        trade_timestamp=trade.trade_timestamp,
        created_at=trade.created_at,
        updated_at=trade.updated_at,
    )


@router.post(
    "",
    response_model=TradeResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_trade(
    request: CreateTradeRequest,
    db: Session = Depends(get_db),
):
    trade_service = TradeService(db)

    trade = trade_service.create_trade(
        order_id=request.order_id,
        broker_trade_id=request.broker_trade_id,
        executed_quantity=request.executed_quantity,
        executed_price=request.executed_price,
        brokerage=request.brokerage,
        total_charges=request.total_charges,
        trade_timestamp=request.trade_timestamp,
    )

    return _to_response(trade)


@router.post(
    "/execute",
    response_model=TradeResponse,
    status_code=status.HTTP_201_CREATED,
)
def execute_trade(
    request: CreateTradeRequest,
    db: Session = Depends(get_db),
):
    trade_service = TradeService(db)

    trade = trade_service.execute_trade(
        order_id=request.order_id,
        broker_trade_id=request.broker_trade_id,
        executed_quantity=request.executed_quantity,
        executed_price=request.executed_price,
        brokerage=request.brokerage,
        total_charges=request.total_charges,
        trade_timestamp=request.trade_timestamp,
    )

    return _to_response(trade)


@router.get(
    "",
    response_model=list[TradeResponse],
)
def list_trades(
    db: Session = Depends(get_db),
):
    trade_service = TradeService(db)

    trades = trade_service.list_trades()

    return [_to_response(trade) for trade in trades]


@router.get(
    "/{trade_id}",
    response_model=TradeResponse,
)
def get_trade(
    trade_id: UUID,
    db: Session = Depends(get_db),
):
    trade_service = TradeService(db)

    trade = trade_service.get_trade(
        trade_id=trade_id,
    )

    if not trade:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade not found.",
        )

    return _to_response(trade)


@router.patch(
    "/{trade_id}",
    response_model=TradeResponse,
)
def update_trade(
    trade_id: UUID,
    request: UpdateTradeRequest,
    db: Session = Depends(get_db),
):
    trade_service = TradeService(db)

    trade = trade_service.get_trade(
        trade_id=trade_id,
    )

    if not trade:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade not found.",
        )

    trade = trade_service.update_trade(
        trade=trade,
        broker_trade_id=request.broker_trade_id,
        executed_quantity=request.executed_quantity,
        executed_price=request.executed_price,
        brokerage=request.brokerage,
        total_charges=request.total_charges,
        trade_timestamp=request.trade_timestamp,
    )

    return _to_response(trade)


@router.delete(
    "/{trade_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_trade(
    trade_id: UUID,
    db: Session = Depends(get_db),
):
    trade_service = TradeService(db)

    trade = trade_service.get_trade(
        trade_id=trade_id,
    )

    if not trade:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade not found.",
        )

    trade_service.delete_trade(
        trade=trade,
    )
