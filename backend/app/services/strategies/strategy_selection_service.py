from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.ml.scoring import calculate_composite_score
from app.strategies.registry import StrategyRegistry


@dataclass(frozen=True)
class StrategyCandidate:
    strategy: str
    factors: Mapping[str, float]
    asset: str | None = None
    weights: Mapping[str, float] | None = None
    compatible_regimes: tuple[str, ...] | None = None


@dataclass(frozen=True)
class StrategySelection:
    strategy: str
    asset: str | None
    score: float
    regime: str | None
    reason: str


class StrategySelectionService:
    """Rank strategy candidates using Phase 11 composite factor scores."""

    @staticmethod
    def select(
        candidates: Sequence[StrategyCandidate],
        *,
        regime: str | None = None,
        top_k: int | None = None,
    ) -> list[StrategySelection]:
        if isinstance(candidates, (str, bytes)) or not isinstance(
            candidates, Sequence
        ):
            raise ValueError("candidates must be a sequence of StrategyCandidate values.")

        if top_k is not None and (
            isinstance(top_k, bool)
            or not isinstance(top_k, int)
            or top_k < 1
        ):
            raise ValueError("top_k must be a positive integer.")

        if regime is not None and (
            not isinstance(regime, str) or not regime.strip()
        ):
            raise ValueError("regime must be a non-empty string or None.")

        results: list[StrategySelection] = []

        for candidate in candidates:
            if not isinstance(candidate, StrategyCandidate):
                raise ValueError("Every candidate must be a StrategyCandidate.")

            # Validate the strategy against the canonical runtime registry.
            StrategyRegistry.definition(candidate.strategy)

            if candidate.compatible_regimes is not None:
                if not isinstance(candidate.compatible_regimes, tuple) or not all(
                    isinstance(item, str) and item.strip()
                    for item in candidate.compatible_regimes
                ):
                    raise ValueError(
                        "compatible_regimes must be a tuple of non-empty strings or None."
                    )

                if regime is not None and regime not in candidate.compatible_regimes:
                    continue

            if candidate.asset is not None and (
                not isinstance(candidate.asset, str) or not candidate.asset.strip()
            ):
                raise ValueError("asset must be a non-empty string or None.")

            score = calculate_composite_score(
                candidate.strategy,
                candidate.factors,
                candidate.weights,
            )

            results.append(
                StrategySelection(
                    strategy=candidate.strategy,
                    asset=candidate.asset,
                    score=score,
                    regime=regime,
                    reason=(
                        f"Composite factor score {score:.6f}"
                        + (
                            f"; compatible with regime '{regime}'"
                            if regime is not None
                            and candidate.compatible_regimes is not None
                            else ""
                        )
                    ),
                )
            )

        results.sort(key=lambda result: (-result.score, result.strategy, result.asset or ""))

        return results if top_k is None else results[:top_k]
