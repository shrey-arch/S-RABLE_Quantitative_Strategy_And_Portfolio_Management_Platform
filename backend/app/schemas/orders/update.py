from datetime import datetime

from pydantic import BaseModel, Field


class UpdateOrderRequest(BaseModel):
    broker_order_id: str | None = None
    filled_quantity: int | None = Field(default=None, ge=0)
    average_fill_price: float | None = Field(default=None, gt=0)
    order_timestamp: datetime | None = None
