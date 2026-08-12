from enum import Enum


class ExecutionType(str, Enum):
    BACKTEST = "BACKTEST"
    PAPER = "PAPER"
    LIVE = "LIVE"
    REGIME_TEST = "REGIME_TEST"