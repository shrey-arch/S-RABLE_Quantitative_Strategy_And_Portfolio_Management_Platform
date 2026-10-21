"""What each scoring factor measures, and which market regimes suit each core
strategy (Phase 13). Shown on the Scoring page as returned by the API.

The factor formulas are in app.ml.factors and the composite score in
app.ml.scoring. The regime table is an engineering rule from how each strategy
trades, not an empirically validated result; it never changes a score.
"""

from __future__ import annotations

from app.ml.factors import DEFAULT_DIRECTIONAL_BOUNDS, DEFAULT_FACTOR_WINDOWS

FACTORS: dict[str, dict[str, str]] = {
    "trend_strength": {
        "label": "Trend strength",
        "raw": "Mean daily return over the last 20 days divided by its standard deviation.",
        "normalization": "Clipped to -3..3 and scaled to -1..1.",
    },
    "relative_momentum": {
        "label": "Relative momentum",
        "raw": (
            "Momentum: last close against its 20-day average, minus 1. Tactical asset "
            "allocation: return over the last 20 days."
        ),
        "normalization": "Clipped to -20%..20% and scaled to -1..1.",
    },
    "volatility_suitability": {
        "label": "Volatility suitability",
        "raw": "Standard deviation of daily returns over the last 20 days (for a pair, the mean of both).",
        "normalization": "0 volatility gives 1, 5% a day or more gives 0, linear in between.",
    },
    "price_deviation": {
        "label": "Price deviation",
        "raw": "Z-score of the close against its 20-day average and standard deviation.",
        "normalization": "Clipped to -3..3 and scaled to -1..1.",
    },
    "trend_suitability": {
        "label": "Trend suitability",
        "raw": "Trend strength (as above); mean reversion prefers a weak trend.",
        "normalization": "1 - |trend strength| / 3, clipped to 0..1.",
    },
    "spread_deviation": {
        "label": "Spread deviation",
        "raw": "Z-score of the price spread (A - B) against its 20-day average and standard deviation.",
        "normalization": "Clipped to -3..3 and scaled to -1..1.",
    },
    "spread_stability": {
        "label": "Spread stability",
        "raw": "Coefficient of variation of the daily absolute spread changes over the last 20 days.",
        "normalization": "1 - the coefficient of variation, clipped to 0..1.",
    },
    "volatility_relationship": {
        "label": "Volatility relationship",
        "raw": "5-day volatility of daily returns divided by the 20-day volatility, minus 1.",
        "normalization": "Clipped to -1..1.",
    },
    "volatility_stability": {
        "label": "Volatility stability",
        "raw": "Coefficient of variation of the 20-day rolling volatility over the last 20 days.",
        "normalization": "1 - the coefficient of variation, clipped to 0..1.",
    },
}

DIRECTIONS: dict[str, str] = {
    "higher_is_better": "Higher is better: suitability = (normalised + 1) / 2.",
    "lower_is_better": "Lower is better: suitability = (1 - normalised) / 2.",
    "magnitude": "Size matters, not sign: suitability = |normalised|.",
    "suitability": "Already a suitability in 0..1.",
}

METHOD = [
    "Factors are computed from the stored daily closes of the instruments of the strategy's "
    "latest completed backtest, up to their last stored bar, with the windows shown.",
    "Each factor is normalised (see each definition), turned into a suitability in 0..1 by its "
    "direction, and weighted. Composite score = sum(suitability x weight) / sum(weights), in 0..1.",
    "Factor and suitability formulas and their bounds are engineering heuristics, not "
    "empirically validated trading thresholds.",
    "Strategies of different templates use different factors, so compare their scores with care.",
]

# Which regime states suit each core strategy. "any" = every regime.
REGIME_RULES: dict[str, dict] = {
    "momentum": {
        "trend_states": ["Uptrend", "Downtrend"],
        "volatility_states": None,
        "rule": "Suits a trend in either direction: it goes long or short with the trend.",
    },
    "mean_reversion": {
        "trend_states": ["Sideways"],
        "volatility_states": None,
        "rule": "Suits a sideways market: it bets on prices returning to their average.",
    },
    "volatility_arbitrage": {
        "trend_states": None,
        "volatility_states": ["High volatility"],
        "rule": "Suits high volatility: it trades the gap between short- and long-term volatility.",
    },
    "tactical_asset_allocation": {
        "trend_states": ["Uptrend"],
        "volatility_states": None,
        "rule": "Suits an uptrend: it only buys the strongest assets.",
    },
    "statistical_arbitrage": {
        "trend_states": None,
        "volatility_states": None,
        "rule": "Suits any regime: it trades the spread between two instruments, not the market's direction.",
    },
}

WINDOWS = dict(DEFAULT_FACTOR_WINDOWS)
BOUNDS = {name: list(pair) for name, pair in DEFAULT_DIRECTIONAL_BOUNDS.items()}


def regime_compatibility(strategy_key: str, regime: dict | None) -> dict:
    """COMPATIBLE / NOT_COMPATIBLE with the current regime, or UNKNOWN without one."""
    rule = REGIME_RULES[strategy_key]
    if regime is None:
        return {
            "status": "UNKNOWN",
            "reason": "No regime model has been trained, so compatibility is not known.",
        }
    checks = []
    if rule["trend_states"] is not None:
        checks.append(regime["trend_state"] in rule["trend_states"])
    if rule["volatility_states"] is not None:
        checks.append(regime["volatility_state"] in rule["volatility_states"])
    compatible = all(checks)
    return {
        "status": "COMPATIBLE" if compatible else "NOT_COMPATIBLE",
        "reason": f"{rule['rule']} Current regime: {regime['name']}.",
    }
