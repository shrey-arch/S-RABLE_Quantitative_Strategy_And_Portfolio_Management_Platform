"""Phase 11: the validation pipeline on synthetic prices (no database)."""

import json
import math
from uuid import uuid4

import numpy as np
import pandas as pd
import pytest

from app.backtesting.engine import BacktestEngine
from app.backtesting.monte_carlo import MonteCarloSimulator
from app.strategies.base import Strategy
from app.strategies.factory import build_strategy
from app.strategies.signal import SignalAction, StrategySignal
from app.validation import pipeline as P
from app.validation import thresholds as T
from app.validation.regimes import REGIMES, label_regimes, regime_periods

INSTRUMENT = uuid4()


def prices(n=700, seed=5, drift=0.0004, vol=0.015, start="2021-01-01"):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(drift, vol, n)))
    index = pd.date_range(start, periods=n, freq="B", tz="UTC")
    return pd.DataFrame(
        {"open": close, "high": close * 1.01, "low": close * 0.99, "close": close, "volume": 1000.0},
        index=index,
    )


def inputs(data=None, **overrides):
    values = dict(
        data=prices() if data is None else data,
        strategy_key="momentum",
        config={"lookback": 20},
        instrument_id=INSTRUMENT,
        initial_capital=100_000.0,
        quantity=50,
        train_bars=120,
        validation_bars=60,
        test_bars=60,
        simulations=300,
        seed=7,
    )
    values.update(overrides)
    return P.ValidationInputs(**values)


# --- the engine's warm-up start ---------------------------------------------------------


class Recorder(Strategy):
    """BUY on every bar; remembers how much history it saw."""

    def __init__(self):
        self.history_lengths = []

    def generate_signal(self, context):
        self.history_lengths.append(len(context.market_data["data"]))
        return StrategySignal(action=SignalAction.BUY, timestamp=context.timestamp)


def test_trade_from_uses_earlier_bars_as_history_only():
    data = prices(30)
    strategy = Recorder()
    result = BacktestEngine().run(
        strategy=strategy,
        data=data,
        execution_id=uuid4(),
        instrument_id=INSTRUMENT,
        initial_capital=10_000.0,
        trade_from=data.index[20],
    )
    # Asked for signals only from bar 21 on, each time with all the bars so far.
    assert strategy.history_lengths == list(range(21, 31))
    assert [p["timestamp"] for p in result.equity_curve] == list(data.index[20:].to_pydatetime())
    assert result.trades[0]["timestamp"] == data.index[20].to_pydatetime()
    assert result.trades[0]["price"] == pytest.approx(data["close"].iloc[20])


def test_without_trade_from_nothing_changes():
    data = prices(60)
    first = BacktestEngine().run(
        strategy=build_strategy("momentum", {"lookback": 5}),
        data=data,
        execution_id=uuid4(),
        instrument_id=INSTRUMENT,
        initial_capital=10_000.0,
    )
    second = BacktestEngine().run(
        strategy=build_strategy("momentum", {"lookback": 5}),
        data=data,
        execution_id=uuid4(),
        instrument_id=INSTRUMENT,
        initial_capital=10_000.0,
        trade_from=data.index[0],
    )
    assert first.equity_curve == second.equity_curve
    assert first.trades == second.trades


def test_trade_from_after_the_data_is_refused():
    data = prices(10)
    with pytest.raises(ValueError, match="trade_from is after the last bar"):
        BacktestEngine().run(
            strategy=Recorder(),
            data=data,
            execution_id=uuid4(),
            instrument_id=INSTRUMENT,
            initial_capital=1000.0,
            trade_from=data.index[-1] + pd.Timedelta(days=1),
        )


# --- rule-based regimes -------------------------------------------------------------


def test_regimes_hand_checked():
    index = pd.date_range("2024-01-01", periods=8, freq="D", tz="UTC")
    close = pd.Series([10, 11, 12, 11, 13, 9, 9.5, 12], index=index, dtype=float)
    labels, method = label_regimes(close, trend_window=3, volatility_window=2)
    average = close.rolling(3).mean()
    volatility = close.pct_change().rolling(2).std() * math.sqrt(252)
    ready = average.notna() & volatility.notna()
    threshold = volatility[ready].median()
    assert method["volatility_threshold"] == pytest.approx(threshold)
    assert method["warm_up_bars"] == 2
    expected = []
    for t in index:
        if not ready[t]:
            expected.append(None)
        else:
            trend = "bull" if close[t] >= average[t] else "bear"
            level = "high" if volatility[t] > threshold else "low"
            expected.append(f"{trend}_{level}_volatility")
    assert labels.tolist() == expected
    assert set(expected[2:]) <= set(REGIMES)
    periods = regime_periods(labels)
    assert periods[0] == {"regime": "warm_up", "start": index[0].isoformat(), "end": index[1].isoformat(), "bars": 2}
    assert sum(p["bars"] for p in periods) == 8


def test_regimes_need_more_bars_than_the_trend_window():
    close = pd.Series(range(1, 11), index=pd.date_range("2024-01-01", periods=10, tz="UTC"), dtype=float)
    with pytest.raises(ValueError, match="needs more than 20 daily bars"):
        label_regimes(close, trend_window=20, volatility_window=5)


# --- the stages -------------------------------------------------------------------------


def test_backtest_stage_matches_a_direct_engine_run_and_applies_the_thresholds():
    run = inputs()
    stage, result = P.backtest_stage(run)
    direct = BacktestEngine().run(
        strategy=build_strategy("momentum", {"lookback": 20}),
        data=run.data,
        execution_id=uuid4(),
        instrument_id=INSTRUMENT,
        initial_capital=100_000.0,
        quantity=50,
    )
    assert [p["portfolio_value"] for p in stage["equity_curve"]] == pytest.approx(
        [p["portfolio_value"] for p in direct.equity_curve]
    )
    assert stage["metrics"]["trade_count"] == len(direct.trades)
    checks = {c["id"]: c for c in stage["checks"]}
    assert checks["sharpe_ratio"]["threshold"] == T.BACKTEST_MIN_SHARPE == 0.5
    assert checks["max_drawdown"]["threshold"] == T.BACKTEST_MAX_DRAWDOWN == 0.30
    assert checks["sharpe_ratio"]["passed"] == (stage["metrics"]["sharpe_ratio"] > 0.5)
    assert checks["max_drawdown"]["passed"] == (stage["metrics"]["max_drawdown"] < 0.30)
    years = stage["yearly_returns"]
    assert [y["year"] for y in years] == [2021, 2022, 2023]
    share = sum(y["return"] > 0 for y in years) / 3
    assert checks["positive_year_share"]["value"] == pytest.approx(share)
    assert stage["status"] == ("PASS" if all(c["passed"] for c in checks.values()) else "FAIL")


def test_walk_forward_windows_choose_on_validation_and_test_out_of_sample():
    grid = {"lookback": [5, 20, 40]}
    run = inputs(parameter_grid=grid, test_bars=60, step_bars=60)
    stage = P.walk_forward_stage(run)
    data = run.data
    windows = stage["windows"]
    assert len(windows) == (700 - 240) // 60 + 1 == 8
    for number, window in enumerate(windows):
        start = number * 60
        assert window["train_start"] == data.index[start].isoformat()
        assert window["validation_start"] == data.index[start + 120].isoformat()
        assert window["test_start"] == data.index[start + 180].isoformat()
        assert window["test_end"] == data.index[start + 239].isoformat()
        assert window["candidates_tested"] == 3

        # The chosen value is the best total return on the validation span...
        validation = data.iloc[start : start + 180]
        scores = {}
        for lookback in grid["lookback"]:
            result = BacktestEngine().run(
                strategy=build_strategy("momentum", {"lookback": lookback}),
                data=validation,
                execution_id=uuid4(),
                instrument_id=INSTRUMENT,
                initial_capital=100_000.0,
                quantity=50,
                trade_from=data.index[start + 120],
            )
            scores[lookback] = result.total_return
        best = max(grid["lookback"], key=lambda k: (scores[k], -grid["lookback"].index(k)))
        assert window["parameters"] == {"lookback": best}
        assert window["in_sample"]["total_return"] == pytest.approx(scores[best])

        # ...and is then tested unchanged on the next span (history before it is warm-up).
        test = BacktestEngine().run(
            strategy=build_strategy("momentum", {"lookback": best}),
            data=data.iloc[start : start + 240],
            execution_id=uuid4(),
            instrument_id=INSTRUMENT,
            initial_capital=100_000.0,
            quantity=50,
            trade_from=data.index[start + 180],
        )
        assert window["out_of_sample"]["total_return"] == pytest.approx(test.total_return)
        assert window["out_of_sample"]["bars"] == 60

    summary = stage["summary"]
    mean_is = np.mean([w["in_sample"]["annualized_mean_return"] for w in windows])
    mean_oos = np.mean([w["out_of_sample"]["annualized_mean_return"] for w in windows])
    assert summary["mean_in_sample_return"] == pytest.approx(mean_is)
    if mean_is > 0:
        assert summary["retention"] == pytest.approx(mean_oos / mean_is)
    assert sum(c["windows"] for c in summary["parameter_stability"]) == 8
    checks = {c["id"]: c for c in stage["checks"]}
    assert checks["window_count"]["value"] == 8 and checks["window_count"]["passed"]
    assert checks["retention"]["threshold"] == 0.8


def test_walk_forward_never_looks_past_a_window():
    """A window's results do not change when later prices change."""
    data = prices()
    changed = data.copy()
    changed.iloc[500:, :4] *= 1.7
    first = P.walk_forward_stage(inputs(data=data))["windows"]
    second = P.walk_forward_stage(inputs(data=changed))["windows"]
    untouched = [w for w in first if pd.Timestamp(w["test_end"]) < data.index[500]]
    assert len(untouched) >= 4
    for a, b in zip(untouched, second):
        assert a == b


def test_too_few_windows_fail_the_stage_with_the_threshold():
    stage = P.walk_forward_stage(inputs(data=prices(420)))
    checks = {c["id"]: c for c in stage["checks"]}
    assert checks["window_count"]["value"] == 4
    assert not checks["window_count"]["passed"]
    assert stage["status"] == "FAIL"
    assert "Walk-forward windows" in stage["reason"]


def test_regime_stress_splits_the_backtest_by_day():
    run = inputs()
    _, result = P.backtest_stage(run)
    stage = P.regime_stress_stage(run, result)
    rows = {r["key"]: r for r in stage["regimes"]}
    assert set(rows) == set(REGIMES)
    labels, _ = label_regimes(run.data["close"], trend_window=200, volatility_window=20)
    values = [100_000.0] + [p["portfolio_value"] for p in result.equity_curve]
    returns = [b / a - 1 for a, b in zip(values, values[1:])]
    for key, row in rows.items():
        mine = [r for r, label in zip(returns, labels) if label == key]
        assert row["days"] == len(mine)
        if mine:
            assert row["total_return"] == pytest.approx(math.prod(1 + r for r in mine) - 1)
            assert row["annualized_volatility"] == pytest.approx(np.std(mine, ddof=1) * math.sqrt(252))
    # Growth over all labelled days and the warm-up days is the whole backtest's growth.
    warm = [r for r, label in zip(returns, labels) if label is None]
    total = math.prod(1 + r for r in warm) * math.prod(1 + (row["total_return"] or 0) for row in rows.values())
    assert total == pytest.approx(values[-1] / values[0])
    assert sum(r["trade_count"] for r in rows.values()) + sum(
        1 for t in result.trades if labels[pd.Timestamp(t["timestamp"])] is None
    ) == len(result.trades)
    worst = max(r["max_drawdown"] for r in rows.values() if r["days"])
    check = stage["checks"][0]
    assert check["value"] == pytest.approx(worst)
    assert check["threshold"] == T.REGIME_MAX_DRAWDOWN == 0.40
    assert sum(p["bars"] for p in stage["periods"]) == len(run.data)


def test_monte_carlo_is_reproducible_with_the_same_seed():
    run = inputs()
    _, result = P.backtest_stage(run)
    first = P.monte_carlo_stage(run, result)
    second = P.monte_carlo_stage(run, result)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    other = P.monte_carlo_stage(inputs(seed=8), result)
    assert other["bootstrap"]["cumulative_return"] != first["bootstrap"]["cumulative_return"]

    bootstrap = first["bootstrap"]
    assert bootstrap["seed"] == 7 and bootstrap["simulations"] == 300
    for name in ("cumulative_return", "maximum_drawdown"):
        histogram = bootstrap["histograms"][name]
        assert sum(histogram["counts"]) == 300
        assert len(histogram["edges"]) == len(histogram["counts"]) + 1 == P.HISTOGRAM_BINS + 1
    p_value = first["significance"]["p_value"]
    assert first["checks"][0]["value"] == p_value
    assert first["checks"][0]["passed"] == (p_value < 0.05)
    assert first["status"] == ("PASS" if p_value < 0.05 else "FAIL")


def test_histograms_of_a_constant_outcome():
    curve = [{"portfolio_value": v} for v in (100.0, 110.0)]
    result = MonteCarloSimulator().run(
        equity_curve=curve, initial_capital=100.0, simulations=50, seed=1, histogram_bins=10
    )
    assert result["histograms"]["cumulative_return"]["counts"] == [50]


# --- the whole pipeline -----------------------------------------------------------------


def test_the_pipeline_runs_every_stage_and_reports_progress():
    seen = []
    report = P.run_pipeline(
        inputs(parameter_grid={"lookback": [10, 20]}),
        on_progress=lambda r: seen.append({k: s["status"] for k, s in r["stages"].items()}),
    )
    stages = report["stages"]
    assert list(stages) == P.STAGES
    assert seen[0]["backtest"] == "RUNNING"
    assert seen[0]["walk_forward"] == "NOT_RUN"
    for key in P.STAGES[:4]:
        assert stages[key]["status"] in {"PASS", "FAIL"}
    assert stages["paper_trading"]["status"] == "NOT_RUN"
    expected = "PASS" if all(stages[k]["status"] == "PASS" for k in P.STAGES[:4]) else "FAIL"
    assert report["verdict"]["status"] == expected
    assert report["thresholds_source"] == T.SOURCE
    # Stored as JSON: every value must serialise.
    json.dumps(report)
    again = P.run_pipeline(inputs(parameter_grid={"lookback": [10, 20]}))
    assert json.dumps(again, sort_keys=True) == json.dumps(report, sort_keys=True)


def test_a_stage_that_cannot_run_does_not_stop_the_others(monkeypatch):
    def broken(_inputs):
        raise RuntimeError("window maths broke")

    monkeypatch.setattr(P, "walk_forward_stage", broken)
    report = P.run_pipeline(inputs())
    stages = report["stages"]
    assert stages["walk_forward"]["status"] == "ERROR"
    assert stages["walk_forward"]["error"] == "window maths broke"
    assert stages["regime_stress"]["status"] in {"PASS", "FAIL"}
    assert stages["monte_carlo"]["status"] in {"PASS", "FAIL"}
    assert report["verdict"]["status"] == "INCOMPLETE"
    assert "Walk-forward" in report["verdict"]["reason"]


@pytest.mark.parametrize(
    "statuses,verdict",
    [
        (["PASS", "PASS", "PASS", "PASS"], "PASS"),
        (["PASS", "FAIL", "PASS", "PASS"], "FAIL"),
        (["PASS", "ERROR", "FAIL", "PASS"], "INCOMPLETE"),
    ],
)
def test_overall_verdict(statuses, verdict):
    stages = {k: {"status": s} for k, s in zip(P.STAGES, statuses)}
    assert P.overall_verdict(stages)["status"] == verdict


def test_no_code_rules_are_validated_too():
    rules = {
        "parameters": {},
        "indicators": [
            {"name": "fast", "type": "SMA", "parameters": {"window": 5}},
            {"name": "slow", "type": "SMA", "parameters": {"window": 20}},
        ],
        "entry_conditions": [
            {"left": {"type": "indicator", "name": "fast"}, "operator": ">", "right": {"type": "indicator", "name": "slow"}}
        ],
        "exit_conditions": [
            {"left": {"type": "indicator", "name": "fast"}, "operator": "<", "right": {"type": "indicator", "name": "slow"}}
        ],
    }
    report = P.run_pipeline(inputs(strategy_key="no_code_rules", config=rules))
    assert report["stages"]["backtest"]["metrics"]["trade_count"] > 0
    assert len(report["stages"]["walk_forward"]["windows"]) >= 5
    assert report["verdict"]["status"] in {"PASS", "FAIL"}
