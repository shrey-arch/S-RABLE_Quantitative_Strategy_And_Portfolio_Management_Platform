from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP


@dataclass(frozen=True)
class StrategyAllocation:
    strategy: str
    score: float
    weight: Decimal
    amount: Decimal


class PortfolioAllocationService:
    """Allocate portfolio capital proportionally to strategy suitability scores."""

    CENT = Decimal("0.01")

    @classmethod
    def allocate(
        cls,
        capital: Decimal | int | float | str,
        scores: Mapping[str, float],
    ) -> list[StrategyAllocation]:
        if isinstance(capital, bool):
            raise ValueError("capital must be a positive finite amount.")

        try:
            total_capital = Decimal(str(capital))
        except Exception as exc:
            raise ValueError("capital must be a positive finite amount.") from exc

        if not total_capital.is_finite() or total_capital <= 0:
            raise ValueError("capital must be a positive finite amount.")

        if not isinstance(scores, Mapping) or not scores:
            raise ValueError("scores must be a non-empty mapping.")

        validated: dict[str, float] = {}
        for strategy, score in scores.items():
            if not isinstance(strategy, str) or not strategy.strip():
                raise ValueError("strategy names must be non-empty strings.")
            if (
                isinstance(score, bool)
                or not isinstance(score, (int, float))
                or not math.isfinite(score)
                or score < 0
            ):
                raise ValueError(
                    f"Score for {strategy!r} must be finite and nonnegative."
                )
            validated[strategy] = float(score)

        score_total = sum(validated.values())
        if not math.isfinite(score_total) or score_total <= 0:
            raise ValueError("At least one strategy score must be greater than zero.")

        ordered = sorted(validated.items())
        allocations: list[StrategyAllocation] = []
        remaining = total_capital.quantize(cls.CENT, rounding=ROUND_HALF_UP)

        for index, (strategy, score) in enumerate(ordered):
            weight = Decimal(str(score)) / Decimal(str(score_total))
            if index == len(ordered) - 1:
                amount = remaining
            else:
                amount = (total_capital * weight).quantize(
                    cls.CENT, rounding=ROUND_DOWN
                )
                remaining -= amount

            allocations.append(
                StrategyAllocation(
                    strategy=strategy,
                    score=score,
                    weight=weight,
                    amount=amount,
                )
            )

        return allocations
