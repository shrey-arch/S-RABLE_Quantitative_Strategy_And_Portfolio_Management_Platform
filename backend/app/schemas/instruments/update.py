from pydantic import BaseModel, Field, field_validator

from app.enums import Exchange, InstrumentType


class UpdateInstrumentRequest(BaseModel):
    symbol: str | None = Field(default=None, min_length=1, max_length=50)
    trading_symbol: str | None = Field(default=None, min_length=1, max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    exchange: Exchange | None = None
    instrument_type: InstrumentType | None = None
    isin: str | None = Field(default=None, max_length=20)
    lot_size: int | None = Field(default=None, ge=1)
    tick_size: float | None = Field(default=None, gt=0)
    is_active: bool | None = None

    @field_validator("symbol", "trading_symbol", "name")
    @classmethod
    def validate_text_fields_not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Instrument text fields must not be blank.")
        return value
