from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.enums import Timeframe


class CreateMarketDataRequest(BaseModel):
    instrument_id: UUID
    timestamp: datetime
    timeframe: Timeframe

    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: int = Field(ge=0)

    @field_validator("timestamp")
    @classmethod
    def validate_timestamp_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Timestamp must be timezone-aware.")
        return value

    @model_validator(mode="after")
    def validate_ohlc_relationships(self):
        if self.high < self.low:
            raise ValueError("High price must be greater than or equal to low price.")

        if self.high < self.open:
            raise ValueError("High price must be greater than or equal to open price.")

        if self.high < self.close:
            raise ValueError("High price must be greater than or equal to close price.")

        if self.low > self.open:
            raise ValueError("Low price must be less than or equal to open price.")

        if self.low > self.close:
            raise ValueError("Low price must be less than or equal to close price.")

        return self
