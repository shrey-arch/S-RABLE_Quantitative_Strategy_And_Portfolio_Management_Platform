import pandas as pd

from app.quant.indicators.base import Indicator
from app.quant.indicators.sma import SMA


class BollingerBands(Indicator):
    """Bollinger Bands based on rolling SMA and standard deviation."""

    def __init__(self, window: int = 20, num_std: float = 2.0):
        if window <= 0:
            raise ValueError("window must be greater than 0.")
        if num_std < 0:
            raise ValueError("num_std must be non-negative.")

        self.window = window
        self.num_std = num_std

    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        if "close" not in data.columns:
            raise ValueError("Input data must contain a 'close' column.")

        middle = SMA(self.window).calculate(data)
        rolling_std = data["close"].rolling(window=self.window).std()

        upper = middle + (self.num_std * rolling_std)
        lower = middle - (self.num_std * rolling_std)

        return pd.DataFrame(
            {
                "middle": middle,
                "upper": upper,
                "lower": lower,
            },
            index=data.index,
        )
