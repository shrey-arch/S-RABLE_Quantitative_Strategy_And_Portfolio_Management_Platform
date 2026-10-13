import pandas as pd

from app.quant.statistics.returns import calculate_returns
from app.quant.statistics.rolling_std import rolling_std
from app.strategies.base import Strategy
from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction, StrategySignal


class VolatilityArbitrageStrategy(Strategy):
    """
    Simplified realized-volatility arbitrage proxy.

    This is not options implied-volatility arbitrage.
    It compares short-term realized volatility with
    long-term realized volatility using close-to-close returns.
    """

    def __init__(
        self,
        short_window: int = 5,
        long_window: int = 20,
    ):
        if short_window <= 0:
            raise ValueError("short_window must be greater than 0.")

        if long_window <= 0:
            raise ValueError("long_window must be greater than 0.")

        if short_window >= long_window:
            raise ValueError(
                "short_window must be less than long_window."
            )

        self.short_window = short_window
        self.long_window = long_window
        self.position_size = 1

    def generate_signal(self, context: StrategyContext) -> StrategySignal:
        data = context.market_data.get("data")

        if not isinstance(data, pd.DataFrame):
            raise ValueError(
                "context.market_data['data'] must be a pandas DataFrame."
            )

        if "close" not in data.columns:
            raise ValueError(
                "VolatilityArbitrageStrategy requires a 'close' column."
            )

        if len(data) < self.long_window:
            action = SignalAction.HOLD
        else:
            returns = pd.DataFrame(
                {"returns": calculate_returns(data)},
                index=data.index,
            )

            short_volatility = rolling_std(
                returns,
                "returns",
                self.short_window,
            )

            long_volatility = rolling_std(
                returns,
                "returns",
                self.long_window,
            )

            volatility_spread = short_volatility - long_volatility
            current_spread = volatility_spread.iloc[-1]

            if pd.isna(current_spread):
                action = SignalAction.HOLD
            elif current_spread > 0:
                action = SignalAction.SELL
            elif current_spread < 0:
                action = SignalAction.BUY
            else:
                action = SignalAction.HOLD

        return StrategySignal(
            action=action,
            timestamp=context.timestamp,
        )
