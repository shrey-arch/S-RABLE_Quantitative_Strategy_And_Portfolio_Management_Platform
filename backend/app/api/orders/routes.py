from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.orders import (
    CreateOrderRequest,
    OrderResponse,
    UpdateOrderRequest,
)
from app.services.orders.order_service import OrderService


router = APIRouter(
    prefix="/orders",
    tags=["Orders"],
)


def _to_response(order) -> OrderResponse:
    return OrderResponse(
        id=order.id,
        execution_id=order.execution_id,
        instrument_id=order.instrument_id,
        broker_order_id=order.broker_order_id,
        order_type=order.order_type,
        order_side=order.order_side,
        status=order.status,
        quantity=order.quantity,
        filled_quantity=order.filled_quantity,
        price=order.price,
        average_fill_price=order.average_fill_price,
        order_timestamp=order.order_timestamp,
        created_at=order.created_at,
        updated_at=order.updated_at,
    )


@router.post(
    "",
    response_model=OrderResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_order(
    request: CreateOrderRequest,
    db: Session = Depends(get_db),
):
    order_service = OrderService(db)

    order = order_service.create_order(
        execution_id=request.execution_id,
        instrument_id=request.instrument_id,
        broker_order_id=request.broker_order_id,
        order_type=request.order_type,
        order_side=request.order_side,
        status=request.status,
        quantity=request.quantity,
        filled_quantity=request.filled_quantity,
        price=request.price,
        average_fill_price=request.average_fill_price,
        order_timestamp=request.order_timestamp,
    )

    return _to_response(order)


@router.get(
    "",
    response_model=list[OrderResponse],
)
def list_orders(
    db: Session = Depends(get_db),
):
    order_service = OrderService(db)

    orders = order_service.list_orders()

    return [_to_response(order) for order in orders]


@router.get(
    "/{order_id}",
    response_model=OrderResponse,
)
def get_order(
    order_id: UUID,
    db: Session = Depends(get_db),
):
    order_service = OrderService(db)

    order = order_service.get_order(
        order_id=order_id,
    )

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    return _to_response(order)


@router.patch(
    "/{order_id}",
    response_model=OrderResponse,
)
def update_order(
    order_id: UUID,
    request: UpdateOrderRequest,
    db: Session = Depends(get_db),
):
    order_service = OrderService(db)

    order = order_service.get_order(
        order_id=order_id,
    )

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    order = order_service.update_order(
        order=order,
        broker_order_id=request.broker_order_id,
        filled_quantity=request.filled_quantity,
        average_fill_price=request.average_fill_price,
        order_timestamp=request.order_timestamp,
    )

    return _to_response(order)


@router.post(
    "/{order_id}/reject",
    response_model=OrderResponse,
)
def reject_order(
    order_id: UUID,
    db: Session = Depends(get_db),
):
    order_service = OrderService(db)

    order = order_service.get_order(
        order_id=order_id,
    )

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    try:
        order = order_service.reject_order(
            order=order,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return _to_response(order)


@router.post(
    "/{order_id}/cancel",
    response_model=OrderResponse,
)
def cancel_order(
    order_id: UUID,
    db: Session = Depends(get_db),
):
    order_service = OrderService(db)

    order = order_service.get_order(
        order_id=order_id,
    )

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    try:
        order = order_service.cancel_order(
            order=order,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return _to_response(order)


@router.post(
    "/{order_id}/complete",
    response_model=OrderResponse,
)
def complete_order(
    order_id: UUID,
    db: Session = Depends(get_db),
):
    order_service = OrderService(db)

    order = order_service.get_order(
        order_id=order_id,
    )

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    try:
        order = order_service.complete_order(
            order=order,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return _to_response(order)


@router.post(
    "/{order_id}/open",
    response_model=OrderResponse,
)
def open_order(
    order_id: UUID,
    db: Session = Depends(get_db),
):
    order_service = OrderService(db)

    order = order_service.get_order(
        order_id=order_id,
    )

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    try:
        order = order_service.open_order(
            order=order,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return _to_response(order)


@router.delete(
    "/{order_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_order(
    order_id: UUID,
    db: Session = Depends(get_db),
):
    order_service = OrderService(db)

    order = order_service.get_order(
        order_id=order_id,
    )

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    order_service.delete_order(
        order=order,
    )
