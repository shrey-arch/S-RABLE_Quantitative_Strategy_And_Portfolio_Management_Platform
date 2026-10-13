from datetime import datetime, timezone

import pandas as pd
import pytest

from app.strategies.context import StrategyContext
from app.strategies.momentum import MomentumStrategy
from app.strategies.signal import SignalAction


def make_context(closes: list[float]) -> StrategyContext:
    data = pd.DataFrame(
        {"close": closes},
        index=pd.date_range("2026-01-01", periods=len(closes), freq="D"),
    )

    return StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 1, 21, tzinfo=timezone.utc),
        market_data={"data": data},
    )


def test_momentum_generates_buy_signal():
    closes = [100.0] * 19 + [110.0]

    signal = MomentumStrategy(20).generate_signal(make_context(closes))

    assert signal.action == SignalAction.BUY


def test_momentum_generates_sell_signal():
    closes = [100.0] * 19 + [90.0]

    signal = MomentumStrategy(20).generate_signal(make_context(closes))

    assert signal.action == SignalAction.SELL


def test_momentum_generates_hold_when_price_equals_sma():
    closes = [100.0] * 20

    signal = MomentumStrategy(20).generate_signal(make_context(closes))

    assert signal.action == SignalAction.HOLD


def test_momentum_holds_with_insufficient_history():
    closes = [100.0] * 19

    signal = MomentumStrategy(20).generate_signal(make_context(closes))

    assert signal.action == SignalAction.HOLD


def test_momentum_preserves_context_timestamp():
    closes = [100.0] * 19 + [110.0]
    context = make_context(closes)

    signal = MomentumStrategy(20).generate_signal(context)

    assert signal.timestamp == context.timestamp


def test_momentum_rejects_invalid_lookback():
    with pytest.raises(ValueError, match="lookback must be greater than 0"):
        MomentumStrategy(0)


def test_momentum_requires_dataframe():
    context = StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 1, 21, tzinfo=timezone.utc),
        market_data={"data": [100, 101, 102]},
    )

    with pytest.raises(
        ValueError,
        match="must be a pandas DataFrame",
    ):
        MomentumStrategy(20).generate_signal(context)


def test_momentum_requires_close_column():
    data = pd.DataFrame(
        {"open": [100.0] * 20},
        index=pd.date_range("2026-01-01", periods=20, freq="D"),
    )

    context = StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 1, 21, tzinfo=timezone.utc),
        market_data={"data": data},
    )

    with pytest.raises(ValueError, match="requires a 'close' column"):
        MomentumStrategy(20).generate_signal(context)
