"""Phase 10.5: no-code strategies run by the rule engine (RuleStrategy), long only."""

import math
from uuid import uuid4

import numpy as np
import pandas as pd
import pytest

from app.backtesting.engine import BacktestEngine
from app.quant.indicators.catalogue import INDICATORS, compute_indicator, validate_indicator
from app.strategies.base import Strategy
from app.strategies.context import StrategyContext
from app.strategies.factory import build_strategy, effective_parameters, instrument_layout
from app.strategies.rule_strategy import RULES_KEY, RuleStrategy
from app.strategies.signal import SignalAction, StrategySignal

B, S, H, X = SignalAction.BUY, SignalAction.SELL, SignalAction.HOLD, SignalAction.EXIT


def bars(closes, **columns):
    index = pd.date_range("2025-01-01", periods=len(closes), freq="D", tz="UTC")
    data = {
        "open": closes,
        "high": [c + 1 for c in closes],
        "low": [c - 1 for c in closes],
        "close": closes,
        "volume": [1000] * len(closes),
    }
    data.update(columns)
    return pd.DataFrame(data, index=index).astype(float)


def price(field="close"):
    return {"type": "price", "field": field}


def ind(name, output=None):
    operand = {"type": "indicator", "name": name}
    if output:
        operand["output"] = output
    return operand


def value(v):
    return {"type": "value", "value": v}


def cond(left, op, right):
    return {"left": left, "operator": op, "right": right}


def config(entry, exit=(), indicators=()):
    return {
        "parameters": {},
        "indicators": list(indicators),
        "entry_conditions": list(entry),
        "exit_conditions": list(exit),
    }


SMA3 = {"name": "sma3", "type": "SMA", "parameters": {"window": 3}}
CROSS = config(
    entry=[cond(price(), ">", ind("sma3"))],
    exit=[cond(price(), "<", ind("sma3"))],
    indicators=[SMA3],
)


def signals(strategy, data, positions=None):
    """Feeds the strategy bar by bar, as the engine does (expanding history)."""
    out = []
    for i in range(1, len(data) + 1):
        market = {"data": data.iloc[:i]}
        if positions is not None:
            market["position_quantity"] = positions[i - 1]
        context = StrategyContext(instrument=None, timestamp=data.index[i - 1], market_data=market)
        out.append(strategy.generate_signal(context).action)
    return out


def run(strategy, data, quantity=10, capital=1000.0):
    return BacktestEngine().run(
        strategy=strategy,
        data=data,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        initial_capital=capital,
        quantity=quantity,
    )


# --- a hand-checked run ----------------------------------------------------------------
#   close   10   11   12    11     9      10   12     13
#   SMA(3)  -    -    11    11.33  10.67  10   10.33  11.67
#   flat:   -    -    12>11 BUY           (10>10 no)  12>10.33 BUY
#   long:                   11<11.33 EXIT                       13<11.67 no -> held


def test_a_hand_checked_rule_strategy_trades_exactly_as_expected():
    data = bars([10, 11, 12, 11, 9, 10, 12, 13])
    result = run(RuleStrategy(CROSS), data)
    fills = [(t["timestamp"].day, t["side"], t["quantity"], t["price"]) for t in result.trades]
    assert fills == [(3, "BUY", 10, 12.0), (4, "SELL", 10, 11.0), (7, "BUY", 10, 12.0)]
    values = [p["portfolio_value"] for p in result.equity_curve]
    assert values == pytest.approx([1000, 1000, 1000, 990, 990, 990, 990, 1000])


def test_signals_follow_the_long_only_state_machine():
    data = bars([10, 11, 12, 11, 9, 10, 12, 13])
    assert signals(RuleStrategy(CROSS), data) == [H, H, B, X, H, H, B, H]


def test_without_exit_conditions_the_position_is_held_to_the_end():
    rules = config(entry=[cond(price(), ">", value(11))])
    data = bars([10, 12, 9, 8, 13])
    assert signals(RuleStrategy(rules), data) == [H, B, H, H, H]
    result = run(RuleStrategy(rules), data)
    assert [(t["side"], t["quantity"]) for t in result.trades] == [("BUY", 10)]


def test_all_conditions_must_hold_together():
    rules = config(
        entry=[cond(price(), ">", value(10)), cond(price("volume"), ">=", value(2000))],
    )
    data = bars([11, 12, 13], volume=[1000, 2500, 2500])
    assert signals(RuleStrategy(rules), data) == [H, B, H]


@pytest.mark.parametrize(
    "op,left,right,holds",
    [
        ("<", 1, 2, True), ("<", 2, 2, False),
        ("<=", 2, 2, True), ("<=", 3, 2, False),
        (">", 3, 2, True), (">", 2, 2, False),
        (">=", 2, 2, True), (">=", 1, 2, False),
        ("==", 2, 2, True), ("==", 2.5, 2, False),
    ],
)
def test_each_operator(op, left, right, holds):
    rules = config(entry=[cond(value(left), op, value(right))])
    assert signals(RuleStrategy(rules), bars([5]))[0] == (B if holds else H)


def test_nothing_trades_while_an_indicator_warms_up():
    rules = config(entry=[cond(price(), ">", value(0)), cond(ind("sma3"), ">", value(0))], indicators=[SMA3])
    assert signals(RuleStrategy(rules), bars([5, 6, 7, 8])) == [H, H, B, H]


def test_multi_line_indicators_use_the_chosen_line():
    bands = {"name": "bb", "type": "BOLLINGER", "parameters": {"window": 5, "num_std": 1.0}}
    rules = config(
        entry=[cond(price(), "<", ind("bb", "lower"))],
        exit=[cond(price(), ">", ind("bb", "upper"))],
        indicators=[bands],
    )
    closes = [100, 100, 100, 100, 100, 90, 95, 100, 120, 100]
    data = bars(closes)
    frame = compute_indicator(INDICATORS["BOLLINGER"], validate_indicator("BOLLINGER", bands["parameters"])[1], data)
    expected = []
    holding = False
    for i, close in enumerate(closes):
        lower, upper = frame["lower"].iloc[i], frame["upper"].iloc[i]
        if holding:
            hit = not math.isnan(upper) and close > upper
            expected.append(X if hit else H)
            holding = not hit
        else:
            hit = not math.isnan(lower) and close < lower
            expected.append(B if hit else H)
            holding = hit
    assert signals(RuleStrategy(rules), data) == expected
    assert B in expected and X in expected


def test_the_engine_says_what_is_held():
    # The engine passes the position; the strategy follows it, not its own memory.
    rules = config(entry=[cond(price(), ">", value(0))], exit=[cond(price(), ">", value(0))])
    data = bars([5, 5, 5])
    assert signals(RuleStrategy(rules), data, positions=[0, 0, 0]) == [B, B, B]
    assert signals(RuleStrategy(rules), data, positions=[1, 1, 1]) == [X, X, X]


# --- computing indicators once is the same as bar by bar (no look-ahead) ---------------


def random_walk(n=150, seed=7):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(0, 0.02, n)))
    high = close * (1 + rng.uniform(0, 0.02, n))
    low = close * (1 - rng.uniform(0, 0.02, n))
    index = pd.date_range("2024-01-01", periods=n, freq="D", tz="UTC")
    return pd.DataFrame(
        {"open": close, "high": high, "low": low, "close": close, "volume": 1000.0}, index=index
    )


@pytest.mark.parametrize("key", sorted(INDICATORS))
def test_every_catalogue_indicator_is_causal(key):
    """The value at a bar computed on the whole run equals the value computed on the
    data up to that bar only. This is what makes computing once safe."""
    spec = INDICATORS[key]
    parameters = {p.name: (p.default if p.default is not None else 5) for p in spec.parameters}
    _, parameters = validate_indicator(key, parameters)
    data = random_walk()
    full = compute_indicator(spec, parameters, data)
    for i in range(1, len(data) + 1):
        prefix = compute_indicator(spec, parameters, data.iloc[:i]).iloc[-1]
        for output in spec.outputs:
            a, b = full[output].iloc[i - 1], prefix[output]
            assert (pd.isna(a) and pd.isna(b)) or a == pytest.approx(b, rel=1e-9, abs=1e-12), (
                key, output, i
            )


def test_prepared_and_bar_by_bar_signals_are_identical():
    data = random_walk(200, seed=3)
    rules = config(
        entry=[cond(ind("fast"), ">", ind("slow")), cond(ind("rsi"), "<", value(70))],
        exit=[cond(ind("macd", "histogram"), "<", value(0))],
        indicators=[
            {"name": "fast", "type": "EMA", "parameters": {"window": 5}},
            {"name": "slow", "type": "SMA", "parameters": {"window": 20}},
            {"name": "rsi", "type": "RSI", "parameters": {"period": 14}},
            {"name": "macd", "type": "MACD", "parameters": {}},
        ],
    )
    prepared = RuleStrategy(rules)
    prepared.prepare(data)
    bar_by_bar = signals(RuleStrategy(rules), data)
    assert signals(prepared, data) == bar_by_bar
    assert bar_by_bar.count(B) > 0 and bar_by_bar.count(X) > 0


# --- the engine's EXIT action ---------------------------------------------------------


class Sequence(Strategy):
    def __init__(self, actions):
        self.actions = list(actions)

    def generate_signal(self, context):
        return StrategySignal(action=self.actions.pop(0), timestamp=context.timestamp)


@pytest.mark.parametrize(
    "actions,expected",
    [
        ([B, X, X], [("BUY", 10), ("SELL", 10)]),
        ([S, X, H], [("SELL", 10), ("BUY", 10)]),
        ([X, X, X], []),
    ],
)
def test_exit_goes_back_to_flat_from_long_or_short(actions, expected):
    result = run(Sequence(actions), bars([10, 10, 10]), capital=10000.0)
    assert [(t["side"], t["quantity"]) for t in result.trades] == expected
    assert result.final_capital == pytest.approx(10000.0)


# --- validation -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "rules,message",
    [
        (config(entry=[]), "Add at least one entry condition"),
        (config(entry=[cond(price(), ">", value("high"))]), "Condition values must be numbers"),
        (config(entry=[cond(price(), ">", value(True))]), "Condition values must be numbers"),
        (config(entry=[cond(price(), ">", ind("nope"))]), "The saved rules are not valid: Unknown indicator reference: nope"),
        ({"parameters": {}}, "The saved rules are not valid"),
    ],
)
def test_invalid_rules_are_refused(rules, message):
    with pytest.raises(ValueError, match=message.replace("(", r"\(")):
        RuleStrategy(rules)


def test_missing_price_columns_are_reported():
    rules = config(entry=[cond(price("volume"), ">", value(0))])
    with pytest.raises(ValueError, match="volume"):
        RuleStrategy(rules).prepare(pd.DataFrame({"close": [1.0]}, index=pd.date_range("2025-01-01", periods=1, tz="UTC")))


def test_the_factory_builds_rules_or_templates():
    assert isinstance(build_strategy(RULES_KEY, CROSS), RuleStrategy)
    assert type(build_strategy("momentum", {"lookback": 5})).__name__ == "MomentumStrategy"
    assert effective_parameters(RULES_KEY, CROSS) == CROSS
    assert effective_parameters("momentum", {})["lookback"] == 20
    assert instrument_layout(RULES_KEY) == "single"
    assert instrument_layout("statistical_arbitrage") == "pair"
