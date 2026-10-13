from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class CreateTradeRequest(BaseModel):
    order_id: UUID
    broker_trade_id: str | None = None
    executed_quantity: int = Field(gt=0)
    executed_price: float = Field(gt=0)
    brokerage: float = Field(default=0, ge=0)
    total_charges: float = Field(default=0, ge=0)
    trade_timestamp: datetime | None = None
