from datetime import datetime
from uuid import UUID

from app.models import MarketData
from app.repositories.market_data import MarketDataRepository
from app.schemas.market_data import CreateMarketDataRequest
from app.services.instruments.instrument_service import InstrumentService


class MarketDataService:
    def __init__(self, db):
        self.repository = MarketDataRepository(db)
        self.instrument_service = InstrumentService(db)

    def validate_instrument(
        self,
        *,
        instrument_id: UUID,
    ):
        return self.instrument_service.get_required_instrument(
            instrument_id=instrument_id,
        )

    def create_market_data(
        self,
        *,
        data: CreateMarketDataRequest,
    ) -> MarketData:
        self.validate_instrument(
            instrument_id=data.instrument_id,
        )

        return self.repository.create(
            instrument_id=data.instrument_id,
            timestamp=data.timestamp,
            timeframe=data.timeframe,
            open=data.open,
            high=data.high,
            low=data.low,
            close=data.close,
            volume=data.volume,
        )

    def list_market_data(
        self,
        *,
        instrument_id: UUID,
        start_timestamp: datetime | None = None,
        end_timestamp: datetime | None = None,
        timeframe=None,
    ) -> list[MarketData]:
        self.validate_instrument(
            instrument_id=instrument_id,
        )

        return self.repository.list(
            instrument_id=instrument_id,
            start_timestamp=start_timestamp,
            end_timestamp=end_timestamp,
            timeframe=timeframe,
        )

    def get_market_data(
        self,
        *,
        market_data_id: UUID,
    ) -> MarketData | None:
        return self.repository.get_by_id(
            market_data_id=market_data_id,
        )
