import pandas as pd

from app.quant.indicators.base import Indicator


class RSI(Indicator):
    """Relative Strength Index using Wilder's smoothing."""

    def __init__(self, period: int = 14):
        if period <= 0:
            raise ValueError("period must be greater than 0.")
        self.period = period

    def calculate(self, data: pd.DataFrame) -> pd.Series:
        if "close" not in data.columns:
            raise ValueError("Input data must contain a 'close' column.")

        delta = data["close"].diff()

        gains = delta.clip(lower=0)
        losses = -delta.clip(upper=0)

        average_gain = gains.ewm(
            alpha=1 / self.period,
            adjust=False,
            min_periods=self.period,
        ).mean()

        average_loss = losses.ewm(
            alpha=1 / self.period,
            adjust=False,
            min_periods=self.period,
        ).mean()

        relative_strength = average_gain / average_loss

        return 100 - (100 / (1 + relative_strength))
