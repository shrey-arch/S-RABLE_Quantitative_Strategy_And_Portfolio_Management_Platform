"""Full results of a completed backtest, computed from its stored canonical result.

Everything the results page shows is computed here, on the server, from the
stored equity curve and fills (execution_metrics["canonical_result"]). The
frontend only displays these numbers. Nothing is re-run: realized P&L per fill
is recovered by replaying the stored fills through the same Portfolio class the
engine used, so it matches the engine exactly.

Basis (stated in the response and on the page):
- returns are per bar (daily bars), annualised with 252 bars a year;
- the risk-free rate is 6.5% a year, compounded to a per-bar rate;
- CAGR uses calendar time (365.2425-day years) between the first and last bar.
"""

from __future__ import annotations

import math
from collections import OrderedDict
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.backtesting.analytics import (
    calculate_annualized_return,
    calculate_max_drawdown,
    calculate_max_drawdown_duration,
)
from app.backtesting.portfolio import Portfolio

PERIODS_PER_YEAR = 252
RISK_FREE_RATE_ANNUAL = 0.065
RISK_FREE_RATE_PER_PERIOD = (1 + RISK_FREE_RATE_ANNUAL) ** (1 / PERIODS_PER_YEAR) - 1
IST = ZoneInfo("Asia/Kolkata")

NOT_RECORDED = "Not recorded for runs made before results were added (Phase 10)."


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _sample_std(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    mean = _mean(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))


def _finite(value: float | None) -> float | None:
    return value if value is not None and math.isfinite(value) else None


def _bar_returns(values: list[float]) -> list[float]:
    return [(b - a) / a for a, b in zip(values, values[1:]) if a > 0]


def risk_metrics(
    *,
    initial_capital: float,
    final_capital: float,
    values: list[float],
    start: datetime,
    end: datetime,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Return and risk numbers, with a reason for every one that is null."""
    reasons: dict[str, str] = {}
    returns = _bar_returns(values)
    curve = [{"portfolio_value": v} for v in values]
    positive = all(v > 0 for v in values)

    cagr = (
        calculate_annualized_return(initial_capital, final_capital, start, end)
        if final_capital >= 0
        else None
    )
    if cagr is None:
        reasons["cagr"] = (
            "The run covers a single bar, so there is no time to annualise over."
            if start == end
            else "Not defined when the final capital is zero or below."
        )

    std = _sample_std(returns)
    volatility = std * math.sqrt(PERIODS_PER_YEAR) if std is not None else None
    if volatility is None:
        reasons["annualized_volatility"] = "Needs at least two bar-to-bar returns."

    excess = [r - RISK_FREE_RATE_PER_PERIOD for r in returns]
    excess_std = _sample_std(excess)
    sharpe = None
    if excess_std is None:
        reasons["sharpe_ratio"] = "Needs at least two bar-to-bar returns."
    elif excess_std == 0:
        reasons["sharpe_ratio"] = "Returns did not vary, so the ratio is not defined."
    else:
        sharpe = _mean(excess) / excess_std * math.sqrt(PERIODS_PER_YEAR)

    downside = None
    sortino = None
    if not returns:
        reasons["downside_deviation"] = "Needs at least one bar-to-bar return."
        reasons["sortino_ratio"] = "Needs at least one bar-to-bar return."
    else:
        shortfalls = [min(r - RISK_FREE_RATE_PER_PERIOD, 0.0) ** 2 for r in returns]
        per_bar = math.sqrt(sum(shortfalls) / len(returns))
        downside = per_bar * math.sqrt(PERIODS_PER_YEAR)
        if per_bar == 0:
            reasons["sortino_ratio"] = (
                "No bar returned less than the risk-free rate, so the ratio is not defined."
            )
        else:
            sortino = _mean(excess) / per_bar * math.sqrt(PERIODS_PER_YEAR)

    if positive:
        max_drawdown = calculate_max_drawdown(curve)
        duration = calculate_max_drawdown_duration(curve)
    else:
        max_drawdown = None
        duration = None
        reasons["max_drawdown"] = "Not defined once the equity reaches zero or below."
        reasons["max_drawdown_duration_bars"] = reasons["max_drawdown"]

    calmar = None
    if cagr is None:
        reasons["calmar_ratio"] = "Needs CAGR."
    elif not max_drawdown:
        reasons["calmar_ratio"] = (
            "There was no drawdown, so the ratio is not defined."
            if max_drawdown == 0
            else "Needs the maximum drawdown."
        )
    else:
        calmar = cagr / max_drawdown

    return (
        {
            "cagr": _finite(cagr),
            "annualized_volatility": _finite(volatility),
            "downside_deviation": _finite(downside),
            "sharpe_ratio": _finite(sharpe),
            "sortino_ratio": _finite(sortino),
            "calmar_ratio": _finite(calmar),
            "max_drawdown": max_drawdown,
            "max_drawdown_duration_bars": duration,
        },
        reasons,
    )


def drawdown_points(curve: list[dict]) -> tuple[list[dict], str | None, str | None]:
    """Drawdown at every bar (0 or negative), and the peak and trough of the largest one."""
    points = []
    peak = None
    peak_at = None
    worst = 0.0
    worst_peak_at = None
    worst_trough_at = None
    for point in curve:
        value = point["portfolio_value"]
        if peak is None or value >= peak:
            peak, peak_at = value, point["timestamp"]
        drawdown = value / peak - 1 if peak > 0 else 0.0
        if drawdown < worst:
            worst, worst_peak_at, worst_trough_at = drawdown, peak_at, point["timestamp"]
        points.append({"timestamp": point["timestamp"], "drawdown": drawdown})
    return points, worst_peak_at, worst_trough_at


def monthly_returns(curve: list[dict], initial_capital: float) -> list[dict]:
    """Return of each calendar month (IST), from the last value of the month before
    (the initial capital for the first month)."""
    month_end: OrderedDict[str, float] = OrderedDict()
    for point in curve:
        month = _ts(point["timestamp"]).astimezone(IST).strftime("%Y-%m")
        month_end[month] = point["portfolio_value"]
    rows = []
    previous = initial_capital
    for month, value in month_end.items():
        rows.append({"month": month, "value": value / previous - 1 if previous > 0 else None})
        previous = value
    return rows


def replay_fills(trades: list[dict], initial_capital: float):
    """Replay the stored fills through the engine's Portfolio: realized P&L per fill,
    and the cash and positions held at the end."""
    portfolio = Portfolio(initial_capital=initial_capital)
    fills = []
    for trade in trades:
        quantity = int(round(trade["quantity"]))
        result = portfolio.apply_trade_with_result(
            instrument_id=trade["instrument_id"],
            side=trade["side"],
            quantity=quantity,
            price=trade["price"],
            fees=trade["total_charges"],
        )
        fills.append(
            {
                "timestamp": trade["timestamp"],
                "instrument_id": trade["instrument_id"],
                "side": trade["side"],
                "quantity": quantity,
                "price": trade["price"],
                "brokerage": trade["brokerage"],
                "total_charges": trade["total_charges"],
                "realized_pnl": result.realized_pnl,
                "closed_quantity": result.closed_quantity,
                "opened_quantity": result.opened_quantity,
            }
        )
    return fills, portfolio


def round_trips(
    fills: list[dict],
    last_prices: dict[str, float | None],
    open_average_prices: dict[str, float],
) -> list[dict]:
    """Group fills into positions from open to flat (long or short), with average
    entry and exit prices. A position still open at the end is listed as open and
    valued at the last close, against the engine's average price."""
    open_positions: dict[str, dict] = {}
    done: list[dict] = []

    def close(position: dict, exit_at: str | None, open_end: bool):
        quantity = position["quantity"]
        entry_price = position["entry_value"] / quantity
        charges = position["entry_charges"] + position["exit_charges"]
        if open_end:
            last = last_prices.get(position["instrument_id"])
            remaining = position["remaining"]
            if last is None:
                gross = None
            else:
                sign = 1 if position["direction"] == "LONG" else -1
                average = open_average_prices.get(position["instrument_id"], position["avg_price"])
                gross = position["gross_pnl"] + sign * remaining * (last - average)
            exit_price = None
        else:
            gross = position["gross_pnl"]
            exit_price = position["exit_value"] / quantity
        net = gross - charges if gross is not None else None
        done.append(
            {
                "instrument_id": position["instrument_id"],
                "direction": position["direction"],
                "quantity": quantity,
                "entry_timestamp": position["entry_timestamp"],
                "entry_price": entry_price,
                "exit_timestamp": exit_at,
                "exit_price": exit_price,
                "gross_pnl": gross,
                "charges": charges,
                "net_pnl": net,
                "return": net / position["entry_value"] if net is not None else None,
                "is_open": open_end,
            }
        )

    for fill in fills:
        key = fill["instrument_id"]
        quantity = fill["quantity"]
        closed = fill["closed_quantity"]
        opened = fill["opened_quantity"]
        fees = fill["total_charges"]
        if closed:
            position = open_positions[key]
            position["exit_value"] += closed * fill["price"]
            position["exit_charges"] += fees * closed / quantity
            position["gross_pnl"] += fill["realized_pnl"]
            position["remaining"] -= closed
            if position["remaining"] == 0:
                close(position, fill["timestamp"], open_end=False)
                del open_positions[key]
        if opened:
            position = open_positions.get(key)
            if position is None:
                position = open_positions[key] = {
                    "instrument_id": key,
                    "direction": "LONG" if fill["side"] == "BUY" else "SHORT",
                    "quantity": 0,
                    "remaining": 0,
                    "entry_value": 0.0,
                    "entry_charges": 0.0,
                    "exit_value": 0.0,
                    "exit_charges": 0.0,
                    "gross_pnl": 0.0,
                    "entry_timestamp": fill["timestamp"],
                    "avg_price": 0.0,
                }
            position["entry_value"] += opened * fill["price"]
            position["entry_charges"] += fees * opened / quantity
            position["quantity"] += opened
            position["remaining"] += opened
            position["avg_price"] = position["entry_value"] / position["quantity"]

    for position in open_positions.values():
        close(position, None, open_end=True)
    return done


def trade_statistics(trips: list[dict], fills: list[dict]) -> tuple[dict, dict]:
    reasons: dict[str, str] = {}
    closed = [t for t in trips if not t["is_open"]]
    wins = [t["net_pnl"] for t in closed if t["net_pnl"] > 0]
    losses = [t["net_pnl"] for t in closed if t["net_pnl"] < 0]
    stats = {
        "fill_count": len(fills),
        "round_trip_count": len(closed),
        "open_position_count": len(trips) - len(closed),
        "winning_trades": len(wins),
        "losing_trades": len(losses),
        "win_rate": len(wins) / len(closed) if closed else None,
        "average_gain": _mean(wins) if wins else None,
        "average_loss": _mean(losses) if losses else None,
        "profit_factor": sum(wins) / abs(sum(losses)) if losses else None,
        "total_charges": sum(f["total_charges"] for f in fills),
        "total_brokerage": sum(f["brokerage"] for f in fills),
    }
    no_closed = "No trade was closed." if fills else "The strategy made no trades."
    if not closed:
        reasons["win_rate"] = no_closed
    if not wins:
        reasons["average_gain"] = no_closed if not closed else "No closed trade made a profit."
    if not losses:
        reasons["average_loss"] = no_closed if not closed else "No closed trade made a loss."
        reasons["profit_factor"] = (
            no_closed if not closed else "No closed trade made a loss, so the ratio is not defined."
        )
    return stats, reasons


def buy_and_hold(
    curve: list[dict], closes: dict[str, float], initial_capital: float, instrument_id: str
) -> tuple[dict | None, str | None]:
    """Initial capital invested in the first instrument at the first bar's close
    and held (fractional units, no costs)."""
    prices = [closes.get(point["timestamp"]) for point in curve]
    if not prices or any(p is None or p <= 0 for p in prices):
        return None, "Stored prices are missing for some bars of this run."
    first = prices[0]
    points = [
        {"timestamp": point["timestamp"], "portfolio_value": initial_capital * price / first}
        for point, price in zip(curve, prices)
    ]
    return (
        {
            "kind": "buy_and_hold",
            "instrument_id": instrument_id,
            "equity_curve": points,
            "total_return": points[-1]["portfolio_value"] / initial_capital - 1,
        },
        None,
    )


def build_results(
    *,
    canonical: dict,
    initial_capital: float,
    closes_by_instrument: dict[str, dict[str, float]],
) -> dict:
    """The analytics part of GET /executions/{id}/results."""
    curve = canonical["equity_curve"]
    trades = canonical["trades"]
    values = [p["portfolio_value"] for p in curve]
    final_capital = values[-1]
    start, end = _ts(curve[0]["timestamp"]), _ts(curve[-1]["timestamp"])
    instrument_ids = canonical["metadata"].get("instrument_ids") or []

    risk, reasons = risk_metrics(
        initial_capital=initial_capital,
        final_capital=final_capital,
        values=values,
        start=start,
        end=end,
    )
    drawdowns, dd_peak, dd_trough = drawdown_points(curve)

    fills, portfolio = replay_fills(trades, initial_capital)
    last_ts = curve[-1]["timestamp"]
    last_prices = {
        iid: closes_by_instrument.get(iid, {}).get(last_ts) for iid in instrument_ids
    }
    trips = round_trips(
        fills,
        last_prices,
        {iid: p["average_price"] for iid, p in portfolio.positions.items()},
    )
    stats, trade_reasons = trade_statistics(trips, fills)
    reasons.update(trade_reasons)

    positions = []
    for iid, position in portfolio.positions.items():
        last = last_prices.get(iid)
        quantity = position["quantity"]
        positions.append(
            {
                "instrument_id": iid,
                "direction": "LONG" if quantity > 0 else "SHORT",
                "quantity": abs(quantity),
                "average_price": position["average_price"],
                "last_price": last,
                "market_value": quantity * last if last is not None else None,
                "unrealized_pnl": quantity * (last - position["average_price"])
                if last is not None
                else None,
            }
        )

    benchmark, benchmark_reason = (None, "The run has no instrument.")
    if instrument_ids:
        benchmark, benchmark_reason = buy_and_hold(
            curve, closes_by_instrument.get(instrument_ids[0], {}), initial_capital, instrument_ids[0]
        )

    orders = [
        {
            "timestamp": f["timestamp"],
            "instrument_id": f["instrument_id"],
            "side": f["side"],
            "order_type": "MARKET",
            "quantity": f["quantity"],
            "status": "FILLED",
            "reference_price": closes_by_instrument.get(f["instrument_id"], {}).get(f["timestamp"]),
            "fill_price": f["price"],
        }
        for f in fills
    ]

    return {
        "summary": {
            "initial_capital": initial_capital,
            "final_capital": final_capital,
            "net_profit": final_capital - initial_capital,
            "total_return": final_capital / initial_capital - 1,
            **risk,
            "max_drawdown_peak_at": dd_peak,
            "max_drawdown_trough_at": dd_trough,
            "bar_count": len(curve),
            "first_bar_at": curve[0]["timestamp"],
            "last_bar_at": last_ts,
        },
        "trade_stats": stats,
        "null_reasons": reasons,
        "equity_curve": [
            {"timestamp": p["timestamp"], "portfolio_value": p["portfolio_value"], "drawdown": d["drawdown"]}
            for p, d in zip(curve, drawdowns)
        ],
        "benchmark": benchmark,
        "benchmark_unavailable_reason": benchmark_reason,
        "monthly_returns": monthly_returns(curve, initial_capital),
        "round_trips": trips,
        "records": {
            "orders": orders,
            "fills": fills,
            "positions": positions,
            "ending_cash": portfolio.cash,
        },
    }
