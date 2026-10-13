import pandas as pd

from app.strategies.base import Strategy
from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction, StrategySignal


class TacticalAssetAllocationStrategy(Strategy):
    def __init__(self, lookback: int = 20, top_k: int = 2):
        if lookback <= 0:
            raise ValueError("lookback must be greater than 0.")
        if top_k <= 0:
            raise ValueError("top_k must be greater than 0.")

        self.lookback = lookback
        self.top_k = top_k

    def generate_signal(self, context: StrategyContext) -> StrategySignal:
        data = context.market_data.get("data")

        if not isinstance(data, pd.DataFrame):
            raise ValueError(
                "context.market_data['data'] must be a pandas DataFrame."
            )

        if data.shape[1] < self.top_k:
            raise ValueError(
                "TacticalAssetAllocationStrategy requires at least top_k asset columns."
            )

        if len(data) <= self.lookback:
            return StrategySignal(
                action=SignalAction.HOLD,
                timestamp=context.timestamp,
            )

        momentum = data.iloc[-1] / data.iloc[-1 - self.lookback] - 1

        ranked_assets = momentum.sort_values(ascending=False).index
        selected_assets = list(ranked_assets[:self.top_k])

        weight = 1.0 / self.top_k

        allocations = {
            asset: weight if asset in selected_assets else 0.0
            for asset in data.columns
        }

        current_allocations = context.market_data.get("current_allocations")

        if current_allocations is None:
            action = SignalAction.BUY
        elif allocations != current_allocations:
            action = SignalAction.BUY
        else:
            action = SignalAction.HOLD

        return StrategySignal(
            action=action,
            timestamp=context.timestamp,
            allocations=allocations,
        )
