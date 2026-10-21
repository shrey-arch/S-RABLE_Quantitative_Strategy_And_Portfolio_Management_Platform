/**
 * The starting code for a new Python strategy. It shows the contract the backtest
 * engine uses for the five core strategies: generate_signal(context) is called once
 * per bar with the bars so far, and returns a StrategySignal.
 *
 * The backend checks saved code for syntax and for a top-level
 * generate_signal(context) with exactly one argument. It never runs it.
 */
export const PYTHON_TEMPLATE = `"""
My S-RABLE strategy.

Contract (the same one the five core strategies follow):

    generate_signal(context) -> StrategySignal

The backtest engine calls it once per bar. context has:
    context.timestamp            time of the current bar
    context.instrument           the instrument being tested
    context.market_data["data"]  pandas DataFrame of the bars up to now,
                                 with open, high, low, close and volume columns

Return StrategySignal(action=SignalAction.BUY | SELL | HOLD,
                      timestamp=context.timestamp)

This code is saved, versioned and checked for syntax only. It is never run:
running custom Python needs an isolated runner, which is not available yet.
"""

from app.strategies.signal import SignalAction, StrategySignal

LOOKBACK = 20


def generate_signal(context):
    data = context.market_data["data"]
    if len(data) < LOOKBACK:
        return StrategySignal(action=SignalAction.HOLD, timestamp=context.timestamp)

    close = data["close"].iloc[-1]
    average = data["close"].tail(LOOKBACK).mean()

    if close > average:
        action = SignalAction.BUY
    elif close < average:
        action = SignalAction.SELL
    else:
        action = SignalAction.HOLD
    return StrategySignal(action=action, timestamp=context.timestamp)
`;

/** Empty StrategyConfig: a Python strategy keeps its logic in its code. */
export const EMPTY_CONFIG = {
  parameters: {},
  indicators: [],
  entry_conditions: [],
  exit_conditions: [],
};
