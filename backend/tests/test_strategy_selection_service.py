import pytest

from app.services.strategies.strategy_selection_service import (
    StrategyCandidate,
    StrategySelectionService,
)


def candidate(strategy, factors, **kwargs):
    return StrategyCandidate(strategy=strategy, factors=factors, **kwargs)


def test_select_ranks_candidates_by_composite_score():
    candidates = [
        candidate(
            "momentum",
            {
                "trend_strength": -0.8,
                "relative_momentum": -0.7,
                "volatility_suitability": 0.2,
            },
        ),
        candidate(
            "momentum",
            {
                "trend_strength": 0.8,
                "relative_momentum": 0.7,
                "volatility_suitability": 0.8,
            },
        ),
    ]

    result = StrategySelectionService.select(candidates)

    assert len(result) == 2
    assert result[0].score > result[1].score
    assert result[0].reason.startswith("Composite factor score")


def test_select_filters_by_explicit_regime_compatibility():
    candidates = [
        candidate(
            "momentum",
            {
                "trend_strength": 0.8,
                "relative_momentum": 0.7,
                "volatility_suitability": 0.8,
            },
            compatible_regimes=("trending",),
        ),
        candidate(
            "mean_reversion",
            {
                "price_deviation": 0.8,
                "trend_suitability": 0.7,
                "volatility_suitability": 0.8,
            },
            compatible_regimes=("ranging",),
        ),
    ]

    result = StrategySelectionService.select(candidates, regime="trending")

    assert [item.strategy for item in result] == ["momentum"]


def test_select_keeps_all_candidates_when_regime_not_supplied():
    candidates = [
        candidate(
            "momentum",
            {
                "trend_strength": 0.2,
                "relative_momentum": 0.1,
                "volatility_suitability": 0.5,
            },
            compatible_regimes=("trending",),
        ),
        candidate(
            "mean_reversion",
            {
                "price_deviation": 0.2,
                "trend_suitability": 0.5,
                "volatility_suitability": 0.5,
            },
            compatible_regimes=("ranging",),
        ),
    ]

    result = StrategySelectionService.select(candidates)

    assert len(result) == 2


def test_select_applies_top_k():
    factors = {
        "trend_strength": 0.5,
        "relative_momentum": 0.5,
        "volatility_suitability": 0.5,
    }

    result = StrategySelectionService.select(
        [candidate("momentum", factors), candidate("momentum", factors)],
        top_k=1,
    )

    assert len(result) == 1


def test_select_is_deterministic_for_ties():
    factors = {
        "trend_strength": 0.5,
        "relative_momentum": 0.5,
        "volatility_suitability": 0.5,
    }

    result = StrategySelectionService.select(
        [
            candidate("momentum", factors, asset="BBB"),
            candidate("momentum", factors, asset="AAA"),
        ]
    )

    assert [item.asset for item in result] == ["AAA", "BBB"]


def test_select_rejects_unknown_strategy():
    with pytest.raises(ValueError, match="Unknown strategy"):
        StrategySelectionService.select(
            [candidate("unknown", {"factor": 0.5})]
        )


def test_select_rejects_invalid_candidate_type():
    with pytest.raises(ValueError, match="StrategyCandidate"):
        StrategySelectionService.select([{"strategy": "momentum"}])


@pytest.mark.parametrize("top_k", [0, -1, True, 1.5])
def test_select_rejects_invalid_top_k(top_k):
    with pytest.raises(ValueError, match="top_k"):
        StrategySelectionService.select([], top_k=top_k)


def test_select_rejects_invalid_regime():
    with pytest.raises(ValueError, match="regime"):
        StrategySelectionService.select([], regime=" ")


def test_select_returns_empty_for_empty_candidates():
    assert StrategySelectionService.select([]) == []
