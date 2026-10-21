from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN


@dataclass(frozen=True)
class PortfolioRiskLimits:
    cash_reserve: Decimal = Decimal("0.00")
    max_strategy_weight: Decimal = Decimal("1.00")
    max_asset_weight: Decimal = Decimal("1.00")
    max_invested_capital: Decimal | None = None


@dataclass(frozen=True)
class RiskConstrainedAllocation:
    strategy: str
    amount: Decimal


@dataclass(frozen=True)
class RiskConstraintResult:
    allocations: tuple[RiskConstrainedAllocation, ...]
    cash_reserve: Decimal
    available_capital: Decimal
    invested_capital: Decimal
    # The limits that reduced the allocation: dicts with "limit", "value",
    # "affected" (strategies or assets) and a plain-English "detail".
    binding_limits: tuple[dict, ...] = ()


@dataclass(frozen=True)
class AssetExposure:
    asset: str
    amount: Decimal


class PortfolioRiskService:
    CENT = Decimal("0.01")

    @staticmethod
    def _decimal(value: object, field: str) -> Decimal:
        if isinstance(value, bool):
            raise ValueError(f"{field} must be a finite nonnegative number.")
        try:
            result = Decimal(str(value))
        except Exception as exc:
            raise ValueError(
                f"{field} must be a finite nonnegative number."
            ) from exc
        if not result.is_finite() or result < 0:
            raise ValueError(f"{field} must be a finite nonnegative number.")
        return result

    @classmethod
    def _scale(
        cls,
        amounts: dict[str, Decimal],
        budget: Decimal,
    ) -> dict[str, Decimal]:
        total = sum(amounts.values(), Decimal("0.00"))
        if total <= budget:
            return dict(amounts)
        if total == 0:
            return {name: Decimal("0.00") for name in amounts}

        scaled = {
            name: (amount * budget / total).quantize(
                cls.CENT, rounding=ROUND_DOWN
            )
            for name, amount in amounts.items()
        }
        remainder = budget - sum(scaled.values(), Decimal("0.00"))

        for name in sorted(scaled):
            if remainder < cls.CENT:
                break
            scaled[name] += cls.CENT
            remainder -= cls.CENT

        return scaled

    @classmethod
    def constrain(
        cls,
        capital: Decimal | int | float | str,
        allocations: Mapping[str, Decimal | int | float | str],
        limits: PortfolioRiskLimits | None = None,
        *,
        asset_exposures: Mapping[str, Decimal | int | float | str] | None = None,
        strategy_assets: Mapping[str, str | None] | None = None,
    ) -> RiskConstraintResult:
        total = cls._decimal(capital, "capital")
        if total <= 0:
            raise ValueError("capital must be greater than zero.")
        total = total.quantize(cls.CENT)

        if not isinstance(allocations, Mapping) or not allocations:
            raise ValueError("allocations must be a non-empty mapping.")

        limits = limits or PortfolioRiskLimits()
        if not isinstance(limits, PortfolioRiskLimits):
            raise ValueError("limits must be PortfolioRiskLimits.")

        reserve = cls._decimal(limits.cash_reserve, "cash_reserve")
        strategy_limit = cls._decimal(
            limits.max_strategy_weight, "max_strategy_weight"
        )
        asset_limit = cls._decimal(limits.max_asset_weight, "max_asset_weight")

        if reserve > total:
            raise ValueError("cash_reserve cannot exceed total capital.")
        if strategy_limit > 1 or asset_limit > 1:
            raise ValueError("Weight limits must be between zero and one.")

        available = (total - reserve).quantize(cls.CENT)
        max_invested = (
            available
            if limits.max_invested_capital is None
            else cls._decimal(
                limits.max_invested_capital, "max_invested_capital"
            )
        )
        max_invested = min(max_invested, available)

        requested: dict[str, Decimal] = {}
        for strategy, amount in allocations.items():
            if not isinstance(strategy, str) or not strategy.strip():
                raise ValueError("Allocation names must be non-empty strings.")
            requested[strategy] = cls._decimal(
                amount, f"allocation[{strategy!r}]"
            )

        binding: list[dict] = []
        if reserve > 0:
            binding.append(
                {
                    "limit": "cash_reserve",
                    "value": str(reserve),
                    "affected": [],
                    "detail": f"{reserve} of the {total} capital is kept as cash.",
                }
            )

        strategy_cap = (total * strategy_limit).quantize(
            cls.CENT, rounding=ROUND_DOWN
        )
        over_cap = sorted(
            name for name, amount in requested.items() if amount > strategy_cap
        )
        if over_cap:
            binding.append(
                {
                    "limit": "max_strategy_weight",
                    "value": str(strategy_limit),
                    "affected": over_cap,
                    "detail": (
                        f"Strategies above {strategy_limit:.2%} of capital were "
                        f"cut to {strategy_cap}; the rest stays as cash."
                    ),
                }
            )
        capped = {
            name: min(amount, strategy_cap)
            for name, amount in requested.items()
        }
        before_scaling = sum(capped.values(), Decimal("0.00"))
        if (
            limits.max_invested_capital is not None
            and max_invested < available
            and before_scaling > max_invested
        ):
            binding.append(
                {
                    "limit": "max_invested_capital",
                    "value": str(max_invested),
                    "affected": [],
                    "detail": (
                        f"Investments were scaled down to at most {max_invested}."
                    ),
                }
            )
        capped = cls._scale(capped, max_invested)

        asset_cap = (total * asset_limit).quantize(
            cls.CENT, rounding=ROUND_DOWN
        )

        if strategy_assets is not None:
            if not isinstance(strategy_assets, Mapping):
                raise ValueError("strategy_assets must be a mapping.")

            if set(strategy_assets) != set(capped):
                raise ValueError(
                    "strategy_assets keys must match allocation strategy keys."
                )

            for strategy, asset in strategy_assets.items():
                if asset is not None and (
                    not isinstance(asset, str) or not asset.strip()
                ):
                    raise ValueError(
                        "Mapped asset names must be non-empty strings or None."
                    )

            # Repeatedly reduce strategies sharing an overweight asset.
            # Each pass only decreases allocations, so caps cannot be
            # invalidated by a later pass.
            reduced_assets: set[str] = set()
            for _ in range(len(capped) + 1):
                exposure: dict[str, Decimal] = {}
                for strategy, asset in strategy_assets.items():
                    if asset is not None:
                        exposure[asset] = (
                            exposure.get(asset, Decimal("0.00"))
                            + capped[strategy]
                        )

                overweight = {
                    asset: amount
                    for asset, amount in exposure.items()
                    if amount > asset_cap
                }
                if not overweight:
                    break
                reduced_assets.update(overweight)

                for asset in sorted(overweight):
                    strategies = sorted(
                        strategy
                        for strategy, mapped_asset in strategy_assets.items()
                        if mapped_asset == asset
                    )
                    group = {name: capped[name] for name in strategies}
                    reduced = cls._scale(group, asset_cap)
                    for name, amount in reduced.items():
                        capped[name] = amount

            if reduced_assets:
                binding.append(
                    {
                        "limit": "max_asset_weight",
                        "value": str(asset_limit),
                        "affected": sorted(reduced_assets),
                        "detail": (
                            f"Assets above {asset_limit:.2%} of capital, counting "
                            "every strategy that holds them, were cut to "
                            f"{asset_cap}; the rest stays as cash."
                        ),
                    }
                )

        elif asset_exposures is not None:
            if not isinstance(asset_exposures, Mapping) or not asset_exposures:
                raise ValueError("asset_exposures must be a non-empty mapping.")

            validated: dict[str, Decimal] = {}
            for asset, amount in asset_exposures.items():
                if not isinstance(asset, str) or not asset.strip():
                    raise ValueError("Asset names must be non-empty strings.")
                validated[asset] = cls._decimal(
                    amount, f"asset_exposures[{asset!r}]"
                )

            if sum(validated.values(), Decimal("0.00")) != sum(
                capped.values(), Decimal("0.00")
            ):
                raise ValueError(
                    "Asset exposure totals must equal capped strategy allocations."
                )
            if any(amount > asset_cap for amount in validated.values()):
                raise ValueError(
                    "Asset exposure exceeds max_asset_weight; "
                    "provide strategy_assets to enforce the limit."
                )

        invested = sum(capped.values(), Decimal("0.00"))
        if invested > max_invested or invested > available:
            raise ValueError("Risk constraints could not be satisfied.")

        result = tuple(
            RiskConstrainedAllocation(strategy=name, amount=capped[name])
            for name in sorted(capped)
        )

        return RiskConstraintResult(
            allocations=result,
            cash_reserve=total - invested,
            available_capital=available,
            invested_capital=invested,
            binding_limits=tuple(binding),
        )
