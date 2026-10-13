import pandas as pd

from app.quant.indicators.base import Indicator


class ATR(Indicator):
    """Average True Range using Wilder's smoothing."""

    def __init__(self, period: int = 14):
        if period <= 0:
            raise ValueError("period must be greater than 0.")
        self.period = period

    def calculate(self, data: pd.DataFrame) -> pd.Series:
        required_columns = {"high", "low", "close"}
        missing_columns = required_columns - set(data.columns)

        if missing_columns:
            raise ValueError(
                f"Input data is missing required columns: "
                f"{sorted(missing_columns)}"
            )

        previous_close = data["close"].shift(1)

        true_range = pd.concat(
            [
                data["high"] - data["low"],
                (data["high"] - previous_close).abs(),
                (data["low"] - previous_close).abs(),
            ],
            axis=1,
        ).max(axis=1)

        return true_range.ewm(
            alpha=1 / self.period,
            adjust=False,
            min_periods=self.period,
        ).mean()
