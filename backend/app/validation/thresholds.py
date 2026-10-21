"""Pass/fail thresholds of the validation pipeline.

They are the reference values of the project synopsis (BE Synopsis Sem VI,
"Rigorous Validation Framework"). Every check returns the threshold it used, so
the page shows the rule and the value side by side and never decides itself.
"""

from __future__ import annotations

import operator
from typing import Any

SOURCE = "BE Synopsis Sem VI, validation framework"

BACKTEST_MIN_SHARPE = 0.5
BACKTEST_MAX_DRAWDOWN = 0.30
BACKTEST_MIN_POSITIVE_YEAR_SHARE = 0.70
WALK_FORWARD_MIN_WINDOWS = 5
WALK_FORWARD_MIN_RETENTION = 0.80
REGIME_MAX_DRAWDOWN = 0.40
# Feature 3: with the market regime model as the source, a regime with fewer
# days than this is "insufficient data" and not judged.
REGIME_MIN_DAYS = 20
SIGNIFICANCE_LEVEL = 0.05
# Stage 5 (preliminary report): live paper trading retains 70%+ of the backtest.
PAPER_MIN_RETENTION = 0.70

_OPERATORS = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
}


def check(
    *,
    id: str,
    label: str,
    op: str,
    threshold: float,
    value: float | None,
    unit: str,
    explanation: str,
    reason: str | None = None,
) -> dict[str, Any]:
    """One pass/fail rule, with the value it was applied to.

    A missing value fails the check; `reason` says why it is missing.
    """
    passed = value is not None and _OPERATORS[op](value, threshold)
    return {
        "id": id,
        "label": label,
        "operator": op,
        "threshold": threshold,
        "value": value,
        "passed": bool(passed),
        "unit": unit,
        "explanation": explanation,
        "reason": reason if value is None else None,
    }


def definitions() -> list[dict[str, Any]]:
    """Every threshold the pipeline applies, by stage (shown with each run)."""
    return [
        {
            "stage": "backtest",
            "id": "sharpe_ratio",
            "label": "Sharpe ratio",
            "operator": ">",
            "threshold": BACKTEST_MIN_SHARPE,
            "unit": "ratio",
        },
        {
            "stage": "backtest",
            "id": "max_drawdown",
            "label": "Maximum drawdown",
            "operator": "<",
            "threshold": BACKTEST_MAX_DRAWDOWN,
            "unit": "fraction",
        },
        {
            "stage": "backtest",
            "id": "positive_year_share",
            "label": "Share of calendar years with a positive return",
            "operator": ">=",
            "threshold": BACKTEST_MIN_POSITIVE_YEAR_SHARE,
            "unit": "fraction",
        },
        {
            "stage": "walk_forward",
            "id": "window_count",
            "label": "Walk-forward windows",
            "operator": ">=",
            "threshold": WALK_FORWARD_MIN_WINDOWS,
            "unit": "count",
        },
        {
            "stage": "walk_forward",
            "id": "retention",
            "label": "Out-of-sample retention of in-sample return",
            "operator": ">=",
            "threshold": WALK_FORWARD_MIN_RETENTION,
            "unit": "fraction",
        },
        {
            "stage": "regime_stress",
            "id": "max_regime_drawdown",
            "label": "Worst maximum drawdown in any regime",
            "operator": "<=",
            "threshold": REGIME_MAX_DRAWDOWN,
            "unit": "fraction",
        },
        {
            "stage": "monte_carlo",
            "id": "p_value",
            "label": "p-value of the mean-return test",
            "operator": "<",
            "threshold": SIGNIFICANCE_LEVEL,
            "unit": "p_value",
        },
        {
            "stage": "paper_trading",
            "id": "paper_retention",
            "label": "Paper return retained from the backtest",
            "operator": ">=",
            "threshold": PAPER_MIN_RETENTION,
            "unit": "fraction",
        },
        {
            "stage": "paper_trading",
            "id": "paper_breaches",
            "label": "Loss-limit breaches",
            "operator": "<=",
            "threshold": 0,
            "unit": "count",
        },
    ]
