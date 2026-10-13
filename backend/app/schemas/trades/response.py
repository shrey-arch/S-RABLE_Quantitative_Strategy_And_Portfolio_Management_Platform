from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class TradeResponse(BaseModel):
    id: UUID
    order_id: UUID
    broker_trade_id: str | None
    executed_quantity: int
    executed_price: float
    brokerage: float
    total_charges: float
    trade_timestamp: datetime | None
    created_at: datetime
    updated_at: datetime
