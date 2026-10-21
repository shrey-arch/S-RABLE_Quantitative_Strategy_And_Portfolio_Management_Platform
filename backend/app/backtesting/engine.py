from collections.abc import Iterator
from types import SimpleNamespace
from uuid import UUID

import pandas as pd

from app.backtesting.broker import SimulatedBroker
from app.backtesting.analytics import (
    calculate_annualized_return,
    calculate_cumulative_return,
    calculate_completed_position_trades,
    calculate_downside_deviation,
    calculate_max_drawdown,
    calculate_max_drawdown_duration,
    calculate_periodic_returns,
    calculate_trade_statistics,
    calculate_sharpe_ratio,
    calculate_volatility,
)
from app.backtesting.context import BacktestContext
from app.backtesting.execution import BacktestExecution
from app.backtesting.portfolio import Portfolio
from app.backtesting.results import BacktestResult
from app.enums import OrderSide, OrderStatus, OrderType
from app.models import Order
from app.strategies.base import Strategy
from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction

# Recorded with each run. 1.1: a signal sets the position held (no piling up).
# 1.2: EXIT closes the position; no-code rule strategies.
# 1.3: custom Python strategies in the isolated sandbox; optional per-signal quantity.
ENGINE_VERSION = "1.3"


class BacktestEngine:
    def iter_market_data(
        self,
        data: pd.DataFrame,
        start=None,
    ) -> Iterator[tuple[pd.Timestamp, pd.DataFrame]]:
        """Each bar from `start` (default: the first) with all the data up to it."""
        if not isinstance(data, pd.DataFrame):
            raise ValueError("data must be a pandas DataFrame.")

        if data.empty:
            return

        if not data.index.is_monotonic_increasing:
            raise ValueError("data must be sorted chronologically.")

        timestamps = data.index if start is None else data.index[data.index >= start]
        for timestamp in timestamps:
            yield timestamp, data.loc[:timestamp].copy()

    def generate_signals(
        self,
        *,
        strategy: Strategy,
        data: pd.DataFrame,
    ) -> Iterator:
        prepare = getattr(strategy, "prepare", None)
        if callable(prepare):
            prepare(data)
        for timestamp, historical_data in self.iter_market_data(data):
            context = StrategyContext(
                instrument=None,
                timestamp=timestamp.to_pydatetime()
                if isinstance(timestamp, pd.Timestamp)
                else timestamp,
                market_data={"data": historical_data},
            )

            yield strategy.generate_signal(context)

    def signal_to_order(
        self,
        *,
        signal,
        execution_id: UUID,
        instrument_id: UUID,
        market_price: float,
        timestamp,
        quantity: int = 1,
    ) -> Order | None:
        if quantity <= 0:
            raise ValueError("quantity must be greater than 0.")

        if market_price <= 0:
            raise ValueError("market_price must be greater than 0.")

        if signal.action == SignalAction.HOLD:
            return None

        if signal.action == SignalAction.BUY:
            side = OrderSide.BUY
        elif signal.action == SignalAction.SELL:
            side = OrderSide.SELL
        else:
            raise ValueError(f"Unsupported signal action: {signal.action}")

        return Order(
            execution_id=execution_id,
            instrument_id=instrument_id,
            order_type=OrderType.MARKET,
            order_side=side,
            status=OrderStatus.PENDING,
            quantity=quantity,
            filled_quantity=0,
            price=market_price,
            average_fill_price=None,
            order_timestamp=timestamp,
        )

    def signal_to_orders(
        self,
        *,
        signal,
        execution_id: UUID,
        instrument_ids: dict[str, UUID],
        market_prices: dict[str, float],
        timestamp,
        quantity: int = 1,
        available_capital: float | None = None,
    ) -> list[Order]:
        if quantity <= 0:
            raise ValueError("quantity must be greater than 0.")

        if not signal.allocations:
            if not instrument_ids:
                raise ValueError("instrument_ids cannot be empty.")

            first_key = next(iter(instrument_ids))

            order = self.signal_to_order(
                signal=signal,
                execution_id=execution_id,
                instrument_id=instrument_ids[first_key],
                market_price=market_prices[first_key],
                timestamp=timestamp,
                quantity=quantity,
            )

            return [] if order is None else [order]

        orders: list[Order] = []

        for instrument_key, allocation in signal.allocations.items():
            if instrument_key not in instrument_ids:
                raise ValueError(
                    f"Unknown instrument allocation: {instrument_key}"
                )

            if instrument_key not in market_prices:
                raise ValueError(
                    f"Missing market price for instrument: {instrument_key}"
                )

            if allocation == 0:
                continue

            price = market_prices[instrument_key]

            if price <= 0:
                raise ValueError(
                    f"Market price must be greater than 0 for {instrument_key}."
                )

            if available_capital is None:
                order_quantity = quantity
            else:
                target_value = available_capital * abs(float(allocation))
                order_quantity = int(target_value // price)

            if order_quantity <= 0:
                continue

            if allocation > 0:
                side = OrderSide.BUY
            else:
                side = OrderSide.SELL

            orders.append(
                Order(
                    execution_id=execution_id,
                    instrument_id=instrument_ids[instrument_key],
                    order_type=OrderType.MARKET,
                    order_side=side,
                    status=OrderStatus.PENDING,
                    quantity=order_quantity,
                    filled_quantity=0,
                    price=price,
                    average_fill_price=None,
                    order_timestamp=timestamp,
                )
            )

        return orders
    def execute_order(
        self,
        *,
        order: Order,
        execution: BacktestExecution,
        portfolio: Portfolio,
        market_price: float,
        timestamp,
        instrument_id: UUID | None = None,
        market_high: float | None = None,
        market_low: float | None = None,
    ) -> tuple:
        fill = execution.execute(
            order=order,
            market_price=market_price,
            timestamp=timestamp,
            market_high=market_high,
            market_low=market_low,
        )

        if fill is None:
            return None

        effective_instrument_id = instrument_id or order.instrument_id

        portfolio_result = portfolio.apply_trade_with_result(
            instrument_id=str(effective_instrument_id),
            side=order.order_side,
            quantity=fill.quantity,
            price=fill.price,
            fees=fill.total_charges,
        )

        return fill, portfolio_result

    def build_result(
        self,
        *,
        portfolio: Portfolio,
        trades: list[dict],
    ) -> BacktestResult:
        if not portfolio.equity_history:
            raise ValueError("Cannot build result without equity history.")

        equity_curve = portfolio.equity_history.copy()
        start_timestamp = equity_curve[0]["timestamp"]
        end_timestamp = equity_curve[-1]["timestamp"]
        final_capital = equity_curve[-1]["portfolio_value"]

        total_return = calculate_cumulative_return(
            portfolio.initial_capital,
            final_capital,
        )
        periodic_returns = calculate_periodic_returns(equity_curve)

        result = BacktestResult(
            start_timestamp=start_timestamp,
            end_timestamp=end_timestamp,
            initial_capital=portfolio.initial_capital,
            final_capital=final_capital,
            total_return=total_return,
            trades=trades,
            equity_curve=equity_curve,
        )

        result.max_drawdown = calculate_max_drawdown(equity_curve)
        completed_positions = calculate_completed_position_trades(trades)
        completed_stats = calculate_trade_statistics(completed_positions)
        result.performance_stats = {
            "completed_position_count": completed_stats["trade_count"],
            "completed_position_win_rate": completed_stats["win_rate"],
            "completed_position_average_gain": completed_stats["average_gain"],
            "completed_position_average_loss": completed_stats["average_loss"],
            "completed_position_profit_factor": completed_stats["profit_factor"],
            "cumulative_return": total_return,
            "periodic_returns": periodic_returns,
            "annualized_return": calculate_annualized_return(
                portfolio.initial_capital,
                final_capital,
                start_timestamp,
                end_timestamp,
            ),
            "volatility": calculate_volatility(periodic_returns),
            "sharpe_ratio": calculate_sharpe_ratio(periodic_returns),
            "max_drawdown": result.max_drawdown,
            "max_drawdown_duration": calculate_max_drawdown_duration(
                equity_curve
            ),
            "downside_deviation": calculate_downside_deviation(
                periodic_returns
            ),
        }

        return result

    def run(
        self,
        *,
        strategy: Strategy,
        data: pd.DataFrame,
        execution_id: UUID,
        instrument_id: UUID,
        initial_capital: float,
        instrument_ids: dict[str, UUID] | None = None,
        broker: SimulatedBroker | None = None,
        quantity: int = 1,
        trade_from=None,
    ) -> BacktestResult:
        """Run the strategy bar by bar.

        trade_from (optional): bars before it are warm-up. They are in the history
        the strategy sees, but no signal is asked for and nothing is traded or
        recorded before it; the run (equity curve, trades) starts at trade_from with
        the initial capital. Walk-forward uses it so a test span starts with its
        indicators already warmed up on the earlier data, never on later data.
        """
        if not isinstance(data, pd.DataFrame):
            raise ValueError("data must be a pandas DataFrame.")

        if data.empty:
            raise ValueError("data cannot be empty.")

        if trade_from is not None and not (data.index >= trade_from).any():
            raise ValueError("trade_from is after the last bar of the data.")

        if "close" not in data.columns:
            raise ValueError("data must contain a 'close' column.")

        if quantity <= 0:
            raise ValueError("quantity must be greater than 0.")

        if instrument_ids is None:
            instrument_ids = {"default": instrument_id}

        portfolio = Portfolio(initial_capital=initial_capital)

        broker = broker or SimulatedBroker()

        execution = BacktestExecution(broker=broker)

        trades: list[dict] = []
        current_allocations: dict[str, float] | None = None

        # Strategies that compute indicators once over the whole run (rule strategies)
        # do it here, before the first bar.
        prepare = getattr(strategy, "prepare", None)
        if callable(prepare):
            prepare(data)

        for timestamp, historical_data in self.iter_market_data(data, start=trade_from):
            current_timestamp = (
                timestamp.to_pydatetime()
                if isinstance(timestamp, pd.Timestamp)
                else timestamp
            )

            backtest_context = BacktestContext(
                execution_id=execution_id,
                strategy=strategy,
                initial_capital=initial_capital,
                current_timestamp=current_timestamp,
                market_data=historical_data,
            )

            strategy_context = StrategyContext(
                instrument=None,
                timestamp=current_timestamp,
                market_data={
                    "data": historical_data,
                    "current_allocations": current_allocations,
                    # What is held of the (single) instrument before this bar's signal.
                    "position_quantity": int(
                        portfolio.positions.get(str(instrument_id), {}).get("quantity", 0)
                    ),
                    # Cash available before this bar's signal (Feature 6: context.cash).
                    "cash": float(portfolio.cash),
                    "bar_index": len(historical_data) - 1,
                },
            )

            signal = strategy.generate_signal(strategy_context)

            if signal.allocations and signal.action != SignalAction.HOLD:
                current_allocations = signal.allocations.copy()

            current_close = float(historical_data["close"].iloc[-1])

            if signal.allocations and signal.action != SignalAction.HOLD:
                market_prices: dict[str, float] = {}

                for instrument_key in signal.allocations:
                    if instrument_key not in historical_data.columns:
                        raise ValueError(
                            f"Missing market data for instrument: {instrument_key}"
                        )

                    if instrument_key not in instrument_ids:
                        raise ValueError(
                            f"Missing instrument ID for instrument: {instrument_key}"
                        )

                    market_prices[instrument_key] = float(
                        historical_data[instrument_key].iloc[-1]
                    )

                portfolio_prices = {
                    str(mapped_instrument_id): float(
                        historical_data[instrument_key].iloc[-1]
                    )
                    for instrument_key, mapped_instrument_id in instrument_ids.items()
                    if instrument_key in historical_data.columns
                }

                portfolio_value = portfolio.calculate_value(
                    prices=portfolio_prices
                )

                orders: list[Order] = []

                for instrument_key, target_allocation in signal.allocations.items():
                    instrument_id_for_key = instrument_ids[instrument_key]
                    instrument_id_string = str(instrument_id_for_key)
                    price = market_prices[instrument_key]

                    target_value = portfolio_value * abs(
                        float(target_allocation)
                    )
                    target_quantity = int(target_value // price)

                    if float(target_allocation) < 0:
                        target_quantity = -target_quantity

                    current_position = portfolio.positions.get(
                        instrument_id_string,
                        {
                            "quantity": 0,
                            "average_price": 0.0,
                            "realized_pnl": 0.0,
                        },
                    )

                    current_quantity = int(current_position["quantity"])

                    delta_quantity = target_quantity - current_quantity

                    if delta_quantity > 0:
                        order_side = OrderSide.BUY
                        order_quantity = delta_quantity
                    elif delta_quantity < 0:
                        order_side = OrderSide.SELL
                        order_quantity = abs(delta_quantity)
                    else:
                        continue

                    orders.append(
                        Order(
                            execution_id=execution_id,
                            instrument_id=instrument_id_for_key,
                            order_side=order_side,
                            order_type=OrderType.MARKET,
                            quantity=order_quantity,
                            price=price,
                        )
                    )

                sell_orders = [
                    order
                    for order in orders
                    if order.order_side == OrderSide.SELL
                ]

                buy_orders = [
                    order
                    for order in orders
                    if order.order_side == OrderSide.BUY
                ]

                for order in sell_orders + buy_orders:
                    instrument_key = next(
                        key
                        for key, value in instrument_ids.items()
                        if value == order.instrument_id
                    )

                    instrument_price = market_prices[instrument_key]


                    execution_result = self.execute_order(
                        order=order,
                        execution=execution,
                        portfolio=portfolio,
                        market_price=instrument_price,
                        timestamp=current_timestamp,
                        instrument_id=order.instrument_id,
                    )

                    if execution_result is not None:
                        fill, portfolio_result = execution_result
                        realized_pnl = portfolio_result.realized_pnl
                        trades.append(
                            {
                                "timestamp": current_timestamp,
                                "instrument_id": str(order.instrument_id),
                                "side": order.order_side.value,
                                "quantity": fill.quantity,
                                "price": fill.price,
                                "brokerage": fill.brokerage,
                                "total_charges": fill.total_charges,
                                "realized_pnl": realized_pnl,
                                "closed_quantity": portfolio_result.closed_quantity,
                                "opened_quantity": portfolio_result.opened_quantity,
                            }
                        )

            else:
                # A signal sets the position to hold, it is not a trade by itself:
                # BUY = hold +quantity (long), SELL = hold -quantity (short),
                # EXIT = hold nothing, HOLD = keep what is held. Only the difference is
                # traded, so a strategy that says BUY on many bars in a row buys once.
                current_quantity = int(
                    portfolio.positions.get(str(instrument_id), {}).get("quantity", 0)
                )
                # A custom Python strategy may size the signal (signal.quantity);
                # otherwise the run's quantity is the position magnitude.
                size = getattr(signal, "quantity", None)
                size = quantity if size is None else int(size)
                if signal.action == SignalAction.BUY:
                    target_quantity = size
                elif signal.action == SignalAction.SELL:
                    target_quantity = -size
                elif signal.action == SignalAction.EXIT:
                    target_quantity = 0
                else:
                    target_quantity = current_quantity
                delta_quantity = target_quantity - current_quantity

                order = None
                if delta_quantity != 0:
                    order = self.signal_to_order(
                        signal=SimpleNamespace(
                            action=SignalAction.BUY
                            if delta_quantity > 0
                            else SignalAction.SELL
                        ),
                        execution_id=execution_id,
                        instrument_id=instrument_id,
                        market_price=current_close,
                        timestamp=current_timestamp,
                        quantity=abs(delta_quantity),
                    )

                if order is not None:
                    market_high = (
                        float(historical_data["high"].iloc[-1])
                        if "high" in historical_data.columns
                        else None
                    )

                    market_low = (
                        float(historical_data["low"].iloc[-1])
                        if "low" in historical_data.columns
                        else None
                    )


                    execution_result = self.execute_order(
                        order=order,
                        execution=execution,
                        portfolio=portfolio,
                        market_price=current_close,
                        timestamp=current_timestamp,
                        instrument_id=instrument_id,
                        market_high=market_high,
                        market_low=market_low,
                    )

                    if execution_result is not None:
                        fill, portfolio_result = execution_result
                        realized_pnl = portfolio_result.realized_pnl
                        trades.append(
                            {
                                "timestamp": current_timestamp,
                                "instrument_id": str(order.instrument_id),
                                "side": order.order_side.value,
                                "quantity": fill.quantity,
                                "price": fill.price,
                                "brokerage": fill.brokerage,
                                "total_charges": fill.total_charges,
                                "realized_pnl": realized_pnl,
                                "closed_quantity": portfolio_result.closed_quantity,
                                "opened_quantity": portfolio_result.opened_quantity,
                            }
                        )

            prices: dict[str, float] = {
                str(instrument_id): current_close
            }

            if signal.allocations:
                for instrument_key in signal.allocations:
                    if instrument_key in instrument_ids:
                        prices[str(instrument_ids[instrument_key])] = float(
                            historical_data[instrument_key].iloc[-1]
                        )

            else:
                for instrument_key, mapped_instrument_id in instrument_ids.items():
                    if instrument_key in historical_data.columns:
                        prices[str(mapped_instrument_id)] = float(
                            historical_data[instrument_key].iloc[-1]
                        )

            portfolio.record_equity(
                timestamp=current_timestamp,
                prices=prices,
            )

        return self.build_result(
            portfolio=portfolio,
            trades=trades,
        )
