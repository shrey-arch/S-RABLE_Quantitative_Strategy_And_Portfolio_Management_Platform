from __future__ import annotations

import math
from collections.abc import Mapping
from types import MappingProxyType


STRATEGY_FACTORS: dict[str, tuple[str, ...]] = {
    "momentum": (
        "trend_strength",
        "relative_momentum",
        "volatility_suitability",
    ),
    "mean_reversion": (
        "price_deviation",
        "trend_suitability",
        "volatility_suitability",
    ),
    "statistical_arbitrage": (
        "spread_deviation",
        "spread_stability",
        "volatility_suitability",
    ),
    "tactical_asset_allocation": (
        "relative_momentum",
        "volatility_suitability",
    ),
    "volatility_arbitrage": (
        "volatility_relationship",
        "volatility_stability",
    ),
}

DEFAULT_STRATEGY_WEIGHTS: dict[str, dict[str, float]] = {
    strategy: {factor: 1.0 for factor in factors}
    for strategy, factors in STRATEGY_FACTORS.items()
}


def normalize_factor(
    value: float,
    *,
    raw_min: float,
    raw_max: float,
    target_min: float = 0.0,
    target_max: float = 1.0,
) -> float:
    """Normalize a finite value using explicit bounds and clipping."""
    bounds = (raw_min, raw_max, target_min, target_max)
    if any(
        isinstance(bound, bool)
        or not isinstance(bound, (int, float))
        or not math.isfinite(bound)
        for bound in bounds
    ):
        raise ValueError("Normalization bounds must be finite numbers.")

    if raw_min >= raw_max:
        raise ValueError("raw_min must be less than raw_max.")
    if target_min >= target_max:
        raise ValueError("target_min must be less than target_max.")

    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError("value must be a finite number.")

    clipped = min(max(float(value), raw_min), raw_max)
    fraction = (clipped - raw_min) / (raw_max - raw_min)
    return float(target_min + fraction * (target_max - target_min))


def validate_strategy_weights(
    strategy: str,
    weights: Mapping[str, float],
) -> Mapping[str, float]:
    """Validate and return an immutable copy of strategy factor weights."""
    if strategy not in STRATEGY_FACTORS:
        raise ValueError(f"Unknown strategy: {strategy!r}.")
    if not isinstance(weights, Mapping) or not weights:
        raise ValueError("weights must be a non-empty mapping.")

    allowed = set(STRATEGY_FACTORS[strategy])
    unknown = set(weights) - allowed
    if unknown:
        raise ValueError(f"Unknown factors for {strategy}: {sorted(unknown)}.")

    missing = allowed - set(weights)
    if missing:
        raise ValueError(f"Missing factors for {strategy}: {sorted(missing)}.")

    validated: dict[str, float] = {}
    for factor in STRATEGY_FACTORS[strategy]:
        value = weights[factor]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value < 0
        ):
            raise ValueError(
                f"Weight for {factor!r} must be finite and nonnegative."
            )
        validated[factor] = float(value)

    if sum(validated.values()) <= 0:
        raise ValueError("At least one strategy weight must be greater than zero.")

    return MappingProxyType(validated)

FACTOR_DIRECTIONS: dict[str, dict[str, str]] = {
    "momentum": {
        "trend_strength": "higher_is_better",
        "relative_momentum": "higher_is_better",
        "volatility_suitability": "suitability",
    },
    "mean_reversion": {
        "price_deviation": "magnitude",
        "trend_suitability": "suitability",
        "volatility_suitability": "suitability",
    },
    "statistical_arbitrage": {
        "spread_deviation": "magnitude",
        "spread_stability": "suitability",
        "volatility_suitability": "suitability",
    },
    "tactical_asset_allocation": {
        "relative_momentum": "higher_is_better",
        "volatility_suitability": "suitability",
    },
    "volatility_arbitrage": {
        "volatility_relationship": "magnitude",
        "volatility_stability": "suitability",
    },
}


def calculate_composite_score(
    strategy: str,
    factors: Mapping[str, float],
    weights: Mapping[str, float] | None = None,
) -> float:
    """Calculate a weighted strategy suitability score in [0, 1].

    Directional factors are in [-1, 1]. Suitability factors are in [0, 1].
    Direction policies are explicit and strategy-specific.
    """
    return sum(row["contribution"] for row in score_breakdown(strategy, factors, weights))


def factor_suitability(strategy: str, name: str, value: float) -> float:
    """A normalised factor value as a suitability in [0, 1], by its direction."""
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError(f"Factor {name!r} must be a finite number.")

    direction = FACTOR_DIRECTIONS[strategy][name]

    if direction in {"higher_is_better", "lower_is_better", "magnitude"}:
        if not -1.0 <= value <= 1.0:
            raise ValueError(f"Factor {name!r} must be in [-1.0, 1.0].")

        if direction == "higher_is_better":
            return (float(value) + 1.0) / 2.0
        if direction == "lower_is_better":
            return (1.0 - float(value)) / 2.0
        return abs(float(value))
    if direction == "suitability":
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"Factor {name!r} must be in [0.0, 1.0].")
        return float(value)
    raise ValueError(f"Unsupported factor direction: {direction!r}.")


def score_breakdown(
    strategy: str,
    factors: Mapping[str, float],
    weights: Mapping[str, float] | None = None,
) -> list[dict]:
    """Each factor's part of the composite score, in the strategy's factor order.

    contribution = suitability * weight / total weight; the contributions add up
    to the composite score.
    """
    if strategy not in STRATEGY_FACTORS:
        raise ValueError(f"Unknown strategy: {strategy!r}.")
    if not isinstance(factors, Mapping):
        raise ValueError("factors must be a mapping.")

    expected = set(STRATEGY_FACTORS[strategy])
    supplied = set(factors)
    missing = expected - supplied
    unknown = supplied - expected
    if missing:
        raise ValueError(f"Missing factors for {strategy}: {sorted(missing)}.")
    if unknown:
        raise ValueError(f"Unknown factors for {strategy}: {sorted(unknown)}.")

    suitability_values = {
        name: factor_suitability(strategy, name, factors[name])
        for name in STRATEGY_FACTORS[strategy]
    }

    selected_weights = (
        DEFAULT_STRATEGY_WEIGHTS[strategy] if weights is None else weights
    )
    validated_weights = validate_strategy_weights(strategy, selected_weights)
    total_weight = sum(validated_weights.values())

    return [
        {
            "factor": name,
            "direction": FACTOR_DIRECTIONS[strategy][name],
            "normalized": float(factors[name]),
            "suitability": suitability_values[name],
            "weight": validated_weights[name],
            "weight_share": validated_weights[name] / total_weight,
            "contribution": suitability_values[name] * validated_weights[name] / total_weight,
        }
        for name in STRATEGY_FACTORS[strategy]
    ]
