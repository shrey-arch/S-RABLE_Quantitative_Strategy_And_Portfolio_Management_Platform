from dataclasses import dataclass

import math
from collections.abc import Callable, Iterable, Mapping
from typing import Any
from uuid import UUID, uuid4

import pandas as pd

from app.strategies.registry import StrategyRegistry
from app.backtesting.engine import BacktestEngine
from app.backtesting.results import BacktestResult


@dataclass(frozen=True)
class WalkForwardWindow:
    train: pd.Index
    validation: pd.Index
    test: pd.Index

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, WalkForwardWindow):
            return NotImplemented
        return (
            self.train.equals(other.train)
            and self.validation.equals(other.validation)
            and self.test.equals(other.test)
        )


class WalkForwardAnalyzer:
    def __init__(
        self,
        *,
        train_size: int,
        validation_size: int,
        test_size: int,
        step_size: int,
    ) -> None:
        sizes = {
            "train_size": train_size,
            "validation_size": validation_size,
            "test_size": test_size,
            "step_size": step_size,
        }

        for name, size in sizes.items():
            if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
                raise ValueError(f"{name} must be a positive integer")

        self.train_size = train_size
        self.validation_size = validation_size
        self.test_size = test_size
        self.step_size = step_size

    def generate_windows(self, index: pd.Index) -> list[WalkForwardWindow]:
        index = pd.Index(index)

        if not index.is_monotonic_increasing:
            raise ValueError("index must be in chronological order")

        if not index.is_unique:
            raise ValueError("index must contain unique values")

        total_size = (
            self.train_size + self.validation_size + self.test_size
        )
        windows = []

        for start in range(0, len(index) - total_size + 1, self.step_size):
            train_end = start + self.train_size
            validation_end = train_end + self.validation_size
            test_end = validation_end + self.test_size

            windows.append(
                WalkForwardWindow(
                    train=index[start:train_end],
                    validation=index[train_end:validation_end],
                    test=index[validation_end:test_end],
                )
            )

        return windows



@dataclass(frozen=True)
class ParameterSelection:
    parameters: dict[str, Any]
    score: float


def select_parameters(
    *,
    strategy_name: str,
    candidates: Iterable[Mapping[str, Any]],
    score_candidate: Callable[[Any, dict[str, Any]], float],
) -> ParameterSelection:
    """Select parameters using validation scores only.

    The callback receives a fresh strategy instance and validated effective
    parameters for each candidate. The caller is responsible for ensuring
    that the callback evaluates validation data only.
    """
    best: ParameterSelection | None = None

    for candidate in candidates:
        candidate_parameters = dict(candidate)
        effective_parameters = StrategyRegistry.effective_parameters(
            strategy_name, **candidate_parameters
        )
        strategy = StrategyRegistry.get(
            strategy_name, **candidate_parameters
        )
        score = float(score_candidate(strategy, effective_parameters))

        if not math.isfinite(score):
            raise ValueError("Candidate score must be finite.")

        if best is None or score > best.score:
            best = ParameterSelection(
                parameters=effective_parameters,
                score=score,
            )

    if best is None:
        raise ValueError("At least one candidate is required.")

    return best
@dataclass(frozen=True)
class WalkForwardResult:
    window: WalkForwardWindow
    parameters: dict[str, Any]
    validation_score: float
    test_result: Any


def run_walk_forward(
    *,
    data: pd.DataFrame,
    analyzer: WalkForwardAnalyzer,
    strategy_name: str,
    candidates: Iterable[Mapping[str, Any]],
    score_candidate: Callable[[Any, dict[str, Any], pd.DataFrame], float],
    evaluate_test: Callable[[str, dict[str, Any], pd.DataFrame], Any] | None = None,
    train_candidate: Callable[[Any, dict[str, Any], pd.DataFrame], None] | None = None,
    instrument_id: UUID | None = None,
    initial_capital: float = 100_000.0,
    engine: BacktestEngine | None = None,
) -> list[WalkForwardResult]:
    """Select parameters on validation data and evaluate test slices separately.

    Callbacks receive copies of their respective data slices. The test
    evaluator never receives training or validation rows.
    """
    if not isinstance(data, pd.DataFrame):
        raise ValueError("data must be a pandas DataFrame.")
    if data.empty:
        raise ValueError("data cannot be empty.")
    if not data.index.is_monotonic_increasing:
        raise ValueError("data index must be in chronological order.")
    if not data.index.is_unique:
        raise ValueError("data index must contain unique values.")

    candidate_list = [dict(candidate) for candidate in candidates]
    if not candidate_list:
        raise ValueError("At least one candidate is required.")

    windows = analyzer.generate_windows(data.index)
    results: list[WalkForwardResult] = []

    for window in windows:
        train_data = data.loc[window.train].copy()
        validation_data = data.loc[window.validation].copy()
        test_data = data.loc[window.test].copy()

        def validation_score(strategy, params):
            if train_candidate is not None:
                train_candidate(strategy, params, train_data.copy())
            return score_candidate(strategy, params, validation_data.copy())

        selection = select_parameters(
            strategy_name=strategy_name,
            candidates=candidate_list,
            score_candidate=validation_score,
        )

        # Create a fresh strategy for the selected parameters so that
        # validation state cannot leak into the out-of-sample evaluation.
        test_strategy = StrategyRegistry.get(
            strategy_name, **selection.parameters
        )
        if train_candidate is not None:
            train_candidate(
                test_strategy,
                selection.parameters.copy(),
                train_data.copy(),
            )

        if evaluate_test is not None:
            test_result = evaluate_test(
                strategy_name,
                selection.parameters.copy(),
                test_data.copy(),
            )
        else:
            if instrument_id is None:
                raise ValueError(
                    "instrument_id is required when evaluate_test is omitted."
                )
            test_result = evaluate_test_with_backtest_engine(
                strategy_name=strategy_name,
                parameters=selection.parameters.copy(),
                test_data=test_data.copy(),
                instrument_id=instrument_id,
                initial_capital=initial_capital,
                engine=engine,
            )

        results.append(
            WalkForwardResult(
                window=window,
                parameters=selection.parameters.copy(),
                validation_score=selection.score,
                test_result=test_result,
            )
        )

    return results

@dataclass(frozen=True)
class WalkForwardSummary:
    window_count: int
    test_returns: tuple[float, ...]
    mean_test_return: float
    median_test_return: float
    test_return_std: float
    positive_test_window_rate: float
    parameter_stability: dict[str, int]
    parameter_stability_rate: dict[str, float]


def summarize_walk_forward(
    results: Iterable[WalkForwardResult],
) -> WalkForwardSummary:
    """Aggregate out-of-sample returns and parameter stability."""
    import statistics
    from collections import Counter

    results = list(results)
    if not results:
        raise ValueError("At least one walk-forward result is required.")

    test_returns: list[float] = []
    parameter_counts: Counter[str] = Counter()

    for result in results:
        raw_return = result.test_result.get("return")
        if isinstance(raw_return, bool) or not isinstance(raw_return, (int, float)):
            raise ValueError("Each test result must contain a numeric 'return'.")
        value = float(raw_return)
        if not math.isfinite(value):
            raise ValueError("Test returns must be finite.")
        test_returns.append(value)

        for name, parameter_value in result.parameters.items():
            parameter_counts[f"{name}={parameter_value}"] += 1

    return WalkForwardSummary(
        window_count=len(results),
        test_returns=tuple(test_returns),
        mean_test_return=statistics.mean(test_returns),
        median_test_return=statistics.median(test_returns),
        test_return_std=(
            statistics.stdev(test_returns) if len(test_returns) > 1 else 0.0
        ),
        positive_test_window_rate=(
            sum(value > 0 for value in test_returns) / len(test_returns)
        ),
        parameter_stability=dict(parameter_counts),
        parameter_stability_rate={
            key: count / len(results)
            for key, count in parameter_counts.items()
        },
    )




def score_with_backtest_engine(
    *,
    strategy_name: str,
    parameters: dict[str, Any],
    validation_data: pd.DataFrame,
    instrument_id: UUID,
    initial_capital: float,
    metric: str = "total_return",
    engine: BacktestEngine | None = None,
) -> float:
    """Score one parameter set on validation data using the real engine."""
    if validation_data.empty:
        raise ValueError("validation_data cannot be empty.")
    if metric not in {"total_return", "max_drawdown"}:
        raise ValueError(
            "metric must be 'total_return' or 'max_drawdown'."
        )

    strategy = StrategyRegistry.get(strategy_name, **parameters)
    result: BacktestResult = (engine or BacktestEngine()).run(
        strategy=strategy,
        data=validation_data.copy(),
        execution_id=uuid4(),
        instrument_id=instrument_id,
        initial_capital=initial_capital,
    )

    score = (
        result.total_return
        if metric == "total_return"
        else -result.max_drawdown
    )
    if not math.isfinite(float(score)):
        raise ValueError("Validation score must be finite.")
    return float(score)



def evaluate_test_with_backtest_engine(
    *,
    strategy_name: str,
    parameters: dict[str, Any],
    test_data: pd.DataFrame,
    instrument_id: UUID,
    initial_capital: float,
    engine: BacktestEngine | None = None,
) -> dict[str, Any]:
    """Evaluate selected parameters on an isolated out-of-sample test slice."""
    if not isinstance(test_data, pd.DataFrame):
        raise ValueError("test_data must be a pandas DataFrame.")
    if test_data.empty:
        raise ValueError("test_data cannot be empty.")
    if not test_data.index.is_monotonic_increasing:
        raise ValueError("test_data must be chronological.")
    if not test_data.index.is_unique:
        raise ValueError("test_data index must contain unique values.")

    strategy = StrategyRegistry.get(strategy_name, **parameters)
    result: BacktestResult = (engine or BacktestEngine()).run(
        strategy=strategy,
        data=test_data.copy(),
        execution_id=uuid4(),
        instrument_id=instrument_id,
        initial_capital=initial_capital,
    )

    return {
        "return": float(result.total_return),
        "max_drawdown": float(result.max_drawdown),
        "initial_capital": float(result.initial_capital),
        "final_capital": float(result.final_capital),
        "start_timestamp": result.start_timestamp,
        "end_timestamp": result.end_timestamp,
        "trade_count": len(result.trades),
        "equity_curve": result.equity_curve,
        "trades": result.trades,
        "performance_stats": result.performance_stats,
    }

def make_backtest_validation_scorer(
    *,
    strategy_name: str,
    instrument_id: UUID,
    initial_capital: float,
    metric: str = "total_return",
    engine: BacktestEngine | None = None,
) -> Callable[[Any, dict[str, Any], pd.DataFrame], float]:
    """Build a validation callback that scores candidates with BacktestEngine."""
    def score_candidate(
        strategy: Any,
        parameters: dict[str, Any],
        validation_data: pd.DataFrame,
    ) -> float:
        return score_with_backtest_engine(
            strategy_name=strategy_name,
            parameters=parameters,
            validation_data=validation_data,
            instrument_id=instrument_id,
            initial_capital=initial_capital,
            metric=metric,
            engine=engine,
        )

    return score_candidate
