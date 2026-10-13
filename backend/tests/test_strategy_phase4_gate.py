from datetime import datetime, timezone

import pandas as pd
import pytest

from app.strategies.context import StrategyContext
from app.strategies.registry import StrategyRegistry
from app.strategies.signal import SignalAction, StrategySignal


def make_single_asset_data(length=30):
    return pd.DataFrame(
        {
            "close": [100 + i for i in range(length)],
        }
    )


def make_pairs_data(length=30):
    return pd.DataFrame(
        {
            "instrument_a": [100 + i for i in range(length)],
            "instrument_b": [100 + 0.5 * i for i in range(length)],
        }
    )


def make_taa_data(length=30):
    return pd.DataFrame(
        {
            "asset_a": [100 + i for i in range(length)],
            "asset_b": [100 + 2 * i for i in range(length)],
            "asset_c": [100 + 0.5 * i for i in range(length)],
        }
    )


def make_context(data):
    return StrategyContext(
        instrument="TEST",
        timestamp=datetime.now(timezone.utc),
        market_data={"data": data},
    )


@pytest.mark.parametrize(
    "name,data",
    [
        ("momentum", make_single_asset_data()),
        ("mean_reversion", make_single_asset_data()),
        ("volatility_arbitrage", make_single_asset_data()),
        ("statistical_arbitrage", make_pairs_data()),
        ("tactical_asset_allocation", make_taa_data()),
    ],
)
def test_all_strategies_produce_valid_signals(name, data):
    strategy = StrategyRegistry.get(name)
    signal = strategy.generate_signal(make_context(data))

    assert isinstance(signal, StrategySignal)
    assert isinstance(signal.action, SignalAction)
    assert signal.timestamp is not None


def test_taa_produces_portfolio_allocations():
    strategy = StrategyRegistry.get("tactical_asset_allocation")
    signal = strategy.generate_signal(make_context(make_taa_data()))

    assert signal.allocations
    assert sum(signal.allocations.values()) == pytest.approx(1.0)
    assert set(signal.allocations) == {"asset_a", "asset_b", "asset_c"}
