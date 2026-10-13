from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.enums import PositionStatus


class PositionResponse(BaseModel):
    id: UUID
    execution_id: UUID
    instrument_id: UUID
    broker_account_id: UUID | None
    quantity: int
    average_price: float
    current_price: float | None
    market_value: float | None
    realized_pnl: float
    unrealized_pnl: float
    position_status: PositionStatus
    last_updated_at: datetime
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime
