from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MarketData


class MarketDataRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        *,
        instrument_id: UUID,
        timestamp: datetime,
        timeframe,
        open,
        high,
        low,
        close,
        volume: int,
    ) -> MarketData:
        market_data = MarketData(
            instrument_id=instrument_id,
            timestamp=timestamp,
            timeframe=timeframe,
            open=open,
            high=high,
            low=low,
            close=close,
            volume=volume,
        )

        self.db.add(market_data)
        self.db.commit()
        self.db.refresh(market_data)

        return market_data

    def list(
        self,
        *,
        instrument_id: UUID,
        start_timestamp: datetime | None = None,
        end_timestamp: datetime | None = None,
        timeframe=None,
    ) -> list[MarketData]:
        statement = select(MarketData).where(
            MarketData.instrument_id == instrument_id
        )

        if start_timestamp is not None:
            statement = statement.where(
                MarketData.timestamp >= start_timestamp
            )

        if end_timestamp is not None:
            statement = statement.where(
                MarketData.timestamp <= end_timestamp
            )

        if timeframe is not None:
            statement = statement.where(
                MarketData.timeframe == timeframe
            )

        statement = statement.order_by(MarketData.timestamp.asc())

        return list(self.db.scalars(statement).all())

    def get_by_id(
        self,
        *,
        market_data_id: UUID,
    ) -> MarketData | None:
        statement = select(MarketData).where(
            MarketData.id == market_data_id
        )

        return self.db.scalar(statement)
