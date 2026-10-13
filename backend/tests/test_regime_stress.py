import pandas as pd
import pytest
from uuid import uuid4

from app.backtesting.regime_stress import RegimeStressAnalyzer
from app.strategies.base import Strategy
from app.strategies.signal import SignalAction, StrategySignal


class HoldStrategy(Strategy):
    def generate_signal(self, context):
        return StrategySignal(
            action=SignalAction.HOLD,
            timestamp=context.timestamp,
        )


def make_data(count=4):
    return pd.DataFrame(
        {"close": [100.0 + i for i in range(count)]},
        index=pd.date_range(
            "2026-01-01", periods=count, freq="D", tz="UTC"
        ),
    )


def run_analyzer(data, regimes):
    return RegimeStressAnalyzer().run(
        strategy_factory=HoldStrategy,
        data=data,
        regimes=regimes,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        initial_capital=100000.0,
    )


def test_reports_metrics_for_each_regime():
    data = make_data()
    regimes = pd.Series(
        ["bull", "bull", "bear", "bear"],
        index=data.index,
    )

    result = run_analyzer(data, regimes)

    assert result["regime_count"] == 2
    assert result["total_samples"] == 4
    assert result["regimes"]["bull"]["sample_count"] == 2
    assert result["regimes"]["bear"]["sample_count"] == 2
    assert result["regimes"]["bull"]["trade_count"] == 0
    assert "max_drawdown" in result["regimes"]["bear"]


def test_rejects_regime_index_mismatch():
    data = make_data()
    regimes = pd.Series(["bull"], index=data.index[:1])

    with pytest.raises(ValueError, match="exactly match"):
        run_analyzer(data, regimes)


def test_rejects_missing_regime_labels():
    data = make_data()
    regimes = pd.Series(["bull", None, "bear", "bear"], index=data.index)

    with pytest.raises(ValueError, match="missing"):
        run_analyzer(data, regimes)


def test_rejects_empty_data():
    data = make_data(0)
    regimes = pd.Series([], index=data.index, dtype=object)

    with pytest.raises(ValueError, match="data cannot be empty"):
        run_analyzer(data, regimes)

def test_repeated_regime_segments_remain_separate_and_chronological():
    data = make_data(5)
    regimes = pd.Series(
        ["bull", "bull", "bear", "bull", "bull"],
        index=data.index,
    )

    result = run_analyzer(data, regimes)

    segments = result["regimes"]

    assert result["regime_count"] == 3
    assert list(segments) == ["bull", "bear", "bull#2"]
    assert segments["bull"]["sample_count"] == 2
    assert segments["bear"]["sample_count"] == 1
    assert segments["bull#2"]["sample_count"] == 2
    assert segments["bull"]["end_timestamp"] < segments["bear"]["start_timestamp"]
    assert segments["bear"]["end_timestamp"] < segments["bull#2"]["start_timestamp"]

def test_rejects_unsorted_data():
    data = make_data()
    data = data.iloc[::-1]
    regimes = pd.Series(["bull"] * len(data), index=data.index)

    with pytest.raises(ValueError, match="chronological"):
        run_analyzer(data, regimes)


def test_rejects_duplicate_data_index():
    data = make_data()
    data.index = [data.index[0], data.index[0], *data.index[2:]]
    regimes = pd.Series(["bull"] * len(data), index=data.index)

    with pytest.raises(ValueError, match="unique"):
        run_analyzer(data, regimes)


def test_rejects_non_positive_initial_capital():
    data = make_data()
    regimes = pd.Series(["bull"] * len(data), index=data.index)

    with pytest.raises(ValueError, match="initial_capital"):
        RegimeStressAnalyzer().run(
            strategy_factory=HoldStrategy,
            data=data,
            regimes=regimes,
            execution_id=uuid4(),
            instrument_id=uuid4(),
            initial_capital=0,
        )


def test_rejects_non_callable_strategy_factory():
    data = make_data()
    regimes = pd.Series(["bull"] * len(data), index=data.index)

    with pytest.raises(ValueError, match="strategy_factory"):
        RegimeStressAnalyzer().run(
            strategy_factory=HoldStrategy(),
            data=data,
            regimes=regimes,
            execution_id=uuid4(),
            instrument_id=uuid4(),
            initial_capital=100000.0,
        )


def test_each_regime_segment_gets_a_fresh_strategy_instance():
    created = []

    class StatefulHoldStrategy(HoldStrategy):
        def __init__(self):
            self.calls = 0
            created.append(self)

        def generate_signal(self, context):
            self.calls += 1
            return super().generate_signal(context)

    data = make_data(4)
    regimes = pd.Series(
        ["bull", "bull", "bear", "bull"],
        index=data.index,
    )

    RegimeStressAnalyzer().run(
        strategy_factory=StatefulHoldStrategy,
        data=data,
        regimes=regimes,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        initial_capital=100000.0,
    )

    assert len(created) == 3
    assert len({id(strategy) for strategy in created}) == 3
    assert [strategy.calls for strategy in created] == [2, 1, 1]


def test_summary_aggregates_worst_return_and_drawdown():
    from app.backtesting.results import BacktestResult

    class StubEngine:
        def __init__(self):
            self.calls = 0

        def run(self, **kwargs):
            self.calls += 1
            data = kwargs["data"]
            start = data.index[0].to_pydatetime()
            end = data.index[-1].to_pydatetime()

            if self.calls == 1:
                initial, final, drawdown = 100.0, 110.0, 0.05
            else:
                initial, final, drawdown = 100.0, 80.0, 0.25

            return BacktestResult(
                start_timestamp=start,
                end_timestamp=end,
                initial_capital=initial,
                final_capital=final,
                total_return=(final - initial) / initial,
                max_drawdown=drawdown,
                trades=[],
                equity_curve=[
                    {"timestamp": start, "portfolio_value": initial},
                    {"timestamp": end, "portfolio_value": final},
                ],
                performance_stats={"volatility": 0.1, "sharpe_ratio": 0.5},
            )

    data = make_data(2)
    regimes = pd.Series(["bull", "bear"], index=data.index)
    analyzer = RegimeStressAnalyzer(engine=StubEngine())

    result = analyzer.run(
        strategy_factory=HoldStrategy,
        data=data,
        regimes=regimes,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        initial_capital=100.0,
    )

    assert result["worst_return"] == pytest.approx(-0.20)
    assert result["worst_drawdown"] == pytest.approx(0.25)
    assert result["total_samples"] == 2


def test_rejects_segment_without_close_column():
    data = make_data()
    data = data.rename(columns={"close": "price"})
    regimes = pd.Series(["bull"] * len(data), index=data.index)

    with pytest.raises(ValueError, match="close"):
        run_analyzer(data, regimes)


def test_regime_stress_tester_public_name_is_available():
    from app.backtesting.regime_stress import RegimeStressTester

    data = make_data(2)
    regimes = pd.Series(["bull", "bear"], index=data.index)

    result = RegimeStressTester().run(
        strategy_factory=HoldStrategy,
        data=data,
        regimes=regimes,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        initial_capital=100000.0,
    )

    assert result["regime_count"] == 2
    assert result["total_samples"] == 2



def test_rejects_non_positive_min_segment_length():
    with pytest.raises(ValueError, match="min_segment_length"):
        RegimeStressAnalyzer(min_segment_length=0)


def test_rejects_segment_shorter_than_configured_minimum():
    data = make_data(4)
    regimes = pd.Series(
        ["bull", "bull", "bear", "bear"],
        index=data.index,
    )

    analyzer = RegimeStressAnalyzer(min_segment_length=3)

    with pytest.raises(ValueError, match="minimum is 3"):
        analyzer.run(
            strategy_factory=HoldStrategy,
            data=data,
            regimes=regimes,
            execution_id=uuid4(),
            instrument_id=uuid4(),
            initial_capital=100000.0,
        )


def test_accepts_segments_at_configured_minimum():
    data = make_data(4)
    regimes = pd.Series(
        ["bull", "bull", "bear", "bear"],
        index=data.index,
    )

    result = RegimeStressAnalyzer(min_segment_length=2).run(
        strategy_factory=HoldStrategy,
        data=data,
        regimes=regimes,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        initial_capital=100000.0,
    )

    assert result["regime_count"] == 2
