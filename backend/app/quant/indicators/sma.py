import pandas as pd

from app.quant.indicators.base import Indicator


class SMA(Indicator):
    """Simple Moving Average."""

    def __init__(self, window: int):
        if window <= 0:
            raise ValueError("window must be greater than 0.")
        self.window = window

    def calculate(self, data: pd.DataFrame) -> pd.Series:
        if "close" not in data.columns:
            raise ValueError("Input data must contain a 'close' column.")

        return data["close"].rolling(window=self.window).mean()
