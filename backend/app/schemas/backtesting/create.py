from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.enums import Timeframe


class CreateBacktestRequest(BaseModel):
    strategy_id: UUID
    strategy_key: str | None = Field(
        default=None,
        description=(
            "Optional. The built-in strategy to run is taken from the saved strategy "
            "(its core template); if given, it must match."
        ),
    )
    instrument_id: UUID
    other_instrument_ids: list[UUID] = Field(
        default_factory=list,
        max_length=19,
        description=(
            "More instruments for strategies that need them: exactly one for "
            "statistical arbitrage (instrument B), one or more for tactical asset "
            "allocation (the rest of the universe). Empty for the others."
        ),
    )
    timeframe: Timeframe
    initial_capital: float = Field(gt=0, le=1_000_000_000_000)
    start_timestamp: datetime | None = None
    end_timestamp: datetime | None = None
    execution_config: dict | None = Field(
        default=None,
        description="The strategy's parameters (as in GET /strategy-registry).",
    )
    quantity: int = Field(default=1, gt=0, le=1_000_000)
    slippage_bps: float = Field(
        default=0,
        ge=0,
        le=1000,
        description="Slippage in basis points applied to every fill (10 = 0.10%).",
    )
    brokerage_rate: float = Field(
        default=0,
        ge=0,
        le=0.05,
        description="Brokerage as a fraction of trade value (0.0003 = 0.03%).",
    )

    @model_validator(mode="after")
    def check_dates_and_instruments(self):
        for name in ("start_timestamp", "end_timestamp"):
            value = getattr(self, name)
            if value is not None and value.tzinfo is None:
                raise ValueError(f"{name} must include a time zone.")
        if (
            self.start_timestamp is not None
            and self.end_timestamp is not None
            and self.end_timestamp < self.start_timestamp
        ):
            raise ValueError("end_timestamp must be on or after start_timestamp.")
        every = [self.instrument_id, *self.other_instrument_ids]
        if len(set(every)) != len(every):
            raise ValueError("Each instrument can be chosen only once.")
        return self
