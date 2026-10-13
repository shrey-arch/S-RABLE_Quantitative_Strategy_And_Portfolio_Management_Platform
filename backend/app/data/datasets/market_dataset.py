from dataclasses import dataclass
from datetime import date
from typing import Any

import pandas as pd

from app.enums import Timeframe
from app.models import Instrument


@dataclass
class MarketDataset:
    instrument: Instrument
    start_date: date
    end_date: date
    frequency: Timeframe
    ohlcv: pd.DataFrame
    metadata: dict[str, Any]
