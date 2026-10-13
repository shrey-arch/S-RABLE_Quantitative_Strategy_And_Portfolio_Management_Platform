from __future__ import annotations

import hashlib
import json
import os
import pickle
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

import pandas as pd

from app.config import settings
from app.data.datasets import MarketDataset
from app.data.validators import (
    find_duplicate_timestamps,
    find_invalid_prices,
    find_invalid_volume,
    find_missing_values,
)


REQUIRED_COLUMNS = ["open", "high", "low", "close", "volume"]
PRICE_COLUMNS = ["open", "high", "low", "close"]


class DatasetValidationError(ValueError):
    """Raised when a dataset fails cache validation."""


class MarketDatasetCache:
    """Persistent, cross-process cache for validated market datasets."""

    def __init__(self, cache_dir: Path | None = None):
        self.cache_dir = Path(
            cache_dir if cache_dir is not None else settings.backtest_cache_dir
        )

    @staticmethod
    def build_key(
        *,
        instrument_id: UUID | str,
        start_date: date,
        end_date: date,
        frequency: str,
        data_version: str,
        provider: str,
        start_timestamp: datetime | None = None,
        end_timestamp: datetime | None = None,
    ) -> str:
        identity = {
            "instrument_id": str(instrument_id),
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "frequency": str(frequency),
            "data_version": data_version,
            "provider": provider,
        }

        if start_timestamp is not None:
            identity["start_timestamp"] = start_timestamp.isoformat()

        if end_timestamp is not None:
            identity["end_timestamp"] = end_timestamp.isoformat()
        canonical = json.dumps(
            identity,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()

    @staticmethod
    def fingerprint(data: pd.DataFrame) -> str:
        """Return a deterministic fingerprint for index, columns and values."""
        digest = hashlib.sha256()
        digest.update(
            json.dumps(
                [str(column) for column in data.columns],
                separators=(",", ":"),
            ).encode("utf-8")
        )
        digest.update(
            pd.util.hash_pandas_object(data, index=True).values.tobytes()
        )
        return digest.hexdigest()

    @staticmethod
    def validate(data: pd.DataFrame) -> None:
        missing_columns = [
            column for column in REQUIRED_COLUMNS if column not in data.columns
        ]
        if missing_columns:
            raise DatasetValidationError(
                f"Dataset is missing required columns: {missing_columns}"
            )

        if not isinstance(data.index, pd.DatetimeIndex):
            raise DatasetValidationError(
                "Dataset index must be a DatetimeIndex."
            )

        if data.index.tz is None:
            raise DatasetValidationError(
                "Dataset timestamps must be timezone-aware."
            )

        if not data.index.is_monotonic_increasing:
            raise DatasetValidationError(
                "Dataset timestamps must be chronologically ordered."
            )

        duplicates = find_duplicate_timestamps(data)
        if duplicates.timestamps:
            raise DatasetValidationError(
                f"Duplicate timestamps found: {duplicates.timestamps[:5]}"
            )

        missing = find_missing_values(data, REQUIRED_COLUMNS)
        if missing.columns:
            raise DatasetValidationError(
                f"Missing OHLCV values found: {missing.columns}"
            )

        numeric = data[REQUIRED_COLUMNS].apply(pd.to_numeric, errors="coerce")
        if not numeric.map(lambda value: pd.notna(value) and abs(value) != float("inf")).all().all():
            raise DatasetValidationError(
                "OHLCV values must be finite numeric values."
            )

        invalid_prices = find_invalid_prices(data, PRICE_COLUMNS)
        if invalid_prices.columns:
            raise DatasetValidationError(
                f"Invalid prices found: {invalid_prices.columns}"
            )

        invalid_volume = find_invalid_volume(data)
        if invalid_volume.negative_count:
            raise DatasetValidationError(
                f"Negative volume values found: {invalid_volume.negative_count}"
            )

        if not data.empty:
            invalid_ohlc = (
                (numeric["high"] < numeric["low"])
                | (numeric["high"] < numeric["open"])
                | (numeric["high"] < numeric["close"])
                | (numeric["low"] > numeric["open"])
                | (numeric["low"] > numeric["close"])
            )
            if invalid_ohlc.any():
                raise DatasetValidationError(
                    f"Invalid OHLC candle relationships: {int(invalid_ohlc.sum())} rows"
                )

    def _path_for(self, key: str) -> Path:
        return self.cache_dir / f"{key}.pkl"

    def get(self, key: str) -> dict[str, Any] | None:
        path = self._path_for(key)
        if not path.is_file():
            return None

        try:
            with path.open("rb") as file:
                entry = pickle.load(file)

            if entry.get("key") != key:
                path.unlink(missing_ok=True)
                return None

            data = entry.get("ohlcv")
            if not isinstance(data, pd.DataFrame):
                path.unlink(missing_ok=True)
                return None

            self.validate(data)

            actual_fingerprint = self.fingerprint(data)
            if actual_fingerprint != entry.get("fingerprint"):
                path.unlink(missing_ok=True)
                return None

            entry["cache_hit"] = True
            return entry

        except (
            OSError,
            EOFError,
            pickle.UnpicklingError,
            AttributeError,
            TypeError,
            ValueError,
            KeyError,
        ):
            path.unlink(missing_ok=True)
            return None

    def put(
        self,
        *,
        key: str,
        dataset: MarketDataset,
        provider: str,
        data_version: str,
    ) -> dict[str, Any]:
        data = dataset.ohlcv.copy()
        self.validate(data)

        fingerprint = self.fingerprint(data)
        acquired_at = datetime.now(timezone.utc).isoformat()

        entry = {
            "key": key,
            "ohlcv": data,
            "fingerprint": fingerprint,
            "provider": provider,
            "data_version": data_version,
            "acquired_at": acquired_at,
            "row_count": len(data),
            "instrument_id": str(dataset.metadata["instrument_id"]),
            "start_date": dataset.start_date.isoformat(),
            "end_date": dataset.end_date.isoformat(),
            "frequency": dataset.frequency.value,
        }

        self.cache_dir.mkdir(parents=True, exist_ok=True)
        target = self._path_for(key)
        temp_path: Path | None = None

        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=self.cache_dir,
                prefix=f".{key}.",
                suffix=".tmp",
                delete=False,
            ) as file:
                temp_path = Path(file.name)
                pickle.dump(entry, file, protocol=pickle.HIGHEST_PROTOCOL)
                file.flush()
                os.fsync(file.fileno())

            os.replace(temp_path, target)
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

        entry["cache_hit"] = False
        return entry


def fingerprint_market_records(records) -> str:
    """Fingerprint the actual ordered OHLCV records returned by the database."""
    rows = [
        {
            "timestamp": pd.Timestamp(record.timestamp).isoformat(),
            "open": record.open,
            "high": record.high,
            "low": record.low,
            "close": record.close,
            "volume": record.volume,
        }
        for record in records
    ]
    canonical = json.dumps(
        rows,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()
