"""The validation pipeline (Phase 11), on data already loaded.

Stages, as in the synopsis:
1. Historical backtest over the whole range.
2. Walk-forward: rolling train / validation / test windows. Parameters (from an
   optional grid) are chosen on each validation span and tested, unchanged, on
   the next test span. Earlier bars are warm-up only (BacktestEngine trade_from).
3. Regime stress: the stage-1 backtest's daily returns split by rule-based
   market regime (bull/bear x low/high volatility), or (Feature 3) by the
   regime the market regime model classified on each day.
4. Monte Carlo: bootstrap of the stage-1 daily returns, and a sign-flip
   permutation test of the mean daily return.
5. Paper trading: not run here. A deployment on the paper account (Feature 1)
   writes it into the stored report when stages 1-4 have passed.

Every stage runs (a failed stage does not stop the next ones); the overall
verdict passes if stages 1-4 pass, and is VALIDATED once stage 5 passes too. Every number is computed here and
stored; the page only shows it. Nothing here touches the database.
"""

from __future__ import annotations

import itertools
import math
import statistics
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import pandas as pd

from app.backtesting.analytics import calculate_periodic_returns
from app.backtesting.broker import SimulatedBroker
from app.backtesting.engine import BacktestEngine
from app.backtesting.monte_carlo import MonteCarloSimulator
from app.backtesting.results import BacktestResult
from app.backtesting.walk_forward import (
    WalkForwardAnalyzer,
    WalkForwardResult,
    summarize_walk_forward,
)
from app.services.backtesting.results_analytics import (
    IST,
    PERIODS_PER_YEAR,
    _bar_returns,
    risk_metrics,
)
from app.strategies.factory import build_strategy
from app.validation import thresholds as T
from app.validation.regimes import REGIMES, label_regimes, regime_periods

# 1.1: stage 5 (paper trading) can run and counts in the verdict.
VALIDATION_VERSION = "1.1"
HISTOGRAM_BINS = 30
MAX_GRID_COMBINATIONS = 25

STAGES = ["backtest", "walk_forward", "regime_stress", "monte_carlo", "paper_trading"]
STAGE_NAMES = {
    "backtest": "Historical backtest",
    "walk_forward": "Walk-forward",
    "regime_stress": "Regime stress",
    "monte_carlo": "Monte Carlo and significance",
    "paper_trading": "Paper trading",
}

BASIS = [
    "Metrics use daily bars, annualised with 252 bars a year; the Sharpe ratio uses a "
    "6.5% a year risk-free rate (as on the results page).",
    "Walk-forward: each window starts flat with the initial capital; the bars before "
    "a span are warm-up only (they feed indicators, nothing is traded on them).",
    "Walk-forward retention = mean out-of-sample annualised mean daily return / mean "
    "in-sample (validation span) annualised mean daily return, over all windows.",
    "Regime stress splits the stage-1 backtest by day: each regime's return, "
    "volatility and drawdown come from the daily returns on its days only.",
    "Monte Carlo resamples the stage-1 daily returns with replacement; the "
    "significance test flips the signs of the daily returns at random.",
]


@dataclass
class ValidationInputs:
    """What the pipeline runs on (the job builds it from the stored request)."""

    data: pd.DataFrame
    strategy_key: str
    config: dict[str, Any]
    instrument_id: UUID
    initial_capital: float
    quantity: int = 1
    instrument_ids: dict[str, UUID] | None = None
    slippage_bps: float = 0.0
    brokerage_rate: float = 0.0
    train_bars: int = 252
    validation_bars: int = 63
    test_bars: int = 63
    step_bars: int | None = None
    parameter_grid: dict[str, list] = field(default_factory=dict)
    trend_window: int = 200
    volatility_window: int = 20
    # Feature 3: the market regime model's classification of each day (the job
    # loads it); None means the rule-based regimes.
    model_regimes: "ModelRegimes | None" = None
    simulations: int = 1000
    seed: int = 42
    # Feature 6: set for a Python strategy (strategy_key == "python").
    python_code: str | None = None
    sandbox_backend: str = "auto"


def _iso(value: Any) -> str:
    return value.isoformat() if isinstance(value, (datetime, pd.Timestamp)) else str(value)


def _curve(result: BacktestResult) -> list[dict]:
    return [
        {"timestamp": _iso(p["timestamp"]), "portfolio_value": float(p["portfolio_value"])}
        for p in result.equity_curve
    ]


def grid_candidates(grid: dict[str, list]) -> list[dict[str, Any]]:
    """Every combination of the grid's values (one empty candidate without a grid)."""
    if not grid:
        return [{}]
    names = sorted(grid)
    return [dict(zip(names, values)) for values in itertools.product(*(grid[n] for n in names))]


def _strategy_config(inputs: ValidationInputs, candidate: dict) -> dict:
    return {**inputs.config, **candidate}


def _run(inputs: ValidationInputs, config: dict, data: pd.DataFrame, trade_from=None):
    # Feature 6: a Python strategy is built fresh per run (its own sandbox child)
    # and closed after; the config carries the code.
    build_config = config
    if inputs.strategy_key == "python":
        build_config = {"code": inputs.python_code, "params": config, "backend": inputs.sandbox_backend}
    strategy = build_strategy(inputs.strategy_key, build_config)
    try:
        return BacktestEngine().run(
            strategy=strategy,
            data=data,
            execution_id=uuid4(),
            instrument_id=inputs.instrument_id,
            initial_capital=inputs.initial_capital,
            instrument_ids=inputs.instrument_ids,
            broker=SimulatedBroker(
                slippage_bps=inputs.slippage_bps, brokerage_rate=inputs.brokerage_rate
            ),
            quantity=inputs.quantity,
            trade_from=trade_from,
        )
    finally:
        closer = getattr(strategy, "close", None)
        if callable(closer):
            closer()


def span_metrics(result: BacktestResult, initial_capital: float) -> dict[str, Any]:
    """Return and risk of one run (a whole backtest or a walk-forward span)."""
    values = [float(p["portfolio_value"]) for p in result.equity_curve]
    start, end = result.equity_curve[0]["timestamp"], result.equity_curve[-1]["timestamp"]
    risk, reasons = risk_metrics(
        initial_capital=initial_capital,
        final_capital=values[-1],
        values=values,
        start=start,
        end=end,
    )
    returns = _bar_returns(values)
    return {
        "bars": len(values),
        "total_return": float(result.total_return),
        "annualized_mean_return": (
            statistics.fmean(returns) * PERIODS_PER_YEAR if returns else None
        ),
        "sharpe_ratio": risk["sharpe_ratio"],
        "max_drawdown": risk["max_drawdown"],
        "trade_count": len(result.trades),
        "null_reasons": reasons,
    }


def yearly_returns(curve: list[dict], initial_capital: float) -> list[dict]:
    """Return of each calendar year (IST), from the value at the end of the year
    before (the initial capital for the first year)."""
    year_end: dict[int, float] = {}
    for point in curve:
        year = datetime.fromisoformat(point["timestamp"]).astimezone(IST).year
        year_end[year] = point["portfolio_value"]
    rows, previous = [], initial_capital
    for year, value in year_end.items():
        rows.append({"year": year, "return": value / previous - 1})
        previous = value
    return rows


def _stage(key: str, status: str, **fields) -> dict[str, Any]:
    return {
        "key": key,
        "name": STAGE_NAMES[key],
        "status": status,
        "checks": [],
        "reason": None,
        "error": None,
        **fields,
    }


def _verdict(stage: dict) -> dict:
    stage["status"] = "PASS" if all(c["passed"] for c in stage["checks"]) else "FAIL"
    failed = [c["label"] for c in stage["checks"] if not c["passed"]]
    stage["reason"] = (
        "Every check passed." if not failed else "Failed: " + "; ".join(failed) + "."
    )
    return stage


# --- stage 1 -----------------------------------------------------------------------


def backtest_stage(inputs: ValidationInputs) -> tuple[dict, BacktestResult]:
    result = _run(inputs, inputs.config, inputs.data)
    curve = _curve(result)
    metrics = span_metrics(result, inputs.initial_capital)
    values = [p["portfolio_value"] for p in curve]
    risk, reasons = risk_metrics(
        initial_capital=inputs.initial_capital,
        final_capital=values[-1],
        values=values,
        start=result.equity_curve[0]["timestamp"],
        end=result.equity_curve[-1]["timestamp"],
    )
    years = yearly_returns(curve, inputs.initial_capital)
    positive_share = sum(1 for y in years if y["return"] > 0) / len(years)

    stage = _stage(
        "backtest",
        "RUNNING",
        metrics={
            "initial_capital": inputs.initial_capital,
            "final_capital": values[-1],
            "total_return": float(result.total_return),
            "cagr": risk["cagr"],
            "sharpe_ratio": risk["sharpe_ratio"],
            "sortino_ratio": risk["sortino_ratio"],
            "annualized_volatility": risk["annualized_volatility"],
            "max_drawdown": risk["max_drawdown"],
            "trade_count": len(result.trades),
            "bars": len(curve),
            "positive_year_share": positive_share,
        },
        null_reasons=reasons,
        yearly_returns=years,
        equity_curve=curve,
    )
    stage["checks"] = [
        T.check(
            id="sharpe_ratio",
            label="Sharpe ratio",
            op=">",
            threshold=T.BACKTEST_MIN_SHARPE,
            value=risk["sharpe_ratio"],
            unit="ratio",
            explanation="Return over the risk-free rate per unit of volatility, annualised.",
            reason=reasons.get("sharpe_ratio"),
        ),
        T.check(
            id="max_drawdown",
            label="Maximum drawdown",
            op="<",
            threshold=T.BACKTEST_MAX_DRAWDOWN,
            value=risk["max_drawdown"],
            unit="fraction",
            explanation="Largest fall of the equity from a previous peak.",
            reason=reasons.get("max_drawdown"),
        ),
        T.check(
            id="positive_year_share",
            label="Share of calendar years with a positive return",
            op=">=",
            threshold=T.BACKTEST_MIN_POSITIVE_YEAR_SHARE,
            value=positive_share,
            unit="fraction",
            explanation=(
                f"{sum(1 for y in years if y['return'] > 0)} of {len(years)} calendar "
                "years (IST) ended above the year before; partial first and last years count."
            ),
        ),
    ]
    return _verdict(stage), result


# --- stage 2 -----------------------------------------------------------------------


def walk_forward_stage(inputs: ValidationInputs) -> dict:
    step = inputs.step_bars or inputs.test_bars
    analyzer = WalkForwardAnalyzer(
        train_size=inputs.train_bars,
        validation_size=inputs.validation_bars,
        test_size=inputs.test_bars,
        step_size=step,
    )
    data = inputs.data
    windows = analyzer.generate_windows(data.index)
    candidates = grid_candidates(inputs.parameter_grid)

    rows: list[dict] = []
    summary_inputs: list[WalkForwardResult] = []
    for number, window in enumerate(windows, start=1):
        start = window.train[0]
        validation_data = data.loc[start : window.validation[-1]]
        test_data = data.loc[start : window.test[-1]]

        best = None
        for candidate in candidates:
            config = _strategy_config(inputs, candidate)
            result = _run(inputs, config, validation_data, trade_from=window.validation[0])
            if best is None or result.total_return > best[2].total_return:
                best = (candidate, config, result)
        candidate, config, in_sample_result = best
        out_of_sample_result = _run(inputs, config, test_data, trade_from=window.test[0])

        in_sample = span_metrics(in_sample_result, inputs.initial_capital)
        out_of_sample = span_metrics(out_of_sample_result, inputs.initial_capital)
        retention, retention_reason = None, None
        is_mean, oos_mean = in_sample["annualized_mean_return"], out_of_sample["annualized_mean_return"]
        if is_mean is None or oos_mean is None:
            retention_reason = "A span has fewer than two bars."
        elif is_mean <= 0:
            retention_reason = "The in-sample return was not positive, so there is nothing to retain."
        else:
            retention = oos_mean / is_mean

        rows.append(
            {
                "index": number,
                "train_start": _iso(window.train[0]),
                "train_end": _iso(window.train[-1]),
                "validation_start": _iso(window.validation[0]),
                "validation_end": _iso(window.validation[-1]),
                "test_start": _iso(window.test[0]),
                "test_end": _iso(window.test[-1]),
                "train_bars": len(window.train),
                "validation_bars": len(window.validation),
                "test_bars": len(window.test),
                "parameters": candidate,
                "candidates_tested": len(candidates),
                "in_sample": in_sample,
                "out_of_sample": out_of_sample,
                "retention": retention,
                "retention_reason": retention_reason,
            }
        )
        summary_inputs.append(
            WalkForwardResult(
                window=window,
                parameters=candidate,
                validation_score=float(in_sample_result.total_return),
                test_result={"return": float(out_of_sample_result.total_return)},
            )
        )

    stage = _stage(
        "walk_forward",
        "RUNNING",
        settings={
            "train_bars": inputs.train_bars,
            "validation_bars": inputs.validation_bars,
            "test_bars": inputs.test_bars,
            "step_bars": step,
            "parameter_grid": inputs.parameter_grid,
            "candidates": len(candidates),
            "selection": (
                "The candidate with the highest total return on the validation span."
                if len(candidates) > 1
                else "No parameter search: the strategy's own parameters on every window."
            ),
        },
        windows=rows,
        summary=None,
    )

    retention_value, retention_reason = None, None
    if rows:
        is_values = [r["in_sample"]["annualized_mean_return"] for r in rows]
        oos_values = [r["out_of_sample"]["annualized_mean_return"] for r in rows]
        mean_is = statistics.fmean(v for v in is_values if v is not None) if any(
            v is not None for v in is_values
        ) else None
        mean_oos = statistics.fmean(v for v in oos_values if v is not None) if any(
            v is not None for v in oos_values
        ) else None
        if mean_is is None or mean_oos is None:
            retention_reason = "The spans are too short to measure returns."
        elif mean_is <= 0:
            retention_reason = (
                "The mean in-sample return was not positive, so there is nothing to retain."
            )
        else:
            retention_value = mean_oos / mean_is

        sharpes_is = [r["in_sample"]["sharpe_ratio"] for r in rows if r["in_sample"]["sharpe_ratio"] is not None]
        sharpes_oos = [
            r["out_of_sample"]["sharpe_ratio"] for r in rows if r["out_of_sample"]["sharpe_ratio"] is not None
        ]
        summary = summarize_walk_forward(summary_inputs)
        stage["summary"] = {
            "window_count": len(rows),
            "mean_in_sample_return": mean_is,
            "mean_out_of_sample_return": mean_oos,
            "retention": retention_value,
            "retention_reason": retention_reason,
            "mean_in_sample_sharpe": statistics.fmean(sharpes_is) if sharpes_is else None,
            "mean_out_of_sample_sharpe": statistics.fmean(sharpes_oos) if sharpes_oos else None,
            "mean_test_return": summary.mean_test_return,
            "median_test_return": summary.median_test_return,
            "test_return_std": summary.test_return_std,
            "positive_test_window_rate": summary.positive_test_window_rate,
            "parameter_stability": [
                {
                    "choice": key,
                    "windows": count,
                    "share": summary.parameter_stability_rate[key],
                }
                for key, count in sorted(
                    summary.parameter_stability.items(), key=lambda item: (-item[1], item[0])
                )
            ],
        }
    else:
        retention_reason = "No walk-forward window fits in the data."

    stage["checks"] = [
        T.check(
            id="window_count",
            label="Walk-forward windows",
            op=">=",
            threshold=T.WALK_FORWARD_MIN_WINDOWS,
            value=len(rows),
            unit="count",
            explanation="Out-of-sample periods tested, one per window.",
        ),
        T.check(
            id="retention",
            label="Out-of-sample retention of in-sample return",
            op=">=",
            threshold=T.WALK_FORWARD_MIN_RETENTION,
            value=retention_value,
            unit="fraction",
            explanation=(
                "Mean out-of-sample annualised return as a share of the mean in-sample "
                "(validation span) annualised return."
            ),
            reason=retention_reason,
        ),
    ]
    return _verdict(stage)


# --- stage 3 -----------------------------------------------------------------------


def _max_drawdown(returns: list[float]) -> float:
    value, peak, worst = 1.0, 1.0, 0.0
    for r in returns:
        value *= 1 + r
        peak = max(peak, value)
        worst = max(worst, 1 - value / peak)
    return worst


def regime_stress_stage(inputs: ValidationInputs, backtest: BacktestResult) -> dict:
    if inputs.model_regimes is not None:
        return model_regime_stage(inputs, backtest)
    labels, method = label_regimes(
        inputs.data["close"],
        trend_window=inputs.trend_window,
        volatility_window=inputs.volatility_window,
    )
    curve = backtest.equity_curve
    by_regime: dict[str, list[float]] = {key: [] for key in REGIMES}
    previous = inputs.initial_capital
    label_at: dict[str, str | None] = {}
    for point in curve:
        stamp = pd.Timestamp(point["timestamp"])
        label = labels.get(stamp)
        label_at[_iso(point["timestamp"])] = label
        value = float(point["portfolio_value"])
        if label is not None and previous > 0:
            by_regime[label].append(value / previous - 1)
        previous = value

    trades_by_regime = {key: 0 for key in REGIMES}
    for trade in backtest.trades:
        label = label_at.get(_iso(trade["timestamp"]))
        if label is not None:
            trades_by_regime[label] += 1

    labelled_days = sum(len(v) for v in by_regime.values())
    rows = []
    for key, name in REGIMES.items():
        returns = by_regime[key]
        days = len(returns)
        rows.append(
            {
                "key": key,
                "name": name,
                "days": days,
                "share": days / labelled_days if labelled_days else 0.0,
                "total_return": (math.prod(1 + r for r in returns) - 1) if days else None,
                "annualized_mean_return": (
                    statistics.fmean(returns) * PERIODS_PER_YEAR if days else None
                ),
                "annualized_volatility": (
                    statistics.stdev(returns) * math.sqrt(PERIODS_PER_YEAR) if days > 1 else None
                ),
                "max_drawdown": _max_drawdown(returns) if days else None,
                "trade_count": trades_by_regime[key],
            }
        )

    observed = [r for r in rows if r["days"] > 0]
    worst = max((r["max_drawdown"] for r in observed), default=None)
    worst_row = max(observed, key=lambda r: r["max_drawdown"], default=None)
    stage = _stage(
        "regime_stress",
        "RUNNING",
        method=method,
        regimes=rows,
        periods=regime_periods(labels),
        labelled_days=labelled_days,
    )
    stage["checks"] = [
        T.check(
            id="max_regime_drawdown",
            label="Worst maximum drawdown in any regime",
            op="<=",
            threshold=T.REGIME_MAX_DRAWDOWN,
            value=worst,
            unit="fraction",
            explanation=(
                f"Worst regime: {worst_row['name']}." if worst_row else "No regime was observed."
            ),
            reason=None if worst is not None else "No day had a regime (all warm-up).",
        )
    ]
    return _verdict(stage)


# --- stage 3 with the market regime model (Feature 3) -------------------------------


@dataclass
class ModelRegimes:
    """The market regime model's classification of its reference instrument's days.

    model: what the report records (id, number, kind, version, training period, ...).
    labels: the model's regimes (clusters, or supervised combined regimes) by id.
    days: IST date -> {"regime_id": int, "dimensions": {key: class} | None}, only
      for days the model classified (features complete).
    reference_days: every IST date with a stored bar of the reference instrument.
    dimensions: supervised models: [{"key", "name", "classes"}]; None for a GMM.
    """

    model: dict[str, Any]
    labels: list[dict[str, Any]]
    days: dict[Any, dict[str, Any]]
    reference_days: set
    dimensions: list[dict[str, Any]] | None = None
    error: str | None = None


UNCLASSIFIED = "unclassified"
UNCLASSIFIED_REASONS = {
    "warm_up": "Before the model's features are complete on the reference instrument (warm-up).",
    "no_reference_bar": "The reference instrument has no stored bar on that day.",
}


def _ist_day(timestamp) -> Any:
    stamp = pd.Timestamp(timestamp)
    if stamp.tzinfo is None:
        stamp = stamp.tz_localize("UTC")
    return stamp.tz_convert(IST).date()


def _regime_row(key: str, name: str, returns: list[float], trades: int, labelled: int) -> dict:
    days = len(returns)
    return {
        "key": key,
        "name": name,
        "days": days,
        "share": days / labelled if labelled else 0.0,
        "total_return": (math.prod(1 + r for r in returns) - 1) if days else None,
        "annualized_mean_return": statistics.fmean(returns) * PERIODS_PER_YEAR if days else None,
        "annualized_volatility": (
            statistics.stdev(returns) * math.sqrt(PERIODS_PER_YEAR) if days > 1 else None
        ),
        "max_drawdown": _max_drawdown(returns) if days else None,
        "trade_count": trades,
        "judged": days >= T.REGIME_MIN_DAYS,
    }


def _periods(keys: list[tuple[str, str]]) -> list[dict]:
    periods: list[dict] = []
    for stamp, key in keys:
        if periods and periods[-1]["regime"] == key:
            periods[-1]["end"] = stamp
            periods[-1]["bars"] += 1
        else:
            periods.append({"regime": key, "start": stamp, "end": stamp, "bars": 1})
    return periods


def model_regime_stage(inputs: ValidationInputs, backtest: BacktestResult) -> dict:
    """Stage 3 split by the market regime model's classification of each day.

    Each backtest day takes the model's regime of the same IST date on its
    reference instrument (the same classification as GET /regime/history: features
    use only that day and earlier). Days without one are unclassified and listed.
    """
    m = inputs.model_regimes
    if m.error:
        raise ValueError(m.error)
    labels = {row["regime_id"]: row for row in m.labels}
    supervised = m.dimensions is not None
    regime_returns: dict[int, list[float]] = {rid: [] for rid in labels}
    regime_trades: dict[int, int] = {rid: 0 for rid in labels}
    dim_returns = {d["key"]: {c: [] for c in d["classes"]} for d in (m.dimensions or [])}
    dim_trades = {d["key"]: {c: 0 for c in d["classes"]} for d in (m.dimensions or [])}

    day_info: dict[str, dict | None] = {}
    unclassified = {"warm_up": 0, "no_reference_bar": 0}
    timeline: list[tuple[str, str]] = []
    dim_timeline: dict[str, list[tuple[str, str]]] = {d["key"]: [] for d in (m.dimensions or [])}
    previous = inputs.initial_capital
    for point in backtest.equity_curve:
        stamp = _iso(point["timestamp"])
        day = _ist_day(point["timestamp"])
        info = m.days.get(day)
        day_info[stamp] = info
        value = float(point["portfolio_value"])
        daily = value / previous - 1 if previous > 0 else None
        previous = value
        if info is None:
            reason = "warm_up" if day in m.reference_days else "no_reference_bar"
            unclassified[reason] += 1
            timeline.append((stamp, UNCLASSIFIED))
            for key in dim_timeline:
                dim_timeline[key].append((stamp, UNCLASSIFIED))
            continue
        timeline.append((stamp, labels[info["regime_id"]]["code"]))
        if daily is not None:
            regime_returns[info["regime_id"]].append(daily)
        for key, label in (info.get("dimensions") or {}).items():
            dim_timeline[key].append((stamp, label))
            if daily is not None:
                dim_returns[key][label].append(daily)

    for trade in backtest.trades:
        info = day_info.get(_iso(trade["timestamp"]))
        if info is None:
            continue
        regime_trades[info["regime_id"]] += 1
        for key, label in (info.get("dimensions") or {}).items():
            dim_trades[key][label] += 1

    labelled = sum(len(v) for v in regime_returns.values())
    ordered = sorted(m.labels, key=lambda r: (r["code"] if not supervised else r["regime_id"]))
    rows = [
        {
            **_regime_row(r["code"], r["name"], regime_returns[r["regime_id"]], regime_trades[r["regime_id"]], labelled),
            "code": r["code"],
        }
        for r in ordered
    ]
    if supervised:
        # A supervised model is judged per dimension; its combined regimes are shown only.
        for row in rows:
            row["judged"] = None
    dimension_rows = (
        [
            {
                "key": d["key"],
                "name": d["name"],
                "rows": [
                    {**_regime_row(c, c, dim_returns[d["key"]][c], dim_trades[d["key"]][c], labelled), "code": None}
                    for c in d["classes"]
                ],
                "periods": _periods(dim_timeline[d["key"]]),
            }
            for d in m.dimensions
        ]
        if supervised
        else None
    )

    # Judged rows: a Gaussian mixture's regimes; a supervised model's dimension classes.
    judged_pool = (
        [row for d in dimension_rows for row in d["rows"]] if supervised else rows
    )
    judged = [r for r in judged_pool if r["judged"]]
    insufficient = [r for r in judged_pool if 0 < r["days"] < T.REGIME_MIN_DAYS]
    worst_row = max(judged, key=lambda r: r["max_drawdown"], default=None)
    worst = worst_row["max_drawdown"] if worst_row else None

    days_total = len(backtest.equity_curve)
    start = m.model.get("training_start")
    end = m.model.get("in_sample_end") or m.model.get("training_end")
    in_sample_days = 0
    if start and end:
        first, last = _ist_day(start), _ist_day(end)
        in_sample_days = sum(
            1 for stamp, info in day_info.items() if info is not None and first <= _ist_day(stamp) <= last
        )
    model = m.model
    method_text = (
        f"Each day takes the regime that {model['name']} ({model['kind_name']}) classified on "
        f"{model.get('instrument_symbol') or 'its reference instrument'} that day, from features "
        "that use only that day and earlier (as on the Market Regime page). "
        + (
            f"A supervised model's regime of a day is its classification of the next "
            f"{model.get('horizon_days')} trading days, made with what was known that day; "
            "the label's look-ahead is never used. "
            if supervised
            else ""
        )
        + f"A regime with fewer than {T.REGIME_MIN_DAYS} days is not judged."
    )
    stage = _stage(
        "regime_stress",
        "RUNNING",
        method={
            "source": "model",
            "method": method_text,
            "model": model,
            "min_days": T.REGIME_MIN_DAYS,
            "warm_up_bars": unclassified["warm_up"],
        },
        regimes=rows,
        periods=_periods(timeline),
        labelled_days=labelled,
        dimensions=dimension_rows,
        unclassified={
            "days": unclassified["warm_up"] + unclassified["no_reference_bar"],
            "reasons": [
                {"reason": key, "description": UNCLASSIFIED_REASONS[key], "days": count}
                for key, count in unclassified.items()
                if count
            ],
            "periods": [p for p in _periods(timeline) if p["regime"] == UNCLASSIFIED],
        },
        insufficient=[
            {"key": r["key"], "name": r["name"], "days": r["days"]} for r in insufficient
        ],
        in_sample={
            "days": in_sample_days,
            "of_days": days_total,
            "training_start": start,
            "training_end": end,
            "flag": (
                f"Classified in-sample for {in_sample_days} of {days_total} days: those days are "
                "inside the period the model was trained on, so the model had seen them."
                if in_sample_days
                else None
            ),
        },
    )
    if worst is not None:
        explanation = (
            f"Worst: {worst_row['name']}"
            + (
                f" ({next(d['name'] for d in dimension_rows if any(r is worst_row for r in d['rows']))})"
                if supervised
                else ""
            )
            + f". Judged: regimes with at least {T.REGIME_MIN_DAYS} days"
            + (" (each class of each dimension)." if supervised else ".")
        )
        reason = None
    else:
        explanation = f"No regime had at least {T.REGIME_MIN_DAYS} days."
        reason = (
            f"No regime had at least {T.REGIME_MIN_DAYS} classified days, so none could be judged."
        )
    stage["checks"] = [
        T.check(
            id="max_regime_drawdown",
            label="Worst maximum drawdown in any regime",
            op="<=",
            threshold=T.REGIME_MAX_DRAWDOWN,
            value=worst,
            unit="fraction",
            explanation=explanation,
            reason=reason,
        )
    ]
    return _verdict(stage)


# --- stage 4 -----------------------------------------------------------------------


def monte_carlo_stage(inputs: ValidationInputs, backtest: BacktestResult) -> dict:
    simulator = MonteCarloSimulator()
    curve = [{"portfolio_value": float(p["portfolio_value"])} for p in backtest.equity_curve]
    bootstrap = simulator.run(
        equity_curve=curve,
        initial_capital=inputs.initial_capital,
        simulations=inputs.simulations,
        seed=inputs.seed,
        histogram_bins=HISTOGRAM_BINS,
    )
    significance = simulator.test_mean_return_significance(
        daily_returns=calculate_periodic_returns(curve),
        permutations=inputs.simulations,
        seed=inputs.seed,
    )
    stage = _stage(
        "monte_carlo",
        "RUNNING",
        resampled_series="Daily returns of the stage-1 backtest (between consecutive closes).",
        bootstrap=bootstrap,
        significance=significance,
    )
    stage["checks"] = [
        T.check(
            id="p_value",
            label="p-value of the mean-return test",
            op="<",
            threshold=T.SIGNIFICANCE_LEVEL,
            value=significance["p_value"],
            unit="p_value",
            explanation=(
                "Chance of a mean daily return at least this high if the strategy had "
                "no edge (one-sided sign-flip permutation test)."
            ),
        )
    ]
    return _verdict(stage)


# --- the pipeline ------------------------------------------------------------------


def empty_report() -> dict:
    """The report before any stage has run."""
    stages = {key: _stage(key, "NOT_RUN") for key in STAGES}
    stages["paper_trading"].update(reason=PAPER_NOT_STARTED)
    return {
        "version": VALIDATION_VERSION,
        "stages": stages,
        "verdict": {"status": "PENDING", "reason": "The validation has not finished."},
        "thresholds_source": T.SOURCE,
        "basis": BASIS,
    }


PAPER_NOT_STARTED = (
    "Not started. Once stages 1 to 4 pass, it runs the strategy on the paper account "
    "for 30 days."
)


def normalize_paper_stage(report: dict) -> dict:
    """Reports stored before 1.1 have stage 5 as PLANNED; it can now be started."""
    stage = report.get("stages", {}).get("paper_trading")
    if isinstance(stage, dict) and stage.get("status") == "PLANNED":
        stage.update(status="NOT_RUN", reason=PAPER_NOT_STARTED)
        if report.get("verdict", {}).get("status") == "PASS":
            report["verdict"] = overall_verdict(report["stages"])
    return report


def overall_verdict(stages: dict) -> dict:
    statuses = {key: stages[key]["status"] for key in STAGES[:4]}
    if all(s == "PASS" for s in statuses.values()):
        paper = stages.get("paper_trading", {}).get("status")
        if paper == "PASS":
            return {"status": "VALIDATED", "reason": "All five stages passed, including paper trading."}
        if paper == "FAIL":
            return {"status": "FAIL", "reason": "Stages 1 to 4 passed; paper trading (stage 5) failed."}
        if paper == "RUNNING":
            return {"status": "PASS", "reason": "Stages 1 to 4 passed. Paper trading (stage 5) is running."}
        return {
            "status": "PASS",
            "reason": "Stages 1 to 4 passed. Start paper trading (stage 5) to complete the validation.",
        }
    errored = [STAGE_NAMES[k] for k, s in statuses.items() if s in {"ERROR", "NOT_RUN"}]
    failed = [STAGE_NAMES[k] for k, s in statuses.items() if s == "FAIL"]
    if errored:
        return {
            "status": "INCOMPLETE",
            "reason": "Could not finish: " + ", ".join(errored) + "."
            + (" Failed: " + ", ".join(failed) + "." if failed else ""),
        }
    return {"status": "FAIL", "reason": "Failed: " + ", ".join(failed) + "."}


def run_pipeline(
    inputs: ValidationInputs,
    on_progress: Callable[[dict], None] | None = None,
) -> dict:
    """Run stages 1-4 and return the report. on_progress gets the report after
    every change (a stage starting or finishing), so it can be stored."""
    report = empty_report()
    stages = report["stages"]

    def progress():
        if on_progress is not None:
            on_progress(report)

    def run_stage(key: str, work: Callable[[], dict]) -> None:
        stages[key]["status"] = "RUNNING"
        progress()
        try:
            stages[key] = work()
        except Exception as exc:  # the stage failed to run; the others still do
            stages[key] = _stage(key, "ERROR", error=str(exc) or type(exc).__name__)
            stages[key]["reason"] = "The stage could not run."
        progress()

    backtest_holder: dict[str, BacktestResult] = {}

    def stage_one() -> dict:
        stage, result = backtest_stage(inputs)
        backtest_holder["result"] = result
        return stage

    run_stage("backtest", stage_one)
    run_stage("walk_forward", lambda: walk_forward_stage(inputs))

    if "result" in backtest_holder:
        result = backtest_holder["result"]
        run_stage("regime_stress", lambda: regime_stress_stage(inputs, result))
        run_stage("monte_carlo", lambda: monte_carlo_stage(inputs, result))
    else:
        for key in ("regime_stress", "monte_carlo"):
            stages[key]["reason"] = "Needs the historical backtest (stage 1), which could not run."

    report["verdict"] = overall_verdict(stages)
    progress()
    return report
