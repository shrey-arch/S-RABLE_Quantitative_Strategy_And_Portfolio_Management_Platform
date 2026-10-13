import pandas as pd
import pytest

from app.backtesting.walk_forward import WalkForwardAnalyzer


def test_generates_chronological_non_overlapping_windows():
    index = pd.date_range("2025-01-01", periods=30, freq="D")

    analyzer = WalkForwardAnalyzer(
        train_size=10,
        validation_size=5,
        test_size=5,
        step_size=5,
    )

    windows = analyzer.generate_windows(index)

    assert len(windows) > 0

    for window in windows:
        assert window.train[-1] < window.validation[0]
        assert window.validation[-1] < window.test[0]
        assert len(window.train) == 10
        assert len(window.validation) == 5
        assert len(window.test) == 5


def test_window_generation_is_reproducible():
    index = pd.date_range("2025-01-01", periods=30, freq="D")
    analyzer = WalkForwardAnalyzer(
        train_size=10,
        validation_size=5,
        test_size=5,
        step_size=5,
    )

    first = analyzer.generate_windows(index)
    second = analyzer.generate_windows(index)

    assert first == second


def test_insufficient_data_generates_no_windows():
    index = pd.date_range("2025-01-01", periods=19, freq="D")
    analyzer = WalkForwardAnalyzer(
        train_size=10,
        validation_size=5,
        test_size=5,
        step_size=5,
    )

    assert analyzer.generate_windows(index) == []


def test_rejects_non_positive_window_sizes():
    with pytest.raises(ValueError):
        WalkForwardAnalyzer(
            train_size=0,
            validation_size=5,
            test_size=5,
            step_size=5,
        )

def test_rejects_unsorted_index():
    index = pd.DatetimeIndex(
        ["2025-01-02", "2025-01-01", "2025-01-03"]
    )
    analyzer = WalkForwardAnalyzer(
        train_size=1,
        validation_size=1,
        test_size=1,
        step_size=1,
    )

    with pytest.raises(ValueError, match="chronological"):
        analyzer.generate_windows(index)


def test_rejects_duplicate_index():
    index = pd.DatetimeIndex(
        ["2025-01-01", "2025-01-01", "2025-01-02"]
    )
    analyzer = WalkForwardAnalyzer(
        train_size=1,
        validation_size=1,
        test_size=1,
        step_size=1,
    )

    with pytest.raises(ValueError, match="unique"):
        analyzer.generate_windows(index)


def test_last_window_does_not_exceed_available_index():
    index = pd.date_range("2025-01-01", periods=23, freq="D")
    analyzer = WalkForwardAnalyzer(
        train_size=10,
        validation_size=5,
        test_size=5,
        step_size=5,
    )

    windows = analyzer.generate_windows(index)

    assert windows
    assert windows[-1].test[-1] == index[19]
    assert all(window.test[-1] <= index[-1] for window in windows)

from app.strategies.registry import StrategyRegistry
from app.backtesting.walk_forward import select_parameters


def test_selects_candidate_with_highest_validation_score():
    candidates = [
        {"lookback": 5},
        {"lookback": 10},
        {"lookback": 20},
    ]

    selected = select_parameters(
        strategy_name="momentum",
        candidates=candidates,
        score_candidate=lambda strategy, params: float(params["lookback"]),
    )

    assert selected.parameters == {"lookback": 20}
    assert selected.score == 20.0


def test_equal_scores_choose_first_candidate_deterministically():
    selected = select_parameters(
        strategy_name="momentum",
        candidates=[{"lookback": 5}, {"lookback": 10}],
        score_candidate=lambda strategy, params: 1.0,
    )

    assert selected.parameters == {"lookback": 5}


def test_selector_rejects_empty_candidates():
    with pytest.raises(ValueError, match="candidate"):
        select_parameters(
            strategy_name="momentum",
            candidates=[],
            score_candidate=lambda strategy, params: 1.0,
        )


def test_selector_rejects_non_finite_scores():
    with pytest.raises(ValueError, match="finite"):
        select_parameters(
            strategy_name="momentum",
            candidates=[{"lookback": 5}],
            score_candidate=lambda strategy, params: float("nan"),
        )


def test_selector_uses_registry_validation():
    with pytest.raises(ValueError, match="Unknown parameters"):
        select_parameters(
            strategy_name="momentum",
            candidates=[{"unknown_parameter": 5}],
            score_candidate=lambda strategy, params: 1.0,
        )

def test_selector_does_not_score_invalid_candidate():
    scored = []

    def score_candidate(strategy, params):
        scored.append(params.copy())
        return 1.0

    with pytest.raises(ValueError, match="Unknown parameters"):
        select_parameters(
            strategy_name="momentum",
            candidates=[
                {"lookback": 5},
                {"unknown_parameter": 10},
            ],
            score_candidate=score_candidate,
        )

    assert scored == [{"lookback": 5}]

from app.backtesting.walk_forward import run_walk_forward


def test_runner_evaluates_only_test_slice_with_selected_parameters():
    index = pd.date_range("2025-01-01", periods=20, freq="D")
    data = pd.DataFrame({"close": range(100, 120)}, index=index)

    seen_test_indexes = []

    def score_candidate(strategy, params, validation_data):
        assert validation_data.index.max() < index[16]
        return float(params["lookback"])

    def evaluate_test(strategy_name, params, test_data):
        seen_test_indexes.append(test_data.index.copy())
        return {"return": float(params["lookback"])}

    analyzer = WalkForwardAnalyzer(
        train_size=10,
        validation_size=3,
        test_size=3,
        step_size=3,
    )

    results = run_walk_forward(
        data=data,
        analyzer=analyzer,
        strategy_name="momentum",
        candidates=[{"lookback": 5}, {"lookback": 10}],
        score_candidate=score_candidate,
        evaluate_test=evaluate_test,
    )

    assert len(results) == 2
    assert all(len(test_index) == 3 for test_index in seen_test_indexes)
    assert results[0].parameters == {"lookback": 10}
    assert results[0].test_result == {"return": 10.0}


def test_runner_rejects_empty_data():
    analyzer = WalkForwardAnalyzer(
        train_size=2,
        validation_size=1,
        test_size=1,
        step_size=1,
    )

    with pytest.raises(ValueError, match="empty"):
        run_walk_forward(
            data=pd.DataFrame(),
            analyzer=analyzer,
            strategy_name="momentum",
            candidates=[{"lookback": 5}],
            score_candidate=lambda strategy, params, validation_data: 1.0,
            evaluate_test=lambda name, params, test_data: {},
        )


from app.backtesting.walk_forward import (
    WalkForwardResult,
    WalkForwardWindow,
    summarize_walk_forward,
)


def test_summary_aggregates_out_of_sample_returns_and_stability():
    index = pd.date_range("2025-01-01", periods=3, freq="D")
    window = WalkForwardWindow(
        train=index[:1],
        validation=index[1:2],
        test=index[2:],
    )
    results = [
        WalkForwardResult(window, {"lookback": 5}, 1.0, {"return": 0.10}),
        WalkForwardResult(window, {"lookback": 5}, 2.0, {"return": -0.02}),
        WalkForwardResult(window, {"lookback": 10}, 1.5, {"return": 0.04}),
    ]

    summary = summarize_walk_forward(results)

    assert summary.window_count == 3
    assert summary.test_returns == (0.10, -0.02, 0.04)
    assert summary.mean_test_return == pytest.approx(0.04)
    assert summary.median_test_return == pytest.approx(0.04)
    assert summary.positive_test_window_rate == pytest.approx(2 / 3)
    assert summary.parameter_stability == {
        "lookback=5": 2,
        "lookback=10": 1,
    }
    assert summary.parameter_stability_rate == {
        "lookback=5": pytest.approx(2 / 3),
        "lookback=10": pytest.approx(1 / 3),
    }


def test_summary_rejects_empty_results():
    with pytest.raises(ValueError, match="At least one"):
        summarize_walk_forward([])


def test_summary_rejects_non_finite_test_returns():
    index = pd.date_range("2025-01-01", periods=3, freq="D")
    window = WalkForwardWindow(index[:1], index[1:2], index[2:])
    result = WalkForwardResult(
        window=window,
        parameters={"lookback": 5},
        validation_score=1.0,
        test_result={"return": float("nan")},
    )

    with pytest.raises(ValueError, match="finite"):
        summarize_walk_forward([result])

def test_runner_rejects_unsorted_data_before_evaluation():
    data = pd.DataFrame(
        {"close": [100, 102, 101]},
        index=pd.to_datetime(["2025-01-02", "2025-01-01", "2025-01-03"]),
    )
    analyzer = WalkForwardAnalyzer(
        train_size=1,
        validation_size=1,
        test_size=1,
        step_size=1,
    )

    with pytest.raises(ValueError, match="chronological"):
        run_walk_forward(
            data=data,
            analyzer=analyzer,
            strategy_name="momentum",
            candidates=[{"lookback": 5}],
            score_candidate=lambda strategy, params, validation_data: 1.0,
            evaluate_test=lambda name, params, test_data: {"return": 0.0},
        )


def test_runner_rejects_duplicate_timestamps_before_evaluation():
    data = pd.DataFrame(
        {"close": [100, 101, 102]},
        index=pd.to_datetime(["2025-01-01", "2025-01-01", "2025-01-02"]),
    )
    analyzer = WalkForwardAnalyzer(
        train_size=1,
        validation_size=1,
        test_size=1,
        step_size=1,
    )

    with pytest.raises(ValueError, match="unique"):
        run_walk_forward(
            data=data,
            analyzer=analyzer,
            strategy_name="momentum",
            candidates=[{"lookback": 5}],
            score_candidate=lambda strategy, params, validation_data: 1.0,
            evaluate_test=lambda name, params, test_data: {"return": 0.0},
        )

from uuid import uuid4

from app.backtesting.engine import BacktestEngine
from app.strategies.signal import SignalAction, StrategySignal


def test_real_engine_evaluates_only_the_test_window():
    from app.strategies.registry import StrategyRegistry

    data = pd.DataFrame(
        {"close": [100.0 + i for i in range(20)]},
        index=pd.date_range("2025-01-01", periods=20, freq="D"),
    )
    analyzer = WalkForwardAnalyzer(
        train_size=10,
        validation_size=3,
        test_size=3,
        step_size=3,
    )

    evaluated = []

    def score_candidate(strategy, params, validation_data):
        assert isinstance(strategy, StrategyRegistry.definition("momentum").strategy_class)
        assert strategy.lookback == params["lookback"]
        assert len(validation_data) == 3
        return float(params["lookback"])

    def evaluate_test(strategy_name, params, test_data):
        strategy = StrategyRegistry.get(strategy_name, **params)
        result = BacktestEngine().run(
            strategy=strategy,
            data=test_data.copy(),
            execution_id=uuid4(),
            instrument_id=uuid4(),
            initial_capital=100_000.0,
        )
        assert result.start_timestamp == test_data.index[0].to_pydatetime()
        assert result.end_timestamp == test_data.index[-1].to_pydatetime()
        assert len(result.equity_curve) == len(test_data)
        evaluated.append((strategy.lookback, test_data.index.copy()))
        return {"return": result.total_return}

    results = run_walk_forward(
        data=data,
        analyzer=analyzer,
        strategy_name="momentum",
        candidates=[{"lookback": 2}, {"lookback": 5}],
        score_candidate=score_candidate,
        evaluate_test=evaluate_test,
    )

    assert len(results) == 2
    assert all(result.parameters == {"lookback": 5} for result in results)
    assert all(lookback == 5 for lookback, _ in evaluated)
    assert all(len(test_index) == 3 for _, test_index in evaluated)
    assert all(
        test_index[0] > data.index[12]
        for _, test_index in evaluated
    )
def test_runner_reuses_generator_candidates_across_windows():
    data = pd.DataFrame(
        {"close": range(100, 120)},
        index=pd.date_range("2025-01-01", periods=20, freq="D"),
    )
    analyzer = WalkForwardAnalyzer(
        train_size=10,
        validation_size=3,
        test_size=3,
        step_size=3,
    )
    scored_windows = []

    def score_candidate(strategy, params, validation_data):
        scored_windows.append(validation_data.index.copy())
        return float(params["lookback"])

    results = run_walk_forward(
        data=data,
        analyzer=analyzer,
        strategy_name="momentum",
        candidates=({"lookback": value} for value in [5, 10]),
        score_candidate=score_candidate,
        evaluate_test=lambda name, params, test_data: {"return": 0.01},
    )

    assert len(results) == 2
    assert len(scored_windows) == 4

def test_validation_adapter_uses_real_engine_result():
    from uuid import uuid4

    from app.backtesting.walk_forward import score_with_backtest_engine

    data = pd.DataFrame(
        {"close": [100.0, 101.0, 102.0]},
        index=pd.date_range("2025-01-01", periods=3, freq="D"),
    )

    score = score_with_backtest_engine(
        strategy_name="momentum",
        parameters={"lookback": 2},
        validation_data=data,
        instrument_id=uuid4(),
        initial_capital=100_000.0,
        metric="total_return",
    )

    assert isinstance(score, float)
    assert pd.notna(score) and score not in (float("inf"), float("-inf"))




def test_backtest_validation_scorer_integrates_with_runner():
    from app.backtesting.walk_forward import make_backtest_validation_scorer

    data = pd.DataFrame(
        {"close": [100.0, 101.0, 102.0, 103.0, 104.0, 105.0]},
        index=pd.date_range("2025-01-01", periods=6, freq="D"),
    )
    analyzer = WalkForwardAnalyzer(
        train_size=2,
        validation_size=2,
        test_size=2,
        step_size=2,
    )

    scorer = make_backtest_validation_scorer(
        strategy_name="momentum",
        instrument_id=uuid4(),
        initial_capital=100_000.0,
    )

    results = run_walk_forward(
        data=data,
        analyzer=analyzer,
        strategy_name="momentum",
        candidates=[{"lookback": 2}],
        score_candidate=scorer,
        evaluate_test=lambda name, params, test_data: {"return": 0.01},
    )

    assert len(results) == 1
    assert isinstance(results[0].validation_score, float)
    assert pd.notna(results[0].validation_score)




def test_runner_isolates_training_validation_and_test_slices():
    data = pd.DataFrame(
        {"close": range(100, 120)},
        index=pd.date_range("2025-01-01", periods=20, freq="D"),
    )
    analyzer = WalkForwardAnalyzer(
        train_size=10,
        validation_size=3,
        test_size=3,
        step_size=3,
    )

    training_indexes = []
    validation_indexes = []
    test_indexes = []

    def train_candidate(strategy, params, train_data):
        training_indexes.append(train_data.index.copy())

    def score_candidate(strategy, params, validation_data):
        validation_indexes.append(validation_data.index.copy())
        return float(params["lookback"])

    def evaluate_test(strategy_name, params, test_data):
        test_indexes.append(test_data.index.copy())
        return {"return": 0.01}

    results = run_walk_forward(
        data=data,
        analyzer=analyzer,
        strategy_name="momentum",
        candidates=[{"lookback": 5}, {"lookback": 10}],
        train_candidate=train_candidate,
        score_candidate=score_candidate,
        evaluate_test=evaluate_test,
    )

    assert len(results) == 2
    assert len(training_indexes) == 6  # two candidates + selected strategy per window
    assert len(validation_indexes) == 4
    assert len(test_indexes) == 2

    for train_index, validation_index, test_index in zip(
        training_indexes[::3], validation_indexes[::2], test_indexes
    ):
        assert train_index.max() < validation_index.min()
        assert validation_index.max() < test_index.min()
        assert not set(train_index) & set(validation_index)
        assert not set(train_index) & set(test_index)
        assert not set(validation_index) & set(test_index)


def test_engine_test_evaluator_returns_out_of_sample_metrics():
    from app.backtesting.walk_forward import evaluate_test_with_backtest_engine

    data = pd.DataFrame(
        {"close": [100.0, 101.0, 102.0]},
        index=pd.date_range("2025-02-01", periods=3, freq="D"),
    )

    result = evaluate_test_with_backtest_engine(
        strategy_name="momentum",
        parameters={"lookback": 2},
        test_data=data,
        instrument_id=uuid4(),
        initial_capital=100_000.0,
    )

    assert result["start_timestamp"] == data.index[0].to_pydatetime()
    assert result["end_timestamp"] == data.index[-1].to_pydatetime()
    assert len(result["equity_curve"]) == len(data)
    assert isinstance(result["return"], float)
    assert "max_drawdown" in result
    assert "performance_stats" in result
def test_runner_uses_engine_evaluator_when_callback_is_omitted(monkeypatch):
    import app.backtesting.walk_forward as wf

    data = pd.DataFrame(
        {"close": [100.0, 101.0, 102.0, 103.0, 104.0, 105.0]},
        index=pd.date_range("2025-01-01", periods=6, freq="D"),
    )
    analyzer = WalkForwardAnalyzer(
        train_size=2,
        validation_size=2,
        test_size=2,
        step_size=2,
    )
    expected_result = {"return": 0.05}
    calls = []

    def fake_evaluator(**kwargs):
        calls.append(kwargs)
        return expected_result

    monkeypatch.setattr(
        wf,
        "evaluate_test_with_backtest_engine",
        fake_evaluator,
    )

    results = wf.run_walk_forward(
        data=data,
        analyzer=analyzer,
        strategy_name="momentum",
        candidates=[{"lookback": 2}],
        score_candidate=lambda strategy, params, validation: 1.0,
        instrument_id=uuid4(),
        initial_capital=100_000.0,
    )

    assert len(results) == 1
    assert results[0].test_result == expected_result
    assert len(calls) == 1
    assert calls[0]["test_data"].index.equals(data.index[-2:])
    assert calls[0]["instrument_id"] is not None


def test_walk_forward_default_path_runs_real_engine():
    from uuid import uuid4

    from app.backtesting.walk_forward import run_walk_forward

    data = pd.DataFrame(
        {"close": [100.0 + i for i in range(12)]},
        index=pd.date_range("2025-03-01", periods=12, freq="D"),
    )
    analyzer = WalkForwardAnalyzer(
        train_size=4,
        validation_size=2,
        test_size=2,
        step_size=2,
    )

    results = run_walk_forward(
        data=data,
        analyzer=analyzer,
        strategy_name="momentum",
        candidates=[{"lookback": 2}],
        score_candidate=lambda strategy, params, validation: 1.0,
        instrument_id=uuid4(),
        initial_capital=100_000.0,
    )

    assert len(results) == 3
    for result in results:
        test_index = result.window.test
        test_result = result.test_result

        assert test_result["start_timestamp"] == test_index[0].to_pydatetime()
        assert test_result["end_timestamp"] == test_index[-1].to_pydatetime()
        assert len(test_result["equity_curve"]) == len(test_index)
        assert isinstance(test_result["return"], float)
