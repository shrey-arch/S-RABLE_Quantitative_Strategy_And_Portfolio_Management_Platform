from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
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

    def insert_ignoring_existing(self, records) -> int:
        """
        Inserts validated records; rows that already exist for the same instrument,
        timestamp and timeframe are left unchanged. Returns how many were inserted.
        """
        if not records:
            return 0

        statement = (
            insert(MarketData)
            .values(
                [
                    {
                        "instrument_id": record.instrument_id,
                        "timestamp": record.timestamp,
                        "timeframe": record.timeframe,
                        "open": record.open,
                        "high": record.high,
                        "low": record.low,
                        "close": record.close,
                        "volume": record.volume,
                    }
                    for record in records
                ]
            )
            .on_conflict_do_nothing(
                constraint="uq_market_data_instrument_timestamp_timeframe"
            )
            .returning(MarketData.id)
        )

        inserted = len(self.db.execute(statement).all())
        self.db.commit()
        return inserted

    def count_for_instrument(self, *, instrument_id: UUID) -> int:
        statement = select(func.count()).select_from(MarketData).where(
            MarketData.instrument_id == instrument_id
        )
        return int(self.db.scalar(statement) or 0)
