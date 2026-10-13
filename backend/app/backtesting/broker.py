from datetime import datetime

from app.backtesting.fills import SimulatedFill


class SimulatedBroker:
    """
    Simulates market and limit-order execution for historical backtests.
    """

    def __init__(
        self,
        *,
        slippage_bps: float = 0.0,
        brokerage_rate: float = 0.0,
    ):
        if slippage_bps < 0:
            raise ValueError("slippage_bps cannot be negative.")

        if brokerage_rate < 0:
            raise ValueError("brokerage_rate cannot be negative.")

        self.slippage_bps = slippage_bps
        self.brokerage_rate = brokerage_rate

    def execute_market_order(
        self,
        *,
        side: str,
        quantity: int,
        market_price: float,
        timestamp: datetime,
    ) -> SimulatedFill:
        if side not in {"BUY", "SELL"}:
            raise ValueError("side must be BUY or SELL.")

        if quantity <= 0:
            raise ValueError("quantity must be greater than 0.")

        if market_price <= 0:
            raise ValueError("market_price must be greater than 0.")

        slippage_factor = self.slippage_bps / 10000

        if side == "BUY":
            fill_price = market_price * (1 + slippage_factor)
        else:
            fill_price = market_price * (1 - slippage_factor)

        trade_value = quantity * fill_price
        brokerage = trade_value * self.brokerage_rate

        return SimulatedFill(
            quantity=quantity,
            price=fill_price,
            brokerage=brokerage,
            total_charges=brokerage,
            timestamp=timestamp,
        )

    def execute_limit_order(
        self,
        *,
        side: str,
        quantity: int,
        limit_price: float,
        timestamp: datetime,
    ) -> SimulatedFill:
        if side not in {"BUY", "SELL"}:
            raise ValueError("side must be BUY or SELL.")

        if quantity <= 0:
            raise ValueError("quantity must be greater than 0.")

        if limit_price <= 0:
            raise ValueError("limit_price must be greater than 0.")

        trade_value = quantity * limit_price
        brokerage = trade_value * self.brokerage_rate

        return SimulatedFill(
            quantity=quantity,
            price=limit_price,
            brokerage=brokerage,
            total_charges=brokerage,
            timestamp=timestamp,
        )
