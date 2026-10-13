from pydantic import BaseModel, Field, field_validator

from app.enums import Exchange, InstrumentType


class CreateInstrumentRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=50)
    trading_symbol: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    exchange: Exchange
    instrument_type: InstrumentType
    isin: str | None = Field(default=None, max_length=20)
    lot_size: int = Field(default=1, ge=1)
    tick_size: float = Field(default=0.05, gt=0)
    is_active: bool = True

    @field_validator("symbol", "trading_symbol", "name")
    @classmethod
    def validate_symbol_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Instrument text fields must not be blank.")
        return value