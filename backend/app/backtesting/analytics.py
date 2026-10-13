from __future__ import annotations

import math
from datetime import datetime
from typing import Any


def calculate_cumulative_return(
    initial_capital: float,
    final_capital: float,
) -> float:
    """Return total portfolio growth as a decimal fraction."""
    if not math.isfinite(initial_capital) or initial_capital <= 0:
        raise ValueError("initial_capital must be finite and greater than zero.")
    if not math.isfinite(final_capital) or final_capital < 0:
        raise ValueError("final_capital must be finite and non-negative.")

    return (final_capital - initial_capital) / initial_capital


def calculate_periodic_returns(equity_curve: list[dict[str, Any]]) -> list[float]:
    """Calculate simple returns between consecutive equity observations."""
    values = []
    for index, point in enumerate(equity_curve):
        value = point.get("portfolio_value")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(
                f"equity_curve[{index}].portfolio_value must be numeric."
            )
        if not math.isfinite(value) or value <= 0:
            raise ValueError(
                f"equity_curve[{index}].portfolio_value must be finite and positive."
            )
        values.append(float(value))

    return [
        (current - previous) / previous
        for previous, current in zip(values, values[1:])
    ]


def calculate_annualized_return(
    initial_capital: float,
    final_capital: float,
    start_timestamp: datetime,
    end_timestamp: datetime,
    *,
    periods_per_year: float | None = None,
) -> float | None:
    """
    Calculate CAGR from elapsed calendar time, or from explicit period frequency.

    Returns None for zero-duration intervals or a final value of zero, where
    CAGR is not meaningful. If periods_per_year is supplied, timestamps are
    not used to determine duration; the equity observations are assumed to
    span one fewer period than the number of observations.
    """
    if not math.isfinite(initial_capital) or initial_capital <= 0:
        raise ValueError("initial_capital must be finite and greater than zero.")
    if not math.isfinite(final_capital) or final_capital < 0:
        raise ValueError("final_capital must be finite and non-negative.")

    if periods_per_year is not None:
        if not math.isfinite(periods_per_year) or periods_per_year <= 0:
            raise ValueError("periods_per_year must be finite and positive.")
        # Explicit frequency is intended for a one-period return annualization.
        # For a multi-observation equity curve, callers should provide the
        # number of elapsed periods separately in a future API revision.
        if final_capital == 0:
            return None
        return (final_capital / initial_capital) ** periods_per_year - 1

    if start_timestamp.tzinfo is None and end_timestamp.tzinfo is not None:
        raise ValueError("timestamps must have consistent timezone awareness.")
    if start_timestamp.tzinfo is not None and end_timestamp.tzinfo is None:
        raise ValueError("timestamps must have consistent timezone awareness.")

    elapsed_seconds = (end_timestamp - start_timestamp).total_seconds()
    if elapsed_seconds < 0:
        raise ValueError("end_timestamp must not precede start_timestamp.")
    if elapsed_seconds == 0 or final_capital == 0:
        return None

    elapsed_years = elapsed_seconds / (365.2425 * 24 * 60 * 60)
    return (final_capital / initial_capital) ** (1 / elapsed_years) - 1


def calculate_volatility(
    periodic_returns: list[float],
    *,
    periods_per_year: float | None = None,
) -> float | None:
    """Calculate sample standard deviation of returns, optionally annualized."""
    values = []
    for index, value in enumerate(periodic_returns):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"periodic_returns[{index}] must be numeric.")
        if not math.isfinite(value):
            raise ValueError(f"periodic_returns[{index}] must be finite.")
        values.append(float(value))

    if periods_per_year is not None:
        if not math.isfinite(periods_per_year) or periods_per_year <= 0:
            raise ValueError("periods_per_year must be finite and positive.")

    if len(values) < 2:
        return None

    mean_return = sum(values) / len(values)
    variance = sum((value - mean_return) ** 2 for value in values) / (
        len(values) - 1
    )
    volatility = math.sqrt(variance)

    if periods_per_year is not None:
        volatility *= math.sqrt(periods_per_year)

    return volatility


def calculate_max_drawdown(equity_curve: list[dict[str, Any]]) -> float:
    """Calculate maximum peak-to-trough drawdown as a decimal fraction."""
    values = []
    for index, point in enumerate(equity_curve):
        value = point.get("portfolio_value")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(
                f"equity_curve[{index}].portfolio_value must be numeric."
            )
        if not math.isfinite(value) or value <= 0:
            raise ValueError(
                f"equity_curve[{index}].portfolio_value must be finite and positive."
            )
        values.append(float(value))

    peak = None
    max_drawdown = 0.0
    for value in values:
        peak = value if peak is None else max(peak, value)
        max_drawdown = max(max_drawdown, (peak - value) / peak)

    return max_drawdown


def calculate_max_drawdown_duration(
    equity_curve: list[dict[str, Any]],
) -> int:
    """
    Return the longest number of consecutive observations below the prior peak.

    A new peak or a return to the prior peak ends the drawdown duration.
    The unit is observations, not calendar time.
    """
    values = []
    for index, point in enumerate(equity_curve):
        value = point.get("portfolio_value")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(
                f"equity_curve[{index}].portfolio_value must be numeric."
            )
        if not math.isfinite(value) or value <= 0:
            raise ValueError(
                f"equity_curve[{index}].portfolio_value must be finite and positive."
            )
        values.append(float(value))

    if not values:
        return 0

    peak = values[0]
    current_duration = 0
    max_duration = 0

    for value in values[1:]:
        if value >= peak:
            peak = value
            current_duration = 0
        else:
            current_duration += 1
            max_duration = max(max_duration, current_duration)

    return max_duration


def calculate_downside_deviation(
    periodic_returns: list[float],
    *,
    minimum_acceptable_return: float = 0.0,
) -> float | None:
    """
    Calculate downside deviation using all observations in the denominator.

    Returns below the minimum acceptable return contribute squared shortfall;
    returns at or above the target contribute zero.
    """
    if (
        isinstance(minimum_acceptable_return, bool)
        or not isinstance(minimum_acceptable_return, (int, float))
        or not math.isfinite(minimum_acceptable_return)
    ):
        raise ValueError("minimum_acceptable_return must be finite and numeric.")

    values = []
    for index, value in enumerate(periodic_returns):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"periodic_returns[{index}] must be numeric.")
        if not math.isfinite(value):
            raise ValueError(f"periodic_returns[{index}] must be finite.")
        values.append(float(value))

    if not values:
        return None

    squared_shortfalls = [
        min(value - minimum_acceptable_return, 0.0) ** 2
        for value in values
    ]
    return math.sqrt(sum(squared_shortfalls) / len(values))



def calculate_trade_statistics(trades: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Calculate summary statistics from completed trades with realized P&L.

    Each item must represent a completed trade or closing event and contain
    a finite numeric realized_pnl value. P&L is assumed to be net of costs.
    """
    realized_values = []

    for index, trade in enumerate(trades):
        if "realized_pnl" not in trade:
            raise ValueError(
                f"trades[{index}] must contain realized_pnl."
            )

        pnl = trade["realized_pnl"]

        if (
            isinstance(pnl, bool)
            or not isinstance(pnl, (int, float))
            or not math.isfinite(pnl)
        ):
            raise ValueError(
                f"trades[{index}].realized_pnl must be finite and numeric."
            )

        realized_values.append(float(pnl))

    winners = [pnl for pnl in realized_values if pnl > 0]
    losers = [pnl for pnl in realized_values if pnl < 0]

    gross_profit = sum(winners)
    gross_loss = abs(sum(losers))
    trade_count = len(realized_values)

    return {
        "trade_count": trade_count,
        "winning_trades": len(winners),
        "losing_trades": len(losers),
        "win_rate": (
            len(winners) / trade_count if trade_count else None
        ),
        "average_gain": (
            sum(winners) / len(winners) if winners else None
        ),
        "average_loss": (
            sum(losers) / len(losers) if losers else None
        ),
        "profit_factor": (
            gross_profit / gross_loss if gross_loss > 0 else None
        ),
    }


def calculate_sharpe_ratio(
    periodic_returns: list[float],
    *,
    risk_free_rate: float = 0.0,
    periods_per_year: float | None = None,
) -> float | None:
    """Calculate Sharpe ratio using sample volatility and a per-period risk-free rate."""
    if (
        isinstance(risk_free_rate, bool)
        or not isinstance(risk_free_rate, (int, float))
        or not math.isfinite(risk_free_rate)
    ):
        raise ValueError("risk_free_rate must be finite and numeric.")

    excess_returns = []
    for index, value in enumerate(periodic_returns):
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            raise ValueError(
                f"periodic_returns[{index}] must be finite and numeric."
            )
        excess_returns.append(float(value) - float(risk_free_rate))

    if periods_per_year is not None:
        if (
            isinstance(periods_per_year, bool)
            or not isinstance(periods_per_year, (int, float))
            or not math.isfinite(periods_per_year)
            or periods_per_year <= 0
        ):
            raise ValueError("periods_per_year must be finite and positive.")

    if len(excess_returns) < 2:
        return None

    volatility = calculate_volatility(excess_returns)
    if volatility is None or volatility == 0:
        return None

    ratio = (sum(excess_returns) / len(excess_returns)) / volatility

    if periods_per_year is not None:
        ratio *= math.sqrt(periods_per_year)

    return ratio



def calculate_completed_position_trades(
    fills: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Aggregate fill records into completed position lifecycles.

    Realized P&L is gross of fees. Each fill's total_charges is allocated
    proportionally between the quantity closing the current position and any
    quantity opening a new position. Opening fees accumulate until that
    position closes. Remaining open positions are not returned.
    """
    positions: dict[str, dict[str, Any]] = {}
    completed: list[dict[str, Any]] = []

    for index, fill in enumerate(fills):
        required = {
            "instrument_id", "side", "quantity", "price",
            "realized_pnl", "closed_quantity", "opened_quantity",
            "total_charges", "timestamp",
        }
        missing = required - fill.keys()
        if missing:
            raise ValueError(
                f"fills[{index}] missing fields: {sorted(missing)}"
            )

        instrument_id = str(fill["instrument_id"])
        side = fill["side"]
        quantity = fill["quantity"]
        closed_quantity = fill["closed_quantity"]
        opened_quantity = fill["opened_quantity"]
        realized_pnl = fill["realized_pnl"]
        fees = fill["total_charges"]

        if side not in {"BUY", "SELL"}:
            raise ValueError(f"fills[{index}].side must be BUY or SELL.")

        for name, value in (
            ("quantity", quantity),
            ("closed_quantity", closed_quantity),
            ("opened_quantity", opened_quantity),
        ):
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"fills[{index}].{name} must be a non-negative integer.")

        if quantity <= 0 or closed_quantity + opened_quantity != quantity:
            raise ValueError(f"fills[{index}] has inconsistent fill quantities.")

        for name, value in (("realized_pnl", realized_pnl), ("total_charges", fees)):
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or (name == "total_charges" and value < 0)
            ):
                raise ValueError(f"fills[{index}].{name} is invalid.")

        position = positions.get(instrument_id)

        if closed_quantity:
            if position is None:
                raise ValueError(
                    f"fills[{index}] closes a position that is not being tracked."
                )

            expected_closing_side = "SELL" if position["direction"] == "long" else "BUY"
            if side != expected_closing_side:
                raise ValueError(f"fills[{index}] closing side conflicts with position.")

            if closed_quantity > position["quantity"]:
                raise ValueError(f"fills[{index}] closes more than the open quantity.")

            allocated_closing_fees = fees * closed_quantity / quantity
            position["net_pnl"] += (
                float(realized_pnl) - allocated_closing_fees
            )
            position["quantity"] -= closed_quantity

            if position["quantity"] == 0:
                completed.append({
                    "instrument_id": instrument_id,
                    "opened_at": position["opened_at"],
                    "closed_at": fill["timestamp"],
                    "direction": position["direction"],
                    "quantity": position["original_quantity"],
                    "realized_pnl": position["net_pnl"],
                })
                positions.pop(instrument_id)

        if opened_quantity:
            allocated_opening_fees = fees * opened_quantity / quantity
            new_direction = "long" if side == "BUY" else "short"

            if instrument_id in positions:
                position = positions[instrument_id]
                if position["direction"] != new_direction:
                    raise ValueError(
                        f"fills[{index}] opens an opposite position before the prior one closes."
                    )
                position["quantity"] += opened_quantity
                position["original_quantity"] += opened_quantity
                position["net_pnl"] -= allocated_opening_fees
            else:
                positions[instrument_id] = {
                    "direction": new_direction,
                    "quantity": opened_quantity,
                    "original_quantity": opened_quantity,
                    "opened_at": fill["timestamp"],
                    "net_pnl": -allocated_opening_fees,
                }

    return completed
