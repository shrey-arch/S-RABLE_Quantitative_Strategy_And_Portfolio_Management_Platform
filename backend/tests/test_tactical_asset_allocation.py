from datetime import datetime, timezone

import pandas as pd
import pytest

from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction
from app.strategies.tactical_asset_allocation import (
    TacticalAssetAllocationStrategy,
)


def make_context(data):
    return StrategyContext(
        instrument="PORTFOLIO",
        timestamp=datetime.now(timezone.utc),
        market_data={"data": data},
    )


def test_taa_selects_top_two_assets():
    data = pd.DataFrame(
        {
            "asset_a": [100 + i for i in range(21)],
            "asset_b": [100 + 2 * i for i in range(21)],
            "asset_c": [100 + 0.5 * i for i in range(21)],
        }
    )

    strategy = TacticalAssetAllocationStrategy(lookback=20, top_k=2)
    signal = strategy.generate_signal(make_context(data))

    assert signal.action == SignalAction.BUY
    assert signal.allocations["asset_b"] == 0.5
    assert signal.allocations["asset_a"] == 0.5
    assert signal.allocations["asset_c"] == 0.0


def test_taa_allocations_sum_to_one():
    data = pd.DataFrame(
        {
            "asset_a": [100 + i for i in range(21)],
            "asset_b": [100 + 2 * i for i in range(21)],
            "asset_c": [100 + 3 * i for i in range(21)],
        }
    )

    strategy = TacticalAssetAllocationStrategy(lookback=20, top_k=2)
    signal = strategy.generate_signal(make_context(data))

    assert sum(signal.allocations.values()) == pytest.approx(1.0)


def test_taa_returns_empty_allocations_with_insufficient_history():
    data = pd.DataFrame(
        {
            "asset_a": [100 + i for i in range(20)],
            "asset_b": [100 + 2 * i for i in range(20)],
            "asset_c": [100 + 3 * i for i in range(20)],
        }
    )

    strategy = TacticalAssetAllocationStrategy(lookback=20, top_k=2)
    signal = strategy.generate_signal(make_context(data))

    assert signal.action == SignalAction.HOLD
    assert signal.allocations == {}


def test_taa_requires_enough_assets_for_top_k():
    data = pd.DataFrame(
        {
            "asset_a": [100 + i for i in range(21)],
        }
    )

    strategy = TacticalAssetAllocationStrategy(lookback=20, top_k=2)

    with pytest.raises(ValueError):
        strategy.generate_signal(make_context(data))


def test_taa_rejects_invalid_lookback():
    with pytest.raises(ValueError):
        TacticalAssetAllocationStrategy(lookback=0)


def test_taa_rejects_invalid_top_k():
    with pytest.raises(ValueError):
        TacticalAssetAllocationStrategy(top_k=0)


def test_taa_rejects_non_dataframe_input():
    context = StrategyContext(
        instrument="PORTFOLIO",
        timestamp=datetime.now(timezone.utc),
        market_data={"data": {"asset_a": 100}},
    )

    strategy = TacticalAssetAllocationStrategy()

    with pytest.raises(ValueError):
        strategy.generate_signal(context)
def test_taa_detects_changed_target_allocation():
    data = pd.DataFrame(
        {
            "asset_a": [100 + i for i in range(21)],
            "asset_b": [100 + 2 * i for i in range(21)],
            "asset_c": [100 + 0.5 * i for i in range(21)],
        }
    )

    context = StrategyContext(
        instrument="PORTFOLIO",
        timestamp=datetime.now(timezone.utc),
        market_data={
            "data": data,
            "current_allocations": {
                "asset_a": 0.0,
                "asset_b": 0.0,
                "asset_c": 1.0,
            },
        },
    )

    strategy = TacticalAssetAllocationStrategy(lookback=20, top_k=2)
    signal = strategy.generate_signal(context)

    assert signal.allocations != context.market_data["current_allocations"]


def test_taa_target_allocation_matches_current_allocation():
    data = pd.DataFrame(
        {
            "asset_a": [100 + i for i in range(21)],
            "asset_b": [100 + 2 * i for i in range(21)],
            "asset_c": [100 + 0.5 * i for i in range(21)],
        }
    )

    current_allocations = {
        "asset_a": 0.5,
        "asset_b": 0.5,
        "asset_c": 0.0,
    }

    context = StrategyContext(
        instrument="PORTFOLIO",
        timestamp=datetime.now(timezone.utc),
        market_data={
            "data": data,
            "current_allocations": current_allocations,
        },
    )

    strategy = TacticalAssetAllocationStrategy(lookback=20, top_k=2)
    signal = strategy.generate_signal(context)

    assert signal.allocations == current_allocations
