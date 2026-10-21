from enum import Enum


class ExecutionType(str, Enum):
    BACKTEST = "BACKTEST"
    PAPER = "PAPER"
    LIVE = "LIVE"
    REGIME_TEST = "REGIME_TEST"
    # Phase 11: a run of the validation pipeline (stored like a backtest run).
    VALIDATION = "VALIDATION"
    # Feature 4: a portfolio of strategies backtested against Nifty 50.
    PORTFOLIO_BACKTEST = "PORTFOLIO_BACKTEST"
