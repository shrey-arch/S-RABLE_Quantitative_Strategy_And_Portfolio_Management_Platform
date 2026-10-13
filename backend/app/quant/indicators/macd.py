import pandas as pd

from app.quant.indicators.base import Indicator
from app.quant.indicators.ema import EMA


class MACD(Indicator):
    """Moving Average Convergence Divergence."""

    def __init__(
        self,
        fast_period: int = 12,
        slow_period: int = 26,
        signal_period: int = 9,
    ):
        if fast_period <= 0:
            raise ValueError("fast_period must be greater than 0.")
        if slow_period <= 0:
            raise ValueError("slow_period must be greater than 0.")
        if signal_period <= 0:
            raise ValueError("signal_period must be greater than 0.")
        if fast_period >= slow_period:
            raise ValueError("fast_period must be less than slow_period.")

        self.fast_period = fast_period
        self.slow_period = slow_period
        self.signal_period = signal_period

    def calculate(self, data: pd.DataFrame) -> pd.DataFrame:
        if "close" not in data.columns:
            raise ValueError("Input data must contain a 'close' column.")

        fast_ema = EMA(self.fast_period).calculate(data)
        slow_ema = EMA(self.slow_period).calculate(data)

        macd = fast_ema - slow_ema

        signal = macd.ewm(
            span=self.signal_period,
            adjust=False,
        ).mean()

        histogram = macd - signal

        return pd.DataFrame(
            {
                "macd": macd,
                "signal": signal,
                "histogram": histogram,
            },
            index=data.index,
        )
