from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP


@dataclass(frozen=True)
class PortfolioHolding:
    asset: str
    quantity: int
    price: Decimal

    @property
    def market_value(self) -> Decimal:
        return (self.price * self.quantity).quantize(Decimal("0.01"))


@dataclass(frozen=True)
class PortfolioState:
    cash: Decimal
    holdings: tuple[PortfolioHolding, ...]

    @property
    def invested_value(self) -> Decimal:
        return sum(
            (holding.market_value for holding in self.holdings),
            Decimal("0.00"),
        )

    @property
    def total_equity(self) -> Decimal:
        return self.cash + self.invested_value

    def allocation_weights(self) -> dict[str, Decimal]:
        if self.total_equity <= 0:
            return {holding.asset: Decimal("0") for holding in self.holdings}

        return {
            holding.asset: (
                holding.market_value / self.total_equity
            ).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
            for holding in self.holdings
        }


class PortfolioStateService:
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
    def create(
        cls,
        cash: Decimal | int | float | str,
        holdings: Mapping[str, tuple[int, Decimal | int | float | str]],
    ) -> PortfolioState:
        normalized_cash = cls._decimal(cash, "cash").quantize(cls.CENT)

        if not isinstance(holdings, Mapping):
            raise ValueError("holdings must be a mapping.")

        normalized: list[PortfolioHolding] = []

        for asset, holding in sorted(holdings.items()):
            if not isinstance(asset, str) or not asset.strip():
                raise ValueError("Asset names must be non-empty strings.")

            if not isinstance(holding, tuple) or len(holding) != 2:
                raise ValueError(
                    "Each holding must be a (quantity, price) tuple."
                )

            quantity, price_value = holding

            if (
                isinstance(quantity, bool)
                or not isinstance(quantity, int)
                or quantity < 0
            ):
                raise ValueError("Holding quantities must be nonnegative integers.")

            price = cls._decimal(price_value, f"price for {asset}")

            if quantity > 0 and price <= 0:
                raise ValueError("Held assets must have a positive price.")

            normalized.append(
                PortfolioHolding(
                    asset=asset,
                    quantity=quantity,
                    price=price,
                )
            )

        return PortfolioState(
            cash=normalized_cash,
            holdings=tuple(normalized),
        )
