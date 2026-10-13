from datetime import datetime, timezone

import pandas as pd
import pytest

from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction
from app.strategies.statistical_arbitrage import StatisticalArbitrageStrategy


def make_context(
    instrument_a: list[float],
    instrument_b: list[float],
) -> StrategyContext:
    data = pd.DataFrame(
        {
            "instrument_a": instrument_a,
            "instrument_b": instrument_b,
        },
        index=pd.date_range(
            "2026-01-01",
            periods=len(instrument_a),
            freq="D",
        ),
    )

    return StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 2, 1, tzinfo=timezone.utc),
        market_data={"data": data},
    )


def test_statistical_arbitrage_generates_buy_signal():
    instrument_a = [100.0] * 19 + [80.0]
    instrument_b = [100.0] * 20

    signal = StatisticalArbitrageStrategy(20).generate_signal(
        make_context(instrument_a, instrument_b)
    )

    assert signal.action == SignalAction.BUY


def test_statistical_arbitrage_generates_sell_signal():
    instrument_a = [100.0] * 19 + [120.0]
    instrument_b = [100.0] * 20

    signal = StatisticalArbitrageStrategy(20).generate_signal(
        make_context(instrument_a, instrument_b)
    )

    assert signal.action == SignalAction.SELL


def test_statistical_arbitrage_generates_hold_signal():
    instrument_a = [100.0] * 20
    instrument_b = [100.0] * 20

    signal = StatisticalArbitrageStrategy(20).generate_signal(
        make_context(instrument_a, instrument_b)
    )

    assert signal.action == SignalAction.HOLD


def test_statistical_arbitrage_holds_with_insufficient_history():
    instrument_a = [100.0] * 19
    instrument_b = [100.0] * 19

    signal = StatisticalArbitrageStrategy(20).generate_signal(
        make_context(instrument_a, instrument_b)
    )

    assert signal.action == SignalAction.HOLD


def test_statistical_arbitrage_preserves_context_timestamp():
    instrument_a = [100.0] * 19 + [80.0]
    instrument_b = [100.0] * 20

    context = make_context(instrument_a, instrument_b)

    signal = StatisticalArbitrageStrategy(20).generate_signal(context)

    assert signal.timestamp == context.timestamp


def test_statistical_arbitrage_rejects_invalid_lookback():
    with pytest.raises(
        ValueError,
        match="lookback must be greater than 0",
    ):
        StatisticalArbitrageStrategy(0)


def test_statistical_arbitrage_rejects_invalid_entry_threshold():
    with pytest.raises(
        ValueError,
        match="entry_threshold must be greater than 0",
    ):
        StatisticalArbitrageStrategy(20, 0)


def test_statistical_arbitrage_rejects_invalid_exit_threshold():
    with pytest.raises(
        ValueError,
        match="exit_threshold must be less than entry_threshold",
    ):
        StatisticalArbitrageStrategy(20, 2.0, 2.0)


def test_statistical_arbitrage_requires_dataframe():
    context = StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 2, 1, tzinfo=timezone.utc),
        market_data={"data": [100, 101, 102]},
    )

    with pytest.raises(
        ValueError,
        match="must be a pandas DataFrame",
    ):
        StatisticalArbitrageStrategy().generate_signal(context)


def test_statistical_arbitrage_requires_both_instruments():
    data = pd.DataFrame(
        {
            "instrument_a": [100.0] * 20,
        },
        index=pd.date_range(
            "2026-01-01",
            periods=20,
            freq="D",
        ),
    )

    context = StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 2, 1, tzinfo=timezone.utc),
        market_data={"data": data},
    )

    with pytest.raises(
        ValueError,
        match="instrument_a.*instrument_b",
    ):
        StatisticalArbitrageStrategy().generate_signal(context)
from datetime import datetime, timezone

from app.strategies.signal import SignalAction, StrategySignal


def test_statistical_arbitrage_signal_can_describe_two_legs():
    signal = StrategySignal(
        action=SignalAction.BUY,
        timestamp=datetime.now(timezone.utc),
        allocations={
            "instrument_a": 1.0,
            "instrument_b": -1.0,
        },
    )

    assert signal.action == SignalAction.BUY
    assert signal.allocations["instrument_a"] == 1.0
    assert signal.allocations["instrument_b"] == -1.0
