"""Simulated orders of the user's backtests (Phase 15).

Orders are stored from completed backtests; they are never sent to a broker and
cannot be created here. Every route needs a login and only sees orders of the
user's own executions (404 otherwise). Status changes and delete are record
maintenance: they change the stored record only.
"""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import OrderSide, OrderStatus
from app.models import User
from app.schemas.orders import OrderResponse, UpdateOrderRequest
from app.services.orders.order_service import OrderService
from app.services.records import service as records


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


def _owned(db: Session, user: User, order_id: UUID):
    order = records.owned_order(db, user.id, order_id)
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )
    return order


@router.get(
    "",
    response_model=list[OrderResponse],
)
def list_orders(
    execution_id: UUID | None = None,
    instrument_id: UUID | None = None,
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    side: OrderSide | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The user's simulated orders, newest first. Dates are IST days."""
    orders = records.list_orders(
        db,
        current_user.id,
        execution_id=execution_id,
        instrument_id=instrument_id,
        status=status_filter,
        side=side,
        start=start_date,
        end=end_date,
        limit=limit,
    )
    return [_to_response(order) for order in orders]


@router.get(
    "/{order_id}",
    response_model=OrderResponse,
)
def get_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _to_response(_owned(db, current_user, order_id))


@router.patch(
    "/{order_id}",
    response_model=OrderResponse,
)
def update_order(
    order_id: UUID,
    request: UpdateOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = _owned(db, current_user, order_id)
    try:
        order = OrderService(db).update_order(
            order=order,
            broker_order_id=request.broker_order_id,
            filled_quantity=request.filled_quantity,
            average_fill_price=request.average_fill_price,
            order_timestamp=request.order_timestamp,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return _to_response(order)


def _transition(db: Session, user: User, order_id: UUID, action: str) -> OrderResponse:
    order = _owned(db, user, order_id)
    service = OrderService(db)
    try:
        order = getattr(service, f"{action}_order")(order=order)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return _to_response(order)


@router.post(
    "/{order_id}/open",
    response_model=OrderResponse,
    responses={400: {"description": "The order's status does not allow this change."}},
)
def open_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _transition(db, current_user, order_id, "open")


@router.post(
    "/{order_id}/complete",
    response_model=OrderResponse,
    responses={400: {"description": "The order's status does not allow this change."}},
)
def complete_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _transition(db, current_user, order_id, "complete")


@router.post(
    "/{order_id}/cancel",
    response_model=OrderResponse,
    responses={400: {"description": "The order's status does not allow this change."}},
)
def cancel_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _transition(db, current_user, order_id, "cancel")


@router.post(
    "/{order_id}/reject",
    response_model=OrderResponse,
    responses={400: {"description": "The order's status does not allow this change."}},
)
def reject_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _transition(db, current_user, order_id, "reject")


@router.delete(
    "/{order_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_order(
    order_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Deletes the order record and its trades. Positions are not changed."""
    OrderService(db).delete_order(order=_owned(db, current_user, order_id))
