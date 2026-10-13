from datetime import datetime

from app.backtesting.broker import SimulatedBroker
from app.backtesting.fills import SimulatedFill
from app.enums import OrderSide, OrderStatus, OrderType


class BacktestExecution:
    """
    Executes existing Order objects through a simulated broker.
    """

    def __init__(self, broker: SimulatedBroker):
        self.broker = broker

    def execute(
        self,
        *,
        order,
        market_price: float,
        timestamp: datetime,
        market_high: float | None = None,
        market_low: float | None = None,
    ) -> SimulatedFill | None:
        fill = None

        if order.order_type == OrderType.MARKET:
            fill = self.broker.execute_market_order(
                side=order.order_side.value,
                quantity=order.quantity,
                market_price=market_price,
                timestamp=timestamp,
            )

        elif order.order_type == OrderType.LIMIT:
            if market_high is None or market_low is None:
                raise ValueError(
                    "market_high and market_low are required for LIMIT orders."
                )

            if market_high < market_low:
                raise ValueError(
                    "market_high cannot be lower than market_low."
                )

            limit_price = float(order.price)

            if limit_price <= 0:
                raise ValueError("LIMIT order price must be greater than 0.")

            if order.order_side == OrderSide.BUY:
                if market_low > limit_price:
                    return None

            elif order.order_side == OrderSide.SELL:
                if market_high < limit_price:
                    return None

            else:
                raise ValueError(
                    f"Unsupported order side: {order.order_side}"
                )

            fill = self.broker.execute_limit_order(
                side=order.order_side.value,
                quantity=order.quantity,
                limit_price=limit_price,
                timestamp=timestamp,
            )

        else:
            raise ValueError(
                "BacktestExecution currently supports MARKET and LIMIT orders only."
            )

        order.filled_quantity = fill.quantity
        order.average_fill_price = fill.price
        order.status = OrderStatus.COMPLETED

        return fill
