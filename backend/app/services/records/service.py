"""Trading records of the user's backtests (Phase 15).

A completed backtest's simulated orders, fills and positions are stored in the
orders, trades and positions tables. The values are the engine's own: the
stored fills are replayed through the engine's Portfolio (as on the results
page), each fill becomes one MARKET order (COMPLETED, filled) with one trade,
and each instrument gets one position:
- still open at the end: its size, direction and average price from the
  engine, valued at the run's last stored close;
- closed: size 0, the average price it had, closed at its last fill.
A position's realised P&L is the sum of the realised P&L (before charges) of
the run's fills on that instrument. Nothing here is a real order.

Every read and change is limited to records of the user's own executions.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.enums import (
    ExecutionStatus,
    ExecutionType,
    OrderSide,
    OrderStatus,
    OrderType,
    PositionStatus,
    Timeframe,
)
from app.models import Execution, MarketData, Order, Position, Strategy, Trade
from app.services.backtesting.results_analytics import replay_fills
from app.services.regime.service import day_bounds

NOT_BACKTEST = "Only backtests have trading records."
NOT_COMPLETED = "Records are stored once the backtest has completed (it is {status})."
NO_RESULT = "This run has no stored result."
ALREADY_STORED = "This run's records are already stored."


class RecordsExist(ValueError):
    """The run's records were stored before."""


def owned_execution_ids(user_id: UUID) -> Select:
    """Ids of the executions of the user's strategies."""
    return (
        select(Execution.id)
        .join(Strategy, Strategy.id == Execution.strategy_id)
        .where(Strategy.user_id == user_id)
    )


def has_records(db: Session, execution_id: UUID) -> bool:
    return bool(
        db.scalar(select(func.count()).select_from(Order).where(Order.execution_id == execution_id))
    )


def _closes(db: Session, instrument_ids: Iterable[str], timeframe: str, first: str, last: str):
    """Stored closes between the run's first and last bar, keyed like the curve."""
    start, end = datetime.fromisoformat(first), datetime.fromisoformat(last)
    closes: dict[str, dict[str, float]] = {}
    for instrument_id in instrument_ids:
        rows = db.execute(
            select(MarketData.timestamp, MarketData.close).where(
                MarketData.instrument_id == UUID(instrument_id),
                MarketData.timeframe == Timeframe(timeframe),
                MarketData.timestamp >= start,
                MarketData.timestamp <= end,
            )
        ).all()
        by_time: dict[str, float] = {}
        for timestamp, close in rows:
            by_time[timestamp.isoformat()] = float(close)
            by_time[timestamp.astimezone(start.tzinfo).isoformat()] = float(close)
        closes[instrument_id] = by_time
    return closes


def store_backtest_records(db: Session, execution: Execution, *, completing: bool = False) -> dict:
    """Write a completed backtest's orders, trades and positions. Returns counts.

    `completing`: called by the worker just before it marks the run COMPLETED;
    the records are only flushed and are committed together with that status."""
    if execution.execution_type != ExecutionType.BACKTEST:
        raise ValueError(NOT_BACKTEST)
    if not completing and execution.status != ExecutionStatus.COMPLETED:
        raise ValueError(NOT_COMPLETED.format(status=execution.status.value))
    metrics = execution.execution_metrics if isinstance(execution.execution_metrics, dict) else {}
    canonical = metrics.get("canonical_result")
    if not isinstance(canonical, dict) or not canonical.get("equity_curve"):
        raise ValueError(NO_RESULT)
    if has_records(db, execution.id):
        raise RecordsExist(ALREADY_STORED)

    curve = canonical["equity_curve"]
    first, last = curve[0]["timestamp"], curve[-1]["timestamp"]
    fills, portfolio = replay_fills(canonical.get("trades") or [], float(execution.initial_capital))
    instrument_ids = sorted({f["instrument_id"] for f in fills})
    closes = _closes(db, instrument_ids, execution.timeframe, first, last)

    for fill in fills:
        at = datetime.fromisoformat(fill["timestamp"])
        reference = closes.get(fill["instrument_id"], {}).get(fill["timestamp"])
        order = Order(
            execution_id=execution.id,
            instrument_id=UUID(fill["instrument_id"]),
            order_type=OrderType.MARKET,
            order_side=OrderSide(fill["side"]),
            status=OrderStatus.COMPLETED,
            quantity=fill["quantity"],
            filled_quantity=fill["quantity"],
            # A market order is sent at the bar's close; it fills with slippage.
            price=reference if reference else fill["price"],
            average_fill_price=fill["price"],
            order_timestamp=at,
        )
        order.trades.append(
            Trade(
                executed_quantity=fill["quantity"],
                executed_price=fill["price"],
                brokerage=fill["brokerage"],
                total_charges=fill["total_charges"],
                trade_timestamp=at,
            )
        )
        db.add(order)

    last_at = datetime.fromisoformat(last)
    for instrument_id in instrument_ids:
        own = [f for f in fills if f["instrument_id"] == instrument_id]
        realized = sum(f["realized_pnl"] for f in own)
        open_position = portfolio.positions.get(instrument_id)
        if open_position is not None:
            quantity = open_position["quantity"]
            average = open_position["average_price"]
            price = closes.get(instrument_id, {}).get(last)
            db.add(
                Position(
                    execution_id=execution.id,
                    instrument_id=UUID(instrument_id),
                    direction="LONG" if quantity > 0 else "SHORT",
                    quantity=abs(quantity),
                    average_price=average,
                    current_price=price,
                    market_value=abs(quantity) * price if price else None,
                    realized_pnl=realized,
                    unrealized_pnl=quantity * (price - average) if price else 0.0,
                    position_status=PositionStatus.OPEN,
                    last_updated_at=last_at,
                    closed_at=None,
                )
            )
        else:
            closed = portfolio.closed_positions[instrument_id]
            closing = own[-1]
            closed_at = datetime.fromisoformat(closing["timestamp"])
            db.add(
                Position(
                    execution_id=execution.id,
                    instrument_id=UUID(instrument_id),
                    # A buy that closes was covering a short; a sell closes a long.
                    direction="SHORT" if closing["side"] == "BUY" else "LONG",
                    quantity=0,
                    average_price=closed["average_price"],
                    current_price=closed["current_price"],
                    market_value=0.0,
                    realized_pnl=realized,
                    unrealized_pnl=0.0,
                    position_status=PositionStatus.CLOSED,
                    last_updated_at=closed_at,
                    closed_at=closed_at,
                )
            )
    if completing:
        db.flush()
    else:
        db.commit()
    return {"orders": len(fills), "trades": len(fills), "positions": len(instrument_ids)}


def _dates(statement: Select, column, start: date | None, end: date | None) -> Select:
    low, high = day_bounds(start, end)
    if low is not None:
        statement = statement.where(column >= low)
    if high is not None:
        statement = statement.where(column <= high)
    return statement


def list_orders(
    db: Session,
    user_id: UUID,
    *,
    execution_id: UUID | None = None,
    instrument_id: UUID | None = None,
    status: OrderStatus | None = None,
    side: OrderSide | None = None,
    start: date | None = None,
    end: date | None = None,
    limit: int = 1000,
) -> list[Order]:
    statement = select(Order).where(Order.execution_id.in_(owned_execution_ids(user_id)))
    if execution_id:
        statement = statement.where(Order.execution_id == execution_id)
    if instrument_id:
        statement = statement.where(Order.instrument_id == instrument_id)
    if status:
        statement = statement.where(Order.status == status)
    if side:
        statement = statement.where(Order.order_side == side)
    statement = _dates(statement, Order.order_timestamp, start, end)
    return list(
        db.scalars(
            statement.order_by(Order.order_timestamp.desc().nulls_last(), Order.id).limit(limit)
        ).all()
    )


def list_trades(
    db: Session,
    user_id: UUID,
    *,
    execution_id: UUID | None = None,
    instrument_id: UUID | None = None,
    order_id: UUID | None = None,
    side: OrderSide | None = None,
    start: date | None = None,
    end: date | None = None,
    limit: int = 1000,
) -> list[Trade]:
    statement = (
        select(Trade)
        .join(Order, Order.id == Trade.order_id)
        .where(Order.execution_id.in_(owned_execution_ids(user_id)))
    )
    if execution_id:
        statement = statement.where(Order.execution_id == execution_id)
    if instrument_id:
        statement = statement.where(Order.instrument_id == instrument_id)
    if order_id:
        statement = statement.where(Trade.order_id == order_id)
    if side:
        statement = statement.where(Order.order_side == side)
    statement = _dates(statement, Trade.trade_timestamp, start, end)
    return list(
        db.scalars(
            statement.order_by(Trade.trade_timestamp.desc().nulls_last(), Trade.id).limit(limit)
        ).all()
    )


def list_positions(
    db: Session,
    user_id: UUID,
    *,
    execution_id: UUID | None = None,
    instrument_id: UUID | None = None,
    status: PositionStatus | None = None,
    direction: str | None = None,
    start: date | None = None,
    end: date | None = None,
    limit: int = 1000,
) -> list[Position]:
    statement = select(Position).where(Position.execution_id.in_(owned_execution_ids(user_id)))
    if execution_id:
        statement = statement.where(Position.execution_id == execution_id)
    if instrument_id:
        statement = statement.where(Position.instrument_id == instrument_id)
    if status:
        statement = statement.where(Position.position_status == status)
    if direction:
        statement = statement.where(Position.direction == direction)
    statement = _dates(statement, Position.last_updated_at, start, end)
    return list(
        db.scalars(
            statement.order_by(Position.last_updated_at.desc(), Position.id).limit(limit)
        ).all()
    )


def owned_order(db: Session, user_id: UUID, order_id: UUID) -> Order | None:
    return db.scalar(
        select(Order).where(
            Order.id == order_id, Order.execution_id.in_(owned_execution_ids(user_id))
        )
    )


def owned_trade(db: Session, user_id: UUID, trade_id: UUID) -> Trade | None:
    return db.scalar(
        select(Trade)
        .join(Order, Order.id == Trade.order_id)
        .where(Trade.id == trade_id, Order.execution_id.in_(owned_execution_ids(user_id)))
    )


def owned_position(db: Session, user_id: UUID, position_id: UUID) -> Position | None:
    return db.scalar(
        select(Position).where(
            Position.id == position_id,
            Position.execution_id.in_(owned_execution_ids(user_id)),
        )
    )
