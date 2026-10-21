from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import OrderSide


class TradeResponse(BaseModel):
    id: UUID
    order_id: UUID
    # From the parent order, so a trade can be filtered and linked without it.
    execution_id: UUID | None = None
    instrument_id: UUID | None = None
    order_side: OrderSide | None = None
    broker_trade_id: str | None
    executed_quantity: int
    executed_price: float
    brokerage: float
    total_charges: float = Field(description="Brokerage plus the other charges of the fill.")
    trade_timestamp: datetime | None
    created_at: datetime
    updated_at: datetime
