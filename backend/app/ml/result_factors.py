"""Feature 6: scoring a strategy from its own backtest, not from a factor model.

The five core templates each have a documented factor model (app.ml.factors),
which reads the instrument's prices. Hand-written Python code has no such model:
there is nothing to measure about "the strategy" other than how it actually did.
So a Python strategy is scored on its latest completed backtest's own stored
metrics, each normalised to 0-1 and weighted:

  * Risk-adjusted return  (Sharpe ratio, -1 to 3)
  * Return               (total return, -50% to +100%)
  * Drawdown control     (1 - max drawdown, 0 to 1)
  * Activity             (trade count, 0 to 60 round trips: too few is not evidence)

The result is on the same 0-1 scale as a template's composite score, so the two
can be ranked together, and every part says where its number came from. Because
these come from one backtest, they describe that run, not a forecast; only
validated strategies receive capital (Feature 5).
"""

from __future__ import annotations

import math

RESULT_FACTORS: tuple[str, ...] = (
    "risk_adjusted_return",
    "return_achieved",
    "drawdown_control",
    "activity",
)

LABELS: dict[str, str] = {
    "risk_adjusted_return": "Risk-adjusted return",
    "return_achieved": "Return",
    "drawdown_control": "Drawdown control",
    "activity": "Activity",
}

DEFINITIONS: dict[str, str] = {
    "risk_adjusted_return": "The backtest's Sharpe ratio, mapped from -1 to 3.",
    "return_achieved": "The backtest's total return, mapped from -50% to +100%.",
    "drawdown_control": "1 minus the backtest's maximum drawdown.",
    "activity": "Completed trades, mapped from 0 to 60: a handful of trades is thin evidence.",
}

BOUNDS: dict[str, tuple[float, float]] = {
    "risk_adjusted_return": (-1.0, 3.0),
    "return_achieved": (-0.5, 1.0),
    "drawdown_control": (0.0, 1.0),
    "activity": (0.0, 60.0),
}

DEFAULT_WEIGHTS: dict[str, float] = {
    "risk_adjusted_return": 2.0,
    "return_achieved": 1.0,
    "drawdown_control": 1.5,
    "activity": 0.5,
}

NO_METRICS = (
    "Its latest backtest stored no metrics to score. Run the backtest again."
)


def _clip(value: float, low: float, high: float) -> float:
    return min(max(float(value), low), high)


def _finite(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def result_factors(metrics: dict) -> tuple[dict[str, float], dict[str, float]]:
    """(suitability per factor in 0-1, the raw value each came from).

    Raises ValueError when the run stored nothing that can be scored.
    """
    raw: dict[str, float] = {}
    scores: dict[str, float] = {}

    sharpe = _finite(metrics.get("sharpe_ratio"))
    total_return = _finite(metrics.get("total_return"))
    drawdown = _finite(metrics.get("max_drawdown"))
    trades = _finite(metrics.get("trade_count"))

    if total_return is None and sharpe is None:
        raise ValueError(NO_METRICS)

    for name, value, default in (
        ("risk_adjusted_return", sharpe, 0.0),
        ("return_achieved", total_return, 0.0),
        ("drawdown_control", None if drawdown is None else 1.0 - abs(drawdown), 0.0),
        ("activity", trades, 0.0),
    ):
        low, high = BOUNDS[name]
        used = default if value is None else value
        raw[name] = used
        scores[name] = (_clip(used, low, high) - low) / (high - low)
    return scores, raw


def result_score(metrics: dict, weights: dict[str, float] | None = None) -> tuple[float, list[dict]]:
    """The 0-1 composite score and each factor's part of it."""
    scores, raw = result_factors(metrics)
    weights = {**DEFAULT_WEIGHTS, **(weights or {})}
    total = sum(weights[name] for name in RESULT_FACTORS)
    if total <= 0:
        raise ValueError("At least one weight must be greater than zero.")
    parts = []
    composite = 0.0
    for name in RESULT_FACTORS:
        share = weights[name] / total
        contribution = scores[name] * share
        composite += contribution
        parts.append(
            {
                "factor": name,
                "label": LABELS[name],
                # These read like a template factor so one table shows both kinds.
                "direction": "higher_is_better",
                "raw": raw[name],
                "normalized": scores[name],
                "suitability": scores[name],
                "weight": weights[name],
                "weight_share": share,
                "contribution": contribution,
                "definition": DEFINITIONS[name],
            }
        )
    return composite, parts
