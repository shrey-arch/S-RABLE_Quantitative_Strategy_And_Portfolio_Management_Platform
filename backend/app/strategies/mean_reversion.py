import pandas as pd

from app.quant.statistics.z_score import rolling_z_score
from app.strategies.base import Strategy
from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction, StrategySignal


class MeanReversionStrategy(Strategy):
    """Simplified single-instrument z-score mean-reversion strategy."""

    def __init__(
        self,
        lookback: int = 20,
        entry_threshold: float = 2.0,
        exit_threshold: float = 0.0,
    ):
        if lookback <= 0:
            raise ValueError("lookback must be greater than 0.")

        if entry_threshold <= 0:
            raise ValueError("entry_threshold must be greater than 0.")

        if exit_threshold < 0:
            raise ValueError("exit_threshold must be non-negative.")

        if exit_threshold >= entry_threshold:
            raise ValueError(
                "exit_threshold must be less than entry_threshold."
            )

        self.lookback = lookback
        self.entry_threshold = entry_threshold
        self.exit_threshold = exit_threshold
        self.position_size = 1

    def generate_signal(self, context: StrategyContext) -> StrategySignal:
        data = context.market_data.get("data")

        if not isinstance(data, pd.DataFrame):
            raise ValueError(
                "context.market_data['data'] must be a pandas DataFrame."
            )

        if "close" not in data.columns:
            raise ValueError(
                "MeanReversionStrategy requires a 'close' column."
            )

        if len(data) < self.lookback:
            action = SignalAction.HOLD
        else:
            z_score = rolling_z_score(
                data,
                "close",
                self.lookback,
            )

            current_z_score = z_score.iloc[-1]

            if pd.isna(current_z_score):
                action = SignalAction.HOLD
            elif current_z_score <= -self.entry_threshold:
                action = SignalAction.BUY
            elif current_z_score >= self.entry_threshold:
                action = SignalAction.SELL
            else:
                action = SignalAction.HOLD

        return StrategySignal(
            action=action,
            timestamp=context.timestamp,
        )
