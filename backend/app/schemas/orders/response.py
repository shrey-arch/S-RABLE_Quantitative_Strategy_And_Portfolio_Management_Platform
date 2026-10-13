from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.enums import OrderSide, OrderStatus, OrderType


class OrderResponse(BaseModel):
    id: UUID
    execution_id: UUID
    instrument_id: UUID
    broker_order_id: str | None
    order_type: OrderType
    order_side: OrderSide
    status: OrderStatus
    quantity: int
    filled_quantity: int
    price: float
    average_fill_price: float | None
    order_timestamp: datetime | None
    created_at: datetime
    updated_at: datetime
