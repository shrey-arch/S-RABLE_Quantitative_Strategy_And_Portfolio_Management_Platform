import pandas as pd

from app.quant.indicators.sma import SMA
from app.strategies.base import Strategy
from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction, StrategySignal


class MomentumStrategy(Strategy):
    """Simple SMA-based momentum strategy."""

    def __init__(self, lookback: int = 20):
        if lookback <= 0:
            raise ValueError("lookback must be greater than 0.")

        self.lookback = lookback
        self.position_size = 1

    def generate_signal(self, context: StrategyContext) -> StrategySignal:
        data = context.market_data.get("data")

        if not isinstance(data, pd.DataFrame):
            raise ValueError("context.market_data['data'] must be a pandas DataFrame.")

        if "close" not in data.columns:
            raise ValueError("MomentumStrategy requires a 'close' column.")

        if len(data) < self.lookback:
            action = SignalAction.HOLD
        else:
            sma = SMA(self.lookback).calculate(data)
            current_close = data["close"].iloc[-1]
            current_sma = sma.iloc[-1]

            if pd.isna(current_sma):
                action = SignalAction.HOLD
            elif current_close > current_sma:
                action = SignalAction.BUY
            elif current_close < current_sma:
                action = SignalAction.SELL
            else:
                action = SignalAction.HOLD

        return StrategySignal(
            action=action,
            timestamp=context.timestamp,
        )
