import pandas as pd

from app.quant.statistics.z_score import rolling_z_score
from app.strategies.base import Strategy
from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction, StrategySignal


class StatisticalArbitrageStrategy(Strategy):
    """
    Simplified academic pairs-trading strategy.

    BUY means long instrument A and short instrument B.
    SELL means short instrument A and long instrument B.

    This is not a full cointegration or hedge-ratio model.
    It assumes equal 1-unit legs.
    """

    def __init__(
        self,
        lookback: int = 20,
        entry_threshold: float = 2.0,
        exit_threshold: float = 0.0,
    ):
        if lookback <= 0:
            raise ValueError("lookback must be greater than 0.")

        if entry_threshold <= 0:
            raise ValueError(
                "entry_threshold must be greater than 0."
            )

        if exit_threshold < 0:
            raise ValueError(
                "exit_threshold must be non-negative."
            )

        if exit_threshold >= entry_threshold:
            raise ValueError(
                "exit_threshold must be less than entry_threshold."
            )

        self.lookback = lookback
        self.entry_threshold = entry_threshold
        self.exit_threshold = exit_threshold
        self.position_size = 1
        self.legs = 2

    def generate_signal(
        self,
        context: StrategyContext,
    ) -> StrategySignal:
        data = context.market_data.get("data")

        if not isinstance(data, pd.DataFrame):
            raise ValueError(
                "context.market_data['data'] must be a pandas DataFrame."
            )

        required_columns = {"instrument_a", "instrument_b"}

        if not required_columns.issubset(data.columns):
            raise ValueError(
                "StatisticalArbitrageStrategy requires "
                "'instrument_a' and 'instrument_b' columns."
            )

        action = SignalAction.HOLD

        if len(data) >= self.lookback:
            spread = data["instrument_a"] - data["instrument_b"]

            spread_data = pd.DataFrame(
                {"spread": spread},
                index=data.index,
            )

            z_score = rolling_z_score(
                spread_data,
                "spread",
                self.lookback,
            )

            current_z_score = z_score.iloc[-1]

            if not pd.isna(current_z_score):
                if current_z_score <= -self.entry_threshold:
                    action = SignalAction.BUY
                elif current_z_score >= self.entry_threshold:
                    action = SignalAction.SELL

        if action == SignalAction.BUY:
            allocations = {
                "instrument_a": float(self.position_size),
                "instrument_b": -float(self.position_size),
            }
        elif action == SignalAction.SELL:
            allocations = {
                "instrument_a": -float(self.position_size),
                "instrument_b": float(self.position_size),
            }
        else:
            allocations = {}

        return StrategySignal(
            action=action,
            timestamp=context.timestamp,
            allocations=allocations,
        )
