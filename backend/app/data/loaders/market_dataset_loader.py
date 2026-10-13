from datetime import date, datetime, time, timezone
from uuid import UUID

import pandas as pd

from app.config import settings
from app.data.cache import MarketDatasetCache, fingerprint_market_records
from app.data.datasets import MarketDataset
from app.enums import Timeframe
from app.services.market_data.market_data_service import MarketDataService


class MarketDatasetLoader:
    def __init__(self, db, cache: MarketDatasetCache | None = None):
        self.market_data_service = MarketDataService(db)
        self.cache = cache or MarketDatasetCache()

    def load(
        self,
        *,
        instrument_id: UUID,
        start_date: date | None = None,
        end_date: date | None = None,
        frequency: Timeframe,
        start_timestamp: datetime | None = None,
        end_timestamp: datetime | None = None,
    ) -> MarketDataset:
        if start_timestamp is not None and start_timestamp.tzinfo is None:
            raise ValueError("Start timestamp must be timezone-aware.")

        if end_timestamp is not None and end_timestamp.tzinfo is None:
            raise ValueError("End timestamp must be timezone-aware.")

        if start_timestamp is not None:
            start_timestamp = start_timestamp.astimezone(timezone.utc)

        if end_timestamp is not None:
            end_timestamp = end_timestamp.astimezone(timezone.utc)

        if start_timestamp is not None and end_timestamp is not None:
            if end_timestamp < start_timestamp:
                raise ValueError(
                    "End timestamp must be greater than or equal to start timestamp."
                )

        if start_date is None:
            start_date = (
                start_timestamp.date()
                if start_timestamp is not None
                else date.min
            )

        if end_date is None:
            end_date = (
                end_timestamp.date()
                if end_timestamp is not None
                else date.max
            )

        if end_date < start_date:
            raise ValueError(
                "End date must be greater than or equal to start date."
            )

        instrument = self.market_data_service.validate_instrument(
            instrument_id=instrument_id,
        )

        query_start = start_timestamp or datetime.combine(
            start_date,
            time.min,
            tzinfo=timezone.utc,
        )
        query_end = end_timestamp or datetime.combine(
            end_date,
            time.max,
            tzinfo=timezone.utc,
        )

        rows = self.market_data_service.list_market_data(
            instrument_id=instrument_id,
            start_timestamp=query_start,
            end_timestamp=query_end,
            timeframe=frequency,
        )

        data_version = fingerprint_market_records(rows)
        provider = settings.market_data_provider

        key = self.cache.build_key(
            instrument_id=instrument_id,
            start_date=start_date,
            end_date=end_date,
            frequency=frequency.value,
            data_version=data_version,
            provider=provider,
            start_timestamp=start_timestamp,
            end_timestamp=end_timestamp,
        )

        cached = self.cache.get(key)

        if cached is not None:
            data = cached["ohlcv"].copy()
            cache_hit = True
            fingerprint = cached["fingerprint"]
            acquired_at = cached["acquired_at"]
        else:
            data = pd.DataFrame(
                [
                    {
                        "timestamp": row.timestamp,
                        "open": row.open,
                        "high": row.high,
                        "low": row.low,
                        "close": row.close,
                        "volume": row.volume,
                    }
                    for row in rows
                ]
            )

            if data.empty:
                data = pd.DataFrame(
                    columns=[
                        "open",
                        "high",
                        "low",
                        "close",
                        "volume",
                    ]
                )
                data.index = pd.DatetimeIndex(
                    [],
                    tz="UTC",
                    name="timestamp",
                )
            else:
                data["timestamp"] = pd.to_datetime(
                    data["timestamp"],
                    utc=True,
                )
                data = data.set_index("timestamp").sort_index()

            dataset = MarketDataset(
                instrument=instrument,
                start_date=start_date,
                end_date=end_date,
                frequency=frequency,
                ohlcv=data,
                metadata={
                    "instrument_id": str(instrument_id),
                    "frequency": frequency.value,
                    "row_count": len(data),
                },
            )

            cached = self.cache.put(
                key=key,
                dataset=dataset,
                provider=provider,
                data_version=data_version,
            )

            cache_hit = False
            fingerprint = cached["fingerprint"]
            acquired_at = cached["acquired_at"]

        metadata = {
            "instrument_id": str(instrument_id),
            "frequency": frequency.value,
            "row_count": len(data),
            "provider": provider,
            "requested_start_date": start_date.isoformat(),
            "requested_end_date": end_date.isoformat(),
            "requested_start_timestamp": (
                start_timestamp.isoformat() if start_timestamp else None
            ),
            "requested_end_timestamp": (
                end_timestamp.isoformat() if end_timestamp else None
            ),
            "dataset_cache_key": key,
            "data_version": data_version,
            "data_fingerprint": fingerprint,
            "data_acquired_at": acquired_at,
            "cache_hit": cache_hit,
        }

        return MarketDataset(
            instrument=instrument,
            start_date=start_date,
            end_date=end_date,
            frequency=frequency,
            ohlcv=data,
            metadata=metadata,
        )
