from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import OrderSide, OrderStatus, OrderType


class CreateOrderRequest(BaseModel):
    execution_id: UUID
    instrument_id: UUID
    broker_order_id: str | None = None
    order_type: OrderType
    order_side: OrderSide
    status: OrderStatus
    quantity: int = Field(gt=0)
    filled_quantity: int = Field(ge=0)
    price: float = Field(gt=0)
    average_fill_price: float | None = Field(default=None, gt=0)
    order_timestamp: datetime | None = None
