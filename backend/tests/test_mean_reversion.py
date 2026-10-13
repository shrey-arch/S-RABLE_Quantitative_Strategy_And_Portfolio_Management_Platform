from datetime import datetime, timezone

import pandas as pd
import pytest

from app.strategies.context import StrategyContext
from app.strategies.mean_reversion import MeanReversionStrategy
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


def test_mean_reversion_generates_buy_signal():
    closes = [100.0] * 19 + [80.0]

    signal = MeanReversionStrategy(20).generate_signal(make_context(closes))

    assert signal.action == SignalAction.BUY


def test_mean_reversion_generates_sell_signal():
    closes = [100.0] * 19 + [120.0]

    signal = MeanReversionStrategy(20).generate_signal(make_context(closes))

    assert signal.action == SignalAction.SELL


def test_mean_reversion_generates_hold_inside_threshold():
    closes = [100.0] * 20

    signal = MeanReversionStrategy(20).generate_signal(make_context(closes))

    assert signal.action == SignalAction.HOLD


def test_mean_reversion_holds_with_insufficient_history():
    closes = [100.0] * 19

    signal = MeanReversionStrategy(20).generate_signal(make_context(closes))

    assert signal.action == SignalAction.HOLD


def test_mean_reversion_preserves_context_timestamp():
    closes = [100.0] * 19 + [80.0]
    context = make_context(closes)

    signal = MeanReversionStrategy(20).generate_signal(context)

    assert signal.timestamp == context.timestamp


def test_mean_reversion_rejects_invalid_lookback():
    with pytest.raises(ValueError, match="lookback must be greater than 0"):
        MeanReversionStrategy(0)


def test_mean_reversion_rejects_invalid_entry_threshold():
    with pytest.raises(
        ValueError,
        match="entry_threshold must be greater than 0",
    ):
        MeanReversionStrategy(20, 0)


def test_mean_reversion_rejects_invalid_exit_threshold():
    with pytest.raises(
        ValueError,
        match="exit_threshold must be less than entry_threshold",
    ):
        MeanReversionStrategy(20, 2.0, 2.0)


def test_mean_reversion_requires_dataframe():
    context = StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 1, 21, tzinfo=timezone.utc),
        market_data={"data": [100, 101, 102]},
    )

    with pytest.raises(
        ValueError,
        match="must be a pandas DataFrame",
    ):
        MeanReversionStrategy(20).generate_signal(context)


def test_mean_reversion_requires_close_column():
    data = pd.DataFrame(
        {"open": [100.0] * 20},
        index=pd.date_range("2026-01-01", periods=20, freq="D"),
    )

    context = StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 1, 21, tzinfo=timezone.utc),
        market_data={"data": data},
    )

    with pytest.raises(
        ValueError,
        match="requires a 'close' column",
    ):
        MeanReversionStrategy(20).generate_signal(context)
