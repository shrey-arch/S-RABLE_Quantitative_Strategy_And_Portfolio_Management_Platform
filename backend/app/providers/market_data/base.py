from abc import ABC, abstractmethod
from datetime import datetime
from uuid import UUID


class MarketDataProvider(ABC):
    @abstractmethod
    def fetch(
        self,
        *,
        instrument_id: UUID,
        start_timestamp: datetime,
        end_timestamp: datetime,
        timeframe,
    ) -> list[dict]:
        """
        Fetch normalized market-data records for an instrument
        within the requested time range and timeframe.
        """
        raise NotImplementedError
