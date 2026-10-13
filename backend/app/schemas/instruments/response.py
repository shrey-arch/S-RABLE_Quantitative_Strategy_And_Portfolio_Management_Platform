from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.enums import Exchange, InstrumentType


class InstrumentResponse(BaseModel):
    id: UUID
    symbol: str
    trading_symbol: str
    name: str
    exchange: Exchange
    instrument_type: InstrumentType
    isin: str | None
    lot_size: int
    tick_size: float
    is_active: bool
    created_at: datetime
    updated_at: datetime
