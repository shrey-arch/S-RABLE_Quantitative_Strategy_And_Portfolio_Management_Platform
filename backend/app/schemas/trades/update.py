from datetime import datetime

from pydantic import BaseModel, Field


class UpdateTradeRequest(BaseModel):
    broker_trade_id: str | None = None
    executed_quantity: int | None = Field(default=None, gt=0)
    executed_price: float | None = Field(default=None, gt=0)
    brokerage: float | None = Field(default=None, ge=0)
    total_charges: float | None = Field(default=None, ge=0)
    trade_timestamp: datetime | None = None
