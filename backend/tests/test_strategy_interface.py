from datetime import datetime, timezone

import pytest

from app.strategies.base import Strategy
from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction, StrategySignal


def test_strategy_interface_requires_generate_signal():
    class IncompleteStrategy(Strategy):
        pass

    with pytest.raises(TypeError):
        IncompleteStrategy()


def test_concrete_strategy_can_generate_signal():
    class DummyStrategy(Strategy):
        def generate_signal(
            self,
            context: StrategyContext,
        ) -> StrategySignal:
            return StrategySignal(
                action=SignalAction.BUY,
                timestamp=context.timestamp,
            )

    strategy = DummyStrategy()

    context = StrategyContext(
        instrument="TEST",
        timestamp=datetime.now(timezone.utc),
        market_data={"price": 100},
    )

    signal = strategy.generate_signal(context)

    assert isinstance(signal, StrategySignal)
    assert signal.action == SignalAction.BUY
    assert signal.timestamp == context.timestamp
@pytest.mark.parametrize(
    "action",
    [
        SignalAction.BUY,
        SignalAction.SELL,
        SignalAction.HOLD,
    ],
)
def test_strategy_signal_supports_all_actions(action):
    timestamp = datetime.now(timezone.utc)

    signal = StrategySignal(
        action=action,
        timestamp=timestamp,
    )

    assert signal.action == action
    assert signal.timestamp == timestamp

def test_strategy_context_preserves_input():
    timestamp = datetime.now(timezone.utc)
    market_data = {"price": 100, "volume": 500}

    context = StrategyContext(
        instrument="TEST",
        timestamp=timestamp,
        market_data=market_data,
    )

    assert context.instrument == "TEST"
    assert context.timestamp == timestamp
    assert context.market_data == market_data

def test_strategy_context_requires_all_fields():
    with pytest.raises(TypeError):
        StrategyContext()
from datetime import datetime, timezone

from app.strategies.signal import SignalAction, StrategySignal


def test_strategy_signal_supports_allocations():
    timestamp = datetime.now(timezone.utc)
    allocations = {
        "asset_a": 0.5,
        "asset_b": 0.5,
    }

    signal = StrategySignal(
        action=SignalAction.HOLD,
        timestamp=timestamp,
        allocations=allocations,
    )

    assert signal.allocations == allocations


def test_strategy_signal_defaults_to_empty_allocations():
    timestamp = datetime.now(timezone.utc)

    signal = StrategySignal(
        action=SignalAction.HOLD,
        timestamp=timestamp,
    )

    assert signal.allocations == {}
