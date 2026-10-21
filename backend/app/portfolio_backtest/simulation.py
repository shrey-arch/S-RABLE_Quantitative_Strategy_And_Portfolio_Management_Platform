"""Portfolio backtest against Nifty 50 (Feature 4, Objective 6): the simulation.

Sleeve-based method:
1. Each chosen strategy runs as its own backtest over the period (the engine),
   giving a daily value series: its sleeve.
2. On each rebalance date (the first day, then the last trading day of each week
   or month) the target weights come from the existing portfolio logic, with
   only data up to that date:
   - each strategy's composite score from its factors on a trailing window of
     its instrument's closes up to that date;
   - the regime as of that date (the regime model's latest classification on or
     before it), when the regime filter is on: strategies whose rule does not
     suit it are left out;
   - capital split by score (PortfolioAllocationService), then risk-limited
     (PortfolioRiskService). What is not allocated stays in cash (no interest).
3. Between rebalances the sleeve holdings drift with their own daily returns.
   A rebalance trades the difference to the new targets; its cost is the traded
   value x (brokerage rate + slippage), taken from the portfolio before the new
   targets are set.

Benchmarks on the same trading days: Nifty 50 buy-and-hold (a price index:
dividends are not included), an equal-weight portfolio of the same sleeves
(same dates and cost rate, no regime filter or limits), and optionally 60/40
(60% Nifty, 40% a debt leg growing at a constant rate). Nothing here touches the
database; every number is computed here and stored.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from app.services.backtesting.results_analytics import (
    PERIODS_PER_YEAR,
    RISK_FREE_RATE_PER_PERIOD,
    risk_metrics,
)
from app.services.portfolio.allocation_service import PortfolioAllocationService
from app.services.portfolio.risk_service import PortfolioRiskLimits, PortfolioRiskService

IST = ZoneInfo("Asia/Kolkata")
SHARPE_TARGET = 0.30
DRAWDOWN_TARGET = 0.25
DEBT_RATE = 0.065
FREQUENCIES = ("WEEKLY", "MONTHLY")

PRICE_INDEX_NOTE = (
    "Nifty 50 here is the price index: dividends are not included, so the benchmark's "
    "return is understated by its dividend yield."
)
CASH_NOTE = "Capital that is not allocated stays in cash and earns nothing."
DEBT_NOTE = "The 60/40 debt leg grows at a constant {rate:.1%} a year (compounded daily, 252 days)."


@dataclass
class Sleeve:
    """One strategy's backtest over the period, as a daily value series."""

    key: str  # the strategy id
    name: str
    strategy_key: str
    asset: str  # the instrument's trading symbol (the asset limit groups by it)
    values: pd.Series  # IST date -> sleeve value (the backtest's equity)


ScoreResult = tuple[float | None, dict[str, float] | None, str | None]


@dataclass
class SimulationInputs:
    sleeves: list[Sleeve]
    benchmark: pd.Series  # IST date -> Nifty 50 close
    start: date
    end: date
    capital: float
    frequency: str = "WEEKLY"
    # Risk limits as shares of the portfolio's value on each rebalance day.
    cash_reserve: float = 0.0
    max_strategy_weight: float = 1.0
    max_asset_weight: float = 1.0
    brokerage_rate: float = 0.0
    slippage_bps: float = 0.0
    # (sleeve, day) -> (score, factors, reason when not scored); data up to day only.
    score: Callable[[Sleeve, date], ScoreResult] | None = None
    # day -> the regime as of that day (None: none yet); None: the regime filter is off.
    regime_at: Callable[[date], dict | None] | None = None
    # (strategy_key, regime) -> (compatible, reason)
    compatible: Callable[[str, dict], tuple[bool, str]] | None = None
    sixty_forty: bool = False
    debt_rate: float = DEBT_RATE
    trading_day: Callable[[date], bool] | None = None

    @property
    def cost_rate(self) -> float:
        return self.brokerage_rate + self.slippage_bps / 10_000


# --- calendar --------------------------------------------------------------------


def trading_calendar(inputs: SimulationInputs) -> list[date]:
    """The benchmark's days in the period that are NSE trading days."""
    days = [d for d in inputs.benchmark.index if inputs.start <= d <= inputs.end]
    if inputs.trading_day is not None:
        days = [d for d in days if inputs.trading_day(d)]
    return sorted(days)


def rebalance_days(days: list[date], frequency: str) -> list[date]:
    """The first day, then the last trading day of each week (ISO) or month
    (the period's last day is not a rebalance: nothing is held after it)."""
    if frequency not in FREQUENCIES:
        raise ValueError("frequency must be WEEKLY or MONTHLY.")
    if not days:
        return []

    def bucket(d: date):
        return d.isocalendar()[:2] if frequency == "WEEKLY" else (d.year, d.month)

    out = [days[0]]
    for current, following in zip(days, days[1:]):
        if bucket(current) != bucket(following) and current != days[0]:
            out.append(current)
    return out


def align(series: pd.Series, days: list[date]) -> pd.Series:
    """A value series on the calendar; a missing day keeps the last value (a 0
    return), and days before its first value take that first value."""
    s = series.sort_index()
    s = s[~s.index.duplicated(keep="last")]
    aligned = s.reindex(sorted(set(s.index) | set(days))).ffill().reindex(days)
    return aligned.bfill()


# --- weights ---------------------------------------------------------------------


def target_weights(inputs: SimulationInputs, day: date, value: float) -> dict[str, Any]:
    """The portfolio logic on one rebalance day, with data up to that day only."""
    regime = inputs.regime_at(day) if inputs.regime_at is not None else None
    scores: dict[str, float] = {}
    rows = []
    for sleeve in inputs.sleeves:
        score, factors, reason = inputs.score(sleeve, day) if inputs.score else (1.0, None, None)
        row = {"strategy_id": sleeve.key, "name": sleeve.name, "score": score, "factors": factors}
        if score is None:
            row["excluded"] = reason or "Not scored."
        elif inputs.regime_at is not None and regime is not None and inputs.compatible is not None:
            ok, why = inputs.compatible(sleeve.strategy_key, regime)
            row["excluded"] = None if ok else why
        else:
            row["excluded"] = None
        if row["excluded"] is None:
            scores[sleeve.key] = float(score)
        rows.append(row)

    weights = {s.key: 0.0 for s in inputs.sleeves}
    binding: list[dict] = []
    note = None
    capital = Decimal(str(round(value, 2)))
    if not scores:
        note = "No strategy could be allocated on this day: all in cash."
    elif sum(scores.values()) <= 0:
        note = "Every eligible strategy scored 0: all in cash."
    else:
        proposed = PortfolioAllocationService.allocate(capital, scores)
        assets = {s.key: s.asset for s in inputs.sleeves if s.key in scores}
        limits = PortfolioRiskLimits(
            cash_reserve=(capital * Decimal(str(inputs.cash_reserve))).quantize(Decimal("0.01")),
            max_strategy_weight=Decimal(str(inputs.max_strategy_weight)),
            max_asset_weight=Decimal(str(inputs.max_asset_weight)),
        )
        risk = PortfolioRiskService.constrain(
            capital, {p.strategy: p.amount for p in proposed}, limits, strategy_assets=assets
        )
        for item in risk.allocations:
            # Shares of the (cent-rounded) value the limits were applied to.
            weights[item.strategy] = float(item.amount / capital) if capital > 0 else 0.0
        binding = [dict(b) for b in risk.binding_limits]
    return {
        "regime": regime,
        "rows": rows,
        "weights": weights,
        "cash_weight": max(0.0, 1.0 - sum(weights.values())),
        "binding_limits": binding,
        "note": note,
    }


# --- the simulation --------------------------------------------------------------


def _rebalance(holdings: dict, cash: float, weights: dict, rate: float) -> tuple[dict, float, float, float, float]:
    """New holdings and cash at the target weights; returns turnover and cost too.

    traded = sum |w_i * V - h_i|; cost = traded x rate; the targets are set on V - cost.
    """
    value = sum(holdings.values()) + cash
    traded = sum(abs(weights.get(k, 0.0) * value - holdings.get(k, 0.0)) for k in set(holdings) | set(weights))
    cost = traded * rate
    after = value - cost
    new = {k: weights.get(k, 0.0) * after for k in holdings}
    new_cash = after - sum(new.values())
    turnover = traded / value if value > 0 else 0.0
    return new, new_cash, turnover, cost, after


def _run_weights(
    days: list[date],
    returns: dict[str, list[float]],
    capital: float,
    rebalances: set[date],
    weights_on: Callable[[date, float], dict[str, float]],
    rate: float,
) -> tuple[list[float], list[dict]]:
    """A drifting, periodically rebalanced portfolio of return streams."""
    holdings = {k: 0.0 for k in returns}
    cash = capital
    values: list[float] = []
    events: list[dict] = []
    for i, day in enumerate(days):
        if i > 0:
            holdings = {k: h * (1 + returns[k][i]) for k, h in holdings.items()}
        if day in rebalances:
            before = sum(holdings.values()) + cash
            weights = weights_on(day, before)
            holdings, cash, turnover, cost, after = _rebalance(holdings, cash, weights, rate)
            events.append({"day": day, "value_before": before, "turnover": turnover, "cost": cost, "value_after": after})
        values.append(sum(holdings.values()) + cash)
    return values, events


def _returns(values: list[float]) -> list[float]:
    return [0.0] + [b / a - 1 if a > 0 else 0.0 for a, b in zip(values, values[1:])]


def _metrics(values: list[float], days: list[date]) -> tuple[dict, dict]:
    start = datetime.combine(days[0], time(), tzinfo=IST)
    end = datetime.combine(days[-1], time(), tzinfo=IST)
    metrics, reasons = risk_metrics(
        initial_capital=values[0], final_capital=values[-1], values=values, start=start, end=end
    )
    metrics["total_return"] = values[-1] / values[0] - 1 if values[0] > 0 else None
    metrics["final_value"] = values[-1]
    return metrics, reasons


def _drawdowns(values: list[float]) -> list[float]:
    peak = -math.inf
    out = []
    for v in values:
        peak = max(peak, v)
        out.append(v / peak - 1 if peak > 0 else 0.0)
    return out


def relative_metrics(portfolio: list[float], benchmark: list[float]) -> tuple[dict, dict]:
    """Alpha (annualised, Jensen), beta, correlation, tracking error and information
    ratio of the portfolio's daily returns against the benchmark's."""
    rp = _returns(portfolio)[1:]
    rb = _returns(benchmark)[1:]
    reasons: dict[str, str] = {}
    out = {k: None for k in ("alpha", "beta", "correlation", "tracking_error", "information_ratio")}
    if len(rp) < 2:
        for k in out:
            reasons[k] = "Needs at least two daily returns."
        return out, reasons
    n = len(rp)
    mp, mb = sum(rp) / n, sum(rb) / n
    cov = sum((a - mp) * (b - mb) for a, b in zip(rp, rb)) / (n - 1)
    var_b = sum((b - mb) ** 2 for b in rb) / (n - 1)
    var_p = sum((a - mp) ** 2 for a in rp) / (n - 1)
    if var_b > 0:
        beta = cov / var_b
        out["beta"] = beta
        out["alpha"] = ((mp - RISK_FREE_RATE_PER_PERIOD) - beta * (mb - RISK_FREE_RATE_PER_PERIOD)) * PERIODS_PER_YEAR
    else:
        reasons["beta"] = reasons["alpha"] = "The benchmark did not vary."
    if var_b > 0 and var_p > 0:
        out["correlation"] = cov / math.sqrt(var_b * var_p)
    else:
        reasons["correlation"] = "One of the series did not vary."
    active = [a - b for a, b in zip(rp, rb)]
    ma = sum(active) / n
    te_daily = math.sqrt(sum((x - ma) ** 2 for x in active) / (n - 1))
    out["tracking_error"] = te_daily * math.sqrt(PERIODS_PER_YEAR)
    if te_daily > 0:
        out["information_ratio"] = ma * PERIODS_PER_YEAR / out["tracking_error"]
    else:
        reasons["information_ratio"] = "The portfolio tracked the benchmark exactly."
    return out, reasons


def objectives(portfolio: dict, nifty: dict) -> dict:
    """Objective 6 against Nifty 50: Sharpe 30%+ higher, maximum drawdown 25%+ lower."""
    sp, sb = portfolio.get("sharpe_ratio"), nifty.get("sharpe_ratio")
    dp, db = portfolio.get("max_drawdown"), nifty.get("max_drawdown")
    sharpe = {"target": SHARPE_TARGET, "portfolio": sp, "benchmark": sb, "value": None, "met": False, "reason": None}
    if sp is None or sb is None:
        sharpe["reason"] = "A Sharpe ratio is not available."
    elif sb == 0:
        sharpe["reason"] = "Nifty 50's Sharpe ratio is 0, so a relative improvement is not defined."
    else:
        sharpe["value"] = (sp - sb) / abs(sb)
        sharpe["met"] = sharpe["value"] >= SHARPE_TARGET
    drawdown = {"target": DRAWDOWN_TARGET, "portfolio": dp, "benchmark": db, "value": None, "met": False, "reason": None}
    if dp is None or db is None:
        drawdown["reason"] = "A maximum drawdown is not available."
    elif db == 0:
        drawdown["reason"] = "Nifty 50 had no drawdown, so a reduction is not defined."
    else:
        drawdown["value"] = (db - dp) / db
        drawdown["met"] = drawdown["value"] >= DRAWDOWN_TARGET
    return {
        "sharpe_improvement": {
            **sharpe,
            "rule": "(portfolio Sharpe - Nifty 50 Sharpe) / |Nifty 50 Sharpe| >= 30%",
        },
        "drawdown_reduction": {
            **drawdown,
            "rule": "(Nifty 50 max drawdown - portfolio max drawdown) / Nifty 50 max drawdown >= 25%",
        },
    }


def simulate(inputs: SimulationInputs) -> dict:
    """Run the portfolio and its benchmarks; everything the results page shows."""
    if not inputs.sleeves:
        raise ValueError("No strategy can be backtested in the portfolio.")
    days = trading_calendar(inputs)
    if len(days) < 2:
        raise ValueError("Nifty 50 has fewer than two trading days in this period.")
    rebalances = rebalance_days(days, inputs.frequency)
    rebalance_set = set(rebalances)
    bench = align(inputs.benchmark, days)
    sleeve_values = {s.key: align(s.values, days) for s in inputs.sleeves}
    returns = {k: _returns(list(v.to_numpy(dtype=float))) for k, v in sleeve_values.items()}
    rate = inputs.cost_rate

    log: list[dict] = []

    def portfolio_weights(day: date, value: float) -> dict[str, float]:
        decision = target_weights(inputs, day, value)
        log.append({"day": day, **decision})
        return decision["weights"]

    portfolio, events = _run_weights(days, returns, inputs.capital, rebalance_set, portfolio_weights, rate)
    for entry, event in zip(log, events):
        entry.update(
            turnover=event["turnover"],
            cost=event["cost"],
            value_before=event["value_before"],
            value_after=event["value_after"],
        )

    n = len(inputs.sleeves)
    equal, _ = _run_weights(
        days, returns, inputs.capital, rebalance_set, lambda d, v: {s.key: 1.0 / n for s in inputs.sleeves}, rate
    )
    nifty = [inputs.capital * float(c) / float(bench.iloc[0]) for c in bench.to_numpy()]
    series = {"portfolio": portfolio, "nifty": nifty, "equal_weight": equal}
    if inputs.sixty_forty:
        daily_debt = (1 + inputs.debt_rate) ** (1 / PERIODS_PER_YEAR) - 1
        mix = {"nifty": _returns(nifty), "debt": [0.0] + [daily_debt] * (len(days) - 1)}
        series["sixty_forty"], _ = _run_weights(
            days, mix, inputs.capital, rebalance_set, lambda d, v: {"nifty": 0.6, "debt": 0.4}, rate
        )

    metrics = {}
    reasons = {}
    for name, values in series.items():
        metrics[name], reasons[name] = _metrics(values, days)
    relative, relative_reasons = relative_metrics(portfolio, nifty)

    names = {s.key: s.name for s in inputs.sleeves}
    return {
        "days": [d.isoformat() for d in days],
        "series": {name: values for name, values in series.items()},
        "drawdowns": {name: _drawdowns(values) for name, values in series.items()},
        "metrics": metrics,
        "null_reasons": reasons,
        "relative": relative,
        "relative_null_reasons": relative_reasons,
        "objectives": objectives(metrics["portfolio"], metrics["nifty"]),
        "rebalances": [
            {
                "day": e["day"].isoformat(),
                "regime": e["regime"],
                "strategies": [
                    {
                        **{k: v for k, v in row.items() if k != "factors"},
                        "factors": row["factors"],
                        "weight": e["weights"][row["strategy_id"]],
                    }
                    for row in e["rows"]
                ],
                "cash_weight": e["cash_weight"],
                "turnover": e["turnover"],
                "cost": e["cost"],
                "value_before": e["value_before"],
                "value_after": e["value_after"],
                "binding_limits": e["binding_limits"],
                "note": e["note"],
            }
            for e in log
        ],
        "strategy_names": names,
        "rebalance_count": len(rebalances),
    }
