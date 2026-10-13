import math

import pytest

from app.ml.scoring import (
    DEFAULT_STRATEGY_WEIGHTS,
    STRATEGY_FACTORS,
    normalize_factor,
    validate_strategy_weights,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (-2.0, -1.0),
        (-1.0, -1.0),
        (0.0, 0.0),
        (1.0, 1.0),
        (2.0, 1.0),
    ],
)
def test_normalizes_and_clips_to_directional_range(value, expected):
    assert normalize_factor(
        value,
        raw_min=-1.0,
        raw_max=1.0,
        target_min=-1.0,
        target_max=1.0,
    ) == pytest.approx(expected)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(0.0, 0.0), (5.0, 0.5), (10.0, 1.0), (-1.0, 0.0), (11.0, 1.0)],
)
def test_normalizes_and_clips_to_suitability_range(value, expected):
    assert normalize_factor(value, raw_min=0.0, raw_max=10.0) == pytest.approx(expected)


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_rejects_non_finite_values(value):
    with pytest.raises(ValueError, match="finite"):
        normalize_factor(value, raw_min=0.0, raw_max=1.0)


@pytest.mark.parametrize(
    ("raw_min", "raw_max", "target_min", "target_max"),
    [
        (1.0, 1.0, 0.0, 1.0),
        (2.0, 1.0, 0.0, 1.0),
        (0.0, 1.0, 1.0, 1.0),
        (0.0, 1.0, 2.0, 1.0),
    ],
)
def test_rejects_invalid_bounds(raw_min, raw_max, target_min, target_max):
    with pytest.raises(ValueError):
        normalize_factor(
            0.5,
            raw_min=raw_min,
            raw_max=raw_max,
            target_min=target_min,
            target_max=target_max,
        )


def test_normalization_is_deterministic():
    kwargs = {
        "raw_min": -5.0,
        "raw_max": 5.0,
        "target_min": -1.0,
        "target_max": 1.0,
    }
    assert normalize_factor(2.5, **kwargs) == normalize_factor(2.5, **kwargs)


def test_rejects_boolean_values():
    with pytest.raises(ValueError, match="finite number"):
        normalize_factor(True, raw_min=0.0, raw_max=1.0)


@pytest.mark.parametrize("strategy", STRATEGY_FACTORS)
def test_default_weights_cover_every_strategy_factor(strategy):
    weights = validate_strategy_weights(
        strategy, DEFAULT_STRATEGY_WEIGHTS[strategy]
    )
    assert set(weights) == set(STRATEGY_FACTORS[strategy])
    assert sum(weights.values()) > 0


def test_custom_weights_are_supported():
    weights = validate_strategy_weights(
        "momentum",
        {
            "trend_strength": 2.0,
            "relative_momentum": 1.0,
            "volatility_suitability": 0.5,
        },
    )
    assert weights["trend_strength"] == 2.0
    assert weights["relative_momentum"] == 1.0
    assert weights["volatility_suitability"] == 0.5


@pytest.mark.parametrize("weight", [-1.0, math.nan, math.inf, -math.inf, True])
def test_rejects_invalid_weights(weight):
    weights = dict(DEFAULT_STRATEGY_WEIGHTS["momentum"])
    weights["trend_strength"] = weight
    with pytest.raises(ValueError, match="Weight"):
        validate_strategy_weights("momentum", weights)


def test_rejects_all_zero_weights():
    weights = dict.fromkeys(STRATEGY_FACTORS["momentum"], 0.0)
    with pytest.raises(ValueError, match="greater than zero"):
        validate_strategy_weights("momentum", weights)


def test_rejects_unknown_strategy():
    with pytest.raises(ValueError, match="Unknown strategy"):
        validate_strategy_weights("unknown", {"factor": 1.0})


def test_rejects_unknown_factor():
    weights = dict(DEFAULT_STRATEGY_WEIGHTS["momentum"])
    weights["unexpected_factor"] = 1.0
    with pytest.raises(ValueError, match="Unknown factors"):
        validate_strategy_weights("momentum", weights)


def test_rejects_missing_factor():
    weights = dict(DEFAULT_STRATEGY_WEIGHTS["momentum"])
    weights.pop("trend_strength")
    with pytest.raises(ValueError, match="Missing factors"):
        validate_strategy_weights("momentum", weights)


def test_validated_weights_are_immutable():
    weights = validate_strategy_weights(
        "momentum", DEFAULT_STRATEGY_WEIGHTS["momentum"]
    )
    with pytest.raises(TypeError):
        weights["trend_strength"] = 9.0

from app.ml.scoring import calculate_composite_score


def test_composite_score_maps_directional_factors_to_suitability():
    factors = {
        "trend_strength": 1.0,
        "relative_momentum": -1.0,
        "volatility_suitability": 1.0,
    }
    assert calculate_composite_score("momentum", factors) == pytest.approx(2.0 / 3.0)


def test_composite_score_respects_custom_weights():
    factors = {
        "trend_strength": 1.0,
        "relative_momentum": -1.0,
        "volatility_suitability": 0.0,
    }
    weights = {
        "trend_strength": 3.0,
        "relative_momentum": 1.0,
        "volatility_suitability": 0.0,
    }
    assert calculate_composite_score(
        "momentum", factors, weights
    ) == pytest.approx(0.75)


def test_composite_score_rejects_missing_factor():
    factors = {
        "trend_strength": 0.0,
        "relative_momentum": 0.0,
    }
    with pytest.raises(ValueError, match="Missing factors"):
        calculate_composite_score("momentum", factors)


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_composite_score_rejects_non_finite_factor(value):
    factors = {
        "trend_strength": value,
        "relative_momentum": 0.0,
        "volatility_suitability": 0.5,
    }
    with pytest.raises(ValueError, match="finite"):
        calculate_composite_score("momentum", factors)


def test_composite_score_rejects_out_of_range_factors():
    factors = {
        "trend_strength": 2.0,
        "relative_momentum": 0.0,
        "volatility_suitability": 0.5,
    }
    with pytest.raises(ValueError, match="must be in"):
        calculate_composite_score("momentum", factors)


def test_composite_score_is_reproducible():
    factors = {
        "trend_strength": 0.5,
        "relative_momentum": -0.25,
        "volatility_suitability": 0.75,
    }
    first = calculate_composite_score("momentum", factors)
    second = calculate_composite_score("momentum", factors)
    assert first == second


def test_composite_score_stays_within_zero_and_one():
    factors = {
        "trend_strength": 1.0,
        "relative_momentum": 1.0,
        "volatility_suitability": 1.0,
    }
    score = calculate_composite_score("momentum", factors)
    assert 0.0 <= score <= 1.0


def test_mean_reversion_deviation_uses_magnitude():
    positive = {
        "price_deviation": 0.8,
        "trend_suitability": 0.5,
        "volatility_suitability": 0.5,
    }
    negative = {
        **positive,
        "price_deviation": -0.8,
    }
    assert calculate_composite_score("mean_reversion", positive) == pytest.approx(
        calculate_composite_score("mean_reversion", negative)
    )


def test_statistical_arbitrage_deviation_uses_magnitude():
    positive = {
        "spread_deviation": 0.9,
        "spread_stability": 0.5,
        "volatility_suitability": 0.5,
    }
    negative = {
        **positive,
        "spread_deviation": -0.9,
    }
    assert calculate_composite_score(
        "statistical_arbitrage", positive
    ) == pytest.approx(
        calculate_composite_score("statistical_arbitrage", negative)
    )


def test_momentum_prefers_higher_directional_values():
    positive = {
        "trend_strength": 0.8,
        "relative_momentum": 0.7,
        "volatility_suitability": 0.5,
    }
    negative = {
        "trend_strength": -0.8,
        "relative_momentum": -0.7,
        "volatility_suitability": 0.5,
    }
    assert calculate_composite_score("momentum", positive) > (
        calculate_composite_score("momentum", negative)
    )

@pytest.mark.parametrize(
    "strategy,factors",
    [
        (
            "tactical_asset_allocation",
            {"relative_momentum": 1.0, "volatility_suitability": 1.0},
        ),
        (
            "volatility_arbitrage",
            {"volatility_relationship": 1.0, "volatility_stability": 1.0},
        ),
    ],
)
def test_other_strategy_composite_scores_are_bounded(strategy, factors):
    score = calculate_composite_score(strategy, factors)
    assert 0.0 <= score <= 1.0


def test_tactical_allocation_prefers_higher_momentum():
    strong = {
        "relative_momentum": 1.0,
        "volatility_suitability": 0.5,
    }
    weak = {
        "relative_momentum": -1.0,
        "volatility_suitability": 0.5,
    }
    assert calculate_composite_score(
        "tactical_asset_allocation", strong
    ) > calculate_composite_score("tactical_asset_allocation", weak)


def test_volatility_arbitrage_relationship_uses_magnitude():
    positive = {
        "volatility_relationship": 0.8,
        "volatility_stability": 0.5,
    }
    negative = {
        **positive,
        "volatility_relationship": -0.8,
    }
    assert calculate_composite_score(
        "volatility_arbitrage", positive
    ) == pytest.approx(
        calculate_composite_score("volatility_arbitrage", negative)
    )
