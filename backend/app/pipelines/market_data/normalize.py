from uuid import UUID

from app.enums import Timeframe
from app.providers.market_data.schemas import MarketDataPoint
from app.schemas.market_data import CreateMarketDataRequest


def normalize_market_data(
    *,
    instrument_id: UUID,
    timeframe: Timeframe,
    points: list[MarketDataPoint],
) -> list[CreateMarketDataRequest]:
    return [
        CreateMarketDataRequest(
            instrument_id=instrument_id,
            timestamp=point.timestamp,
            timeframe=timeframe,
            open=point.open,
            high=point.high,
            low=point.low,
            close=point.close,
            volume=point.volume,
        )
        for point in points
    ]
