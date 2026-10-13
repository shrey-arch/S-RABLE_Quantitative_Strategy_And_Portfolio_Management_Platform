from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN


@dataclass(frozen=True)
class RebalanceTrade:
    asset: str
    side: str
    quantity: int
    price: Decimal
    value: Decimal


@dataclass(frozen=True)
class RebalanceResult:
    trades: tuple[RebalanceTrade, ...]
    starting_cash: Decimal
    ending_cash: Decimal
    target_values: Mapping[str, Decimal]


class PortfolioRebalancingService:
    CENT = Decimal("0.01")

    @staticmethod
    def _money(value: object, field: str) -> Decimal:
        if isinstance(value, bool):
            raise ValueError(f"{field} must be a finite nonnegative amount.")
        try:
            result = Decimal(str(value))
        except Exception as exc:
            raise ValueError(
                f"{field} must be a finite nonnegative amount."
            ) from exc
        if not result.is_finite() or result < 0:
            raise ValueError(f"{field} must be a finite nonnegative amount.")
        return result

    @classmethod
    def propose(
        cls,
        cash: Decimal | int | float | str,
        holdings: Mapping[str, tuple[int, Decimal | int | float | str]],
        target_values: Mapping[str, Decimal | int | float | str],
        prices: Mapping[str, Decimal | int | float | str],
        *,
        minimum_trade_value: Decimal | int | float | str = Decimal("0.00"),
    ) -> RebalanceResult:
        starting_cash = cls._money(cash, "cash").quantize(cls.CENT)
        minimum = cls._money(minimum_trade_value, "minimum_trade_value")

        if not isinstance(holdings, Mapping):
            raise ValueError("holdings must be a mapping.")
        if not isinstance(target_values, Mapping):
            raise ValueError("target_values must be a mapping.")
        if not isinstance(prices, Mapping):
            raise ValueError("prices must be a mapping.")

        normalized_holdings: dict[str, tuple[int, Decimal]] = {}
        for asset, holding in holdings.items():
            if not isinstance(asset, str) or not asset.strip():
                raise ValueError("Holding asset names must be non-empty strings.")
            if not isinstance(holding, tuple) or len(holding) != 2:
                raise ValueError(
                    "Each holding must be a (quantity, price) tuple."
                )

            quantity, price_value = holding
            if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 0:
                raise ValueError("Holding quantities must be nonnegative integers.")

            price = cls._money(price_value, f"holding price for {asset}")
            if quantity > 0 and price <= 0:
                raise ValueError("Held assets must have a positive price.")

            normalized_holdings[asset] = (quantity, price)

        targets: dict[str, Decimal] = {}
        for asset, value in target_values.items():
            if not isinstance(asset, str) or not asset.strip():
                raise ValueError("Target asset names must be non-empty strings.")
            targets[asset] = cls._money(value, f"target value for {asset}").quantize(
                cls.CENT
            )

        all_assets = sorted(set(normalized_holdings) | set(targets))
        required_prices: dict[str, Decimal] = {}

        for asset in all_assets:
            price_value = prices.get(asset)
            if price_value is None:
                if asset in normalized_holdings and normalized_holdings[asset][0] > 0:
                    price_value = normalized_holdings[asset][1]
                else:
                    raise ValueError(f"Missing price for target asset {asset!r}.")

            price = cls._money(price_value, f"price for {asset}")
            if price <= 0:
                raise ValueError(f"Price for {asset!r} must be greater than zero.")
            required_prices[asset] = price

        trades: list[RebalanceTrade] = []

        # Sells are proposed first to avoid relying on unconfirmed sale proceeds.
        for asset in all_assets:
            quantity, _ = normalized_holdings.get(
                asset, (0, required_prices[asset])
            )
            price = required_prices[asset]
            target = targets.get(asset, Decimal("0.00"))
            current_value = price * quantity

            if current_value <= target:
                continue

            excess = current_value - target
            if excess < minimum:
                continue

            sell_quantity = min(
                quantity,
                int((excess / price).to_integral_value(rounding=ROUND_DOWN)),
            )
            if sell_quantity > 0:
                trades.append(
                    RebalanceTrade(
                        asset=asset,
                        side="SELL",
                        quantity=sell_quantity,
                        price=price,
                        value=(price * sell_quantity).quantize(cls.CENT),
                    )
                )

        sell_proceeds = sum(
            (trade.value for trade in trades), Decimal("0.00")
        )
        available_cash = starting_cash + sell_proceeds

        # Buys use only starting cash plus proposed sell proceeds.
        for asset in all_assets:
            quantity, _ = normalized_holdings.get(
                asset, (0, required_prices[asset])
            )
            price = required_prices[asset]
            target = targets.get(asset, Decimal("0.00"))
            current_value = price * quantity

            if current_value >= target:
                continue

            deficit = target - current_value
            if deficit < minimum:
                continue

            buy_quantity = int(
                (deficit / price).to_integral_value(rounding=ROUND_DOWN)
            )
            buy_quantity = min(
                buy_quantity,
                int((available_cash / price).to_integral_value(rounding=ROUND_DOWN)),
            )

            if buy_quantity > 0:
                value = (price * buy_quantity).quantize(cls.CENT)
                trades.append(
                    RebalanceTrade(
                        asset=asset,
                        side="BUY",
                        quantity=buy_quantity,
                        price=price,
                        value=value,
                    )
                )
                available_cash -= value

        ending_cash = starting_cash + sell_proceeds - sum(
            (trade.value for trade in trades if trade.side == "BUY"),
            Decimal("0.00"),
        )

        return RebalanceResult(
            trades=tuple(trades),
            starting_cash=starting_cash,
            ending_cash=ending_cash,
            target_values=targets,
        )
