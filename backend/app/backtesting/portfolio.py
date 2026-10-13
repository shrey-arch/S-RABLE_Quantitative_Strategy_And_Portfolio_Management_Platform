from dataclasses import dataclass, field

from app.enums import PositionStatus
from app.models import Position


@dataclass(frozen=True)
class TradeApplicationResult:
    realized_pnl: float
    closed_quantity: int
    opened_quantity: int


@dataclass
class Portfolio:
    initial_capital: float
    cash: float = field(init=False)
    realized_pnl: float = 0.0
    total_fees: float = 0.0
    positions: dict = field(default_factory=dict)
    closed_positions: dict = field(default_factory=dict)
    equity_history: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.initial_capital <= 0:
            raise ValueError("initial_capital must be greater than 0.")
        self.cash = self.initial_capital

    def apply_trade(
        self,
        *,
        instrument_id: str,
        side: str,
        quantity: int,
        price: float,
        fees: float = 0.0,
    ) -> float:
        realized_for_fill = 0.0

        if quantity <= 0:
            raise ValueError("quantity must be greater than 0.")

        if price <= 0:
            raise ValueError("price must be greater than 0.")

        if fees < 0:
            raise ValueError("fees cannot be negative.")

        if side not in {"BUY", "SELL"}:
            raise ValueError("side must be BUY or SELL.")

        position = self.positions.get(
            instrument_id,
            {
                "quantity": 0,
                "average_price": 0.0,
                "realized_pnl": 0.0,
            },
        )

        current_quantity = position["quantity"]
        current_average_price = position["average_price"]

        if side == "BUY":
            trade_value = quantity * price
            total_cost = trade_value + fees

            if current_quantity < 0:
                short_quantity = abs(current_quantity)

                if quantity <= short_quantity:
                    realized = quantity * (current_average_price - price)
                    position["realized_pnl"] += realized
                    self.realized_pnl += realized
                    realized_for_fill += realized
                    self.cash -= total_cost

                    new_quantity = current_quantity + quantity

                    if new_quantity == 0:
                        self.closed_positions[instrument_id] = {
                            "quantity": 0,
                            "average_price": current_average_price,
                            "current_price": price,
                            "market_value": 0.0,
                            "realized_pnl": position["realized_pnl"],
                            "closed_at": None,
                        }
                        self.positions.pop(instrument_id, None)
                    else:
                        position["quantity"] = new_quantity
                        self.positions[instrument_id] = position

                    self.total_fees += fees
                    return realized_for_fill

                realized = short_quantity * (current_average_price - price)
                position["realized_pnl"] += realized
                self.realized_pnl += realized
                realized_for_fill += realized

                remaining_quantity = quantity - short_quantity

                if remaining_quantity * price + fees > self.cash:
                    raise ValueError("Insufficient cash for trade.")

                position = {
                    "quantity": remaining_quantity,
                    "average_price": price,
                    "realized_pnl": position["realized_pnl"],
                }

                self.cash -= total_cost
                self.positions[instrument_id] = position
                self.total_fees += fees
                return realized_for_fill

            if total_cost > self.cash:
                raise ValueError("Insufficient cash for trade.")

            new_quantity = current_quantity + quantity

            position["average_price"] = (
                (
                    current_quantity * current_average_price
                    + quantity * price
                )
                / new_quantity
            )

            position["quantity"] = new_quantity
            self.cash -= total_cost
            self.positions[instrument_id] = position

        else:
            trade_value = quantity * price
            proceeds = trade_value - fees

            if current_quantity > 0:
                if quantity <= current_quantity:
                    realized = quantity * (price - current_average_price)
                    position["realized_pnl"] += realized
                    self.realized_pnl += realized
                    realized_for_fill += realized

                    position["quantity"] = current_quantity - quantity
                    self.cash += proceeds

                    if position["quantity"] == 0:
                        self.closed_positions[instrument_id] = {
                            "quantity": 0,
                            "average_price": current_average_price,
                            "current_price": price,
                            "market_value": 0.0,
                            "realized_pnl": position["realized_pnl"],
                            "closed_at": None,
                        }
                        self.positions.pop(instrument_id, None)
                    else:
                        self.positions[instrument_id] = position

                    self.total_fees += fees
                    return realized_for_fill

                realized = current_quantity * (price - current_average_price)
                position["realized_pnl"] += realized
                self.realized_pnl += realized
                realized_for_fill += realized

                remaining_quantity = quantity - current_quantity

                position = {
                    "quantity": -remaining_quantity,
                    "average_price": price,
                    "realized_pnl": position["realized_pnl"],
                }

                self.cash += proceeds
                self.positions[instrument_id] = position
                self.total_fees += fees
                return realized_for_fill

            position["quantity"] = -quantity
            position["average_price"] = price
            self.cash += proceeds
            self.positions[instrument_id] = position

        self.total_fees += fees
        return realized_for_fill

    def apply_trade_with_result(
        self,
        *,
        instrument_id: str,
        side: str,
        quantity: int,
        price: float,
        fees: float = 0.0,
    ) -> TradeApplicationResult:
        previous_quantity = self.positions.get(
            instrument_id, {}
        ).get("quantity", 0)

        realized_pnl = self.apply_trade(
            instrument_id=instrument_id,
            side=side,
            quantity=quantity,
            price=price,
            fees=fees,
        )

        if side == "BUY":
            closed_quantity = min(quantity, abs(previous_quantity)) if previous_quantity < 0 else 0
        else:
            closed_quantity = min(quantity, previous_quantity) if previous_quantity > 0 else 0

        opened_quantity = quantity - closed_quantity

        return TradeApplicationResult(
            realized_pnl=realized_pnl,
            closed_quantity=closed_quantity,
            opened_quantity=opened_quantity,
        )
    def calculate_value(self, prices: dict[str, float]) -> float:
        value = self.cash

        for instrument_id, position in self.positions.items():
            quantity = position["quantity"]
            price = prices[instrument_id]
            value += quantity * price

        return value

    def record_equity(
        self,
        timestamp,
        prices: dict[str, float],
    ) -> None:
        self.equity_history.append(
            {
                "timestamp": timestamp,
                "portfolio_value": self.calculate_value(prices),
            }
        )

    def to_position_model(
        self,
        *,
        execution_id,
        instrument_id,
        timestamp,
        current_price: float,
    ):
        if instrument_id in self.positions:
            position = self.positions[instrument_id]
            quantity = position["quantity"]
            average_price = position["average_price"]
            market_value = quantity * current_price
            unrealized_pnl = quantity * (current_price - average_price)

            return Position(
                execution_id=execution_id,
                instrument_id=instrument_id,
                quantity=quantity,
                average_price=average_price,
                current_price=current_price,
                market_value=market_value,
                realized_pnl=position["realized_pnl"],
                unrealized_pnl=unrealized_pnl,
                status=PositionStatus.OPEN,
                last_updated=timestamp,
                closed_at=None,
            )

        if instrument_id in self.closed_positions:
            position = self.closed_positions[instrument_id]

            return Position(
                execution_id=execution_id,
                instrument_id=instrument_id,
                quantity=0,
                average_price=position["average_price"],
                current_price=position["current_price"],
                market_value=0.0,
                realized_pnl=position["realized_pnl"],
                unrealized_pnl=0.0,
                status=PositionStatus.CLOSED,
                last_updated=timestamp,
                closed_at=timestamp,
            )

        raise ValueError("Position does not exist.")
