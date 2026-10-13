from datetime import datetime, timezone

import pandas as pd
import pytest

from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction
from app.strategies.volatility_arbitrage import VolatilityArbitrageStrategy


def make_context(closes: list[float]) -> StrategyContext:
    data = pd.DataFrame(
        {"close": closes},
        index=pd.date_range("2026-01-01", periods=len(closes), freq="D"),
    )

    return StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 2, 1, tzinfo=timezone.utc),
        market_data={"data": data},
    )


def test_volatility_arbitrage_generates_sell_when_short_term_volatility_is_higher():
    closes = [100.0]

    for _ in range(15):
        closes.append(closes[-1] * 1.001)

    for i in range(5):
        closes.append(closes[-1] * (1.20 if i % 2 == 0 else 0.80))

    signal = VolatilityArbitrageStrategy(5, 20).generate_signal(
        make_context(closes)
    )

    assert signal.action == SignalAction.SELL


def test_volatility_arbitrage_generates_buy_when_short_term_volatility_is_lower():
    closes = [100.0]

    for i in range(16):
        closes.append(closes[-1] * (1.20 if i % 2 == 0 else 0.80))

    for _ in range(5):
        closes.append(closes[-1] * 1.001)

    signal = VolatilityArbitrageStrategy(5, 20).generate_signal(
        make_context(closes)
    )

    assert signal.action == SignalAction.BUY


def test_volatility_arbitrage_generates_hold_when_volatility_is_equal():
    closes = [100.0]

    for _ in range(20):
        closes.append(closes[-1] * 1.01)

    signal = VolatilityArbitrageStrategy(5, 20).generate_signal(
        make_context(closes)
    )

    assert signal.action == SignalAction.HOLD


def test_volatility_arbitrage_holds_with_insufficient_history():
    closes = [100.0] * 19

    signal = VolatilityArbitrageStrategy(5, 20).generate_signal(
        make_context(closes)
    )

    assert signal.action == SignalAction.HOLD


def test_volatility_arbitrage_preserves_context_timestamp():
    closes = [100.0]

    for _ in range(14):
        closes.append(closes[-1] * 1.001)

    for i in range(5):
        closes.append(closes[-1] * (1.20 if i % 2 == 0 else 0.80))

    context = make_context(closes)

    signal = VolatilityArbitrageStrategy(5, 20).generate_signal(context)

    assert signal.timestamp == context.timestamp


def test_volatility_arbitrage_rejects_invalid_windows():
    with pytest.raises(
        ValueError,
        match="short_window must be greater than 0",
    ):
        VolatilityArbitrageStrategy(0, 20)

    with pytest.raises(
        ValueError,
        match="long_window must be greater than 0",
    ):
        VolatilityArbitrageStrategy(5, 0)

    with pytest.raises(
        ValueError,
        match="short_window must be less than long_window",
    ):
        VolatilityArbitrageStrategy(20, 20)


def test_volatility_arbitrage_requires_dataframe():
    context = StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 2, 1, tzinfo=timezone.utc),
        market_data={"data": [100, 101, 102]},
    )

    with pytest.raises(
        ValueError,
        match="must be a pandas DataFrame",
    ):
        VolatilityArbitrageStrategy().generate_signal(context)


def test_volatility_arbitrage_requires_close_column():
    data = pd.DataFrame(
        {"open": [100.0] * 20},
        index=pd.date_range("2026-01-01", periods=20, freq="D"),
    )

    context = StrategyContext(
        instrument=None,
        timestamp=datetime(2026, 2, 1, tzinfo=timezone.utc),
        market_data={"data": data},
    )

    with pytest.raises(
        ValueError,
        match="requires a 'close' column",
    ):
        VolatilityArbitrageStrategy().generate_signal(context)
