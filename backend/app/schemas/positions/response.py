from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import PositionStatus


class PositionResponse(BaseModel):
    id: UUID
    execution_id: UUID
    instrument_id: UUID
    broker_account_id: UUID | None
    direction: Literal["LONG", "SHORT"] = "LONG"
    quantity: int = Field(description="Size of the position (0 once closed).")
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
