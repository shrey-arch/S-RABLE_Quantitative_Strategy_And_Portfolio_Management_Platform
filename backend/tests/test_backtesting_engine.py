import pandas as pd
from pathlib import Path

from app.backtesting.engine import BacktestEngine
from app.backtesting.broker import SimulatedBroker
from app.enums import OrderSide
from app.strategies.base import Strategy
from app.strategies.signal import SignalAction, StrategySignal


class HistoryLengthStrategy(Strategy):
    def __init__(self):
        self.history_lengths = []

    def generate_signal(self, context):
        history = context.market_data["data"]
        self.history_lengths.append(len(history))

        return StrategySignal(
            action=SignalAction.HOLD,
            timestamp=context.timestamp,
        )


def test_engine_does_not_expose_future_data():
    data = pd.DataFrame(
        {
            "close": [100.0, 101.0, 102.0, 103.0, 104.0],
        },
        index=pd.date_range(
            "2026-01-01",
            periods=5,
            freq="D",
            tz="UTC",
        ),
    )

    strategy = HistoryLengthStrategy()
    engine = BacktestEngine()

    engine.run(
        strategy=strategy,
        data=data,
        initial_capital=100000.0,
        execution_id=__import__("uuid").uuid4(),
        instrument_id=__import__("uuid").uuid4(),
    )

    assert strategy.history_lengths == [1, 2, 3, 4, 5]
import pandas as pd
import pytest
from uuid import uuid4

from app.backtesting.engine import BacktestEngine
from app.backtesting.broker import SimulatedBroker
from app.enums import OrderSide
from app.strategies.base import Strategy
from app.strategies.signal import SignalAction, StrategySignal


class BuyStrategy(Strategy):
    def generate_signal(self, context):
        return StrategySignal(
            action=SignalAction.BUY,
            timestamp=context.timestamp,
        )

class LargeBuyStrategy(Strategy):
    def generate_signal(self, context):
        return StrategySignal(
            action=SignalAction.BUY,
            timestamp=context.timestamp,
        )


def test_engine_rejects_trade_when_capital_is_insufficient():
    data = pd.DataFrame(
        {
            "close": [1000.0],
        },
        index=pd.date_range(
            "2026-01-01",
            periods=1,
            freq="D",
            tz="UTC",
        ),
    )

    engine = BacktestEngine()

    with pytest.raises(ValueError, match="Insufficient cash"):
        engine.run(
            strategy=LargeBuyStrategy(),
            data=data,
            initial_capital=100.0,
            execution_id=uuid4(),
            instrument_id=uuid4(),
            quantity=1,
        )
def test_engine_applies_slippage_and_brokerage_to_portfolio():
    data = pd.DataFrame(
        {
            "close": [100.0],
        },
        index=pd.date_range(
            "2026-01-01",
            periods=1,
            freq="D",
            tz="UTC",
        ),
    )

    engine = BacktestEngine()

    result = engine.run(
        strategy=BuyStrategy(),
        data=data,
        initial_capital=100000.0,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        quantity=10,
        broker=SimulatedBroker(
            slippage_bps=10.0,
            brokerage_rate=0.001,
        ),
    )

    trade = result.trades[0]

    assert trade["price"] == pytest.approx(100.1)
    assert trade["brokerage"] == pytest.approx(1.001)
    assert trade["total_charges"] == pytest.approx(1.001)


class BuyThenSellStrategy(Strategy):
    def __init__(self):
        self.calls = 0

    def generate_signal(self, context):
        self.calls += 1

        if self.calls == 1:
            action = SignalAction.BUY
        elif self.calls == 3:
            action = SignalAction.SELL
        else:
            action = SignalAction.HOLD

        return StrategySignal(
            action=action,
            timestamp=context.timestamp,
        )


def test_engine_sell_after_buy_closes_the_long_and_opens_a_short():
    data = pd.DataFrame(
        {
            "close": [100.0, 110.0, 120.0],
        },
        index=pd.date_range(
            "2026-01-01",
            periods=3,
            freq="D",
            tz="UTC",
        ),
    )

    engine = BacktestEngine()
    instrument_id = uuid4()

    result = engine.run(
        strategy=BuyThenSellStrategy(),
        data=data,
        initial_capital=100000.0,
        execution_id=uuid4(),
        instrument_id=instrument_id,
        quantity=10,
    )

    # Golden regression baseline for the deterministic zero-fee scenario.
    # A signal sets the position: BUY = +10, SELL = -10, so the SELL trades 20
    # (closes the long of 10 and opens a short of 10).
    assert len(result.trades) == 2
    assert [trade["side"] for trade in result.trades] == ["BUY", "SELL"]
    assert [trade["quantity"] for trade in result.trades] == [10, 20]
    assert [trade["closed_quantity"] for trade in result.trades] == [0, 10]
    assert [trade["opened_quantity"] for trade in result.trades] == [10, 10]
    assert [trade["price"] for trade in result.trades] == [100.0, 120.0]
    assert [trade["total_charges"] for trade in result.trades] == [0.0, 0.0]
    assert [trade["realized_pnl"] for trade in result.trades] == [0.0, 200.0]

    assert result.initial_capital == 100000.0
    assert result.final_capital == 100200.0
    assert result.final_capital - result.initial_capital == 200.0
    assert result.total_return == pytest.approx(0.002, abs=1e-12)
    assert result.max_drawdown == pytest.approx(0.0, abs=1e-12)

    assert [
        point["portfolio_value"] for point in result.equity_curve
    ] == [100000.0, 100100.0, 100200.0]
class SignalSequenceStrategy(Strategy):
    def __init__(self, actions):
        self.actions = list(actions)

    def generate_signal(self, context):
        return StrategySignal(action=self.actions.pop(0), timestamp=context.timestamp)


def _daily(closes):
    return pd.DataFrame(
        {"close": closes},
        index=pd.date_range("2026-01-01", periods=len(closes), freq="D", tz="UTC"),
    )


def test_repeated_signals_hold_one_position_instead_of_piling_up():
    """Momentum says BUY on every bar above its average. That must buy once, not
    once per bar (which ran out of cash on real prices and failed the backtest)."""
    B, S, H = SignalAction.BUY, SignalAction.SELL, SignalAction.HOLD
    result = BacktestEngine().run(
        strategy=SignalSequenceStrategy([B] * 300 + [H, S, S, S, H, B]),
        data=_daily([1000.0] * 306),
        initial_capital=100000.0,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        quantity=50,
    )
    assert [(t["side"], t["quantity"]) for t in result.trades] == [
        ("BUY", 50),
        ("SELL", 100),
        ("BUY", 100),
    ]
    assert result.final_capital == pytest.approx(100000.0)


def test_hold_keeps_whatever_is_held():
    H = SignalAction.HOLD
    result = BacktestEngine().run(
        strategy=SignalSequenceStrategy([H, H, SignalAction.SELL, H, H]),
        data=_daily([100.0, 101.0, 102.0, 99.0, 98.0]),
        initial_capital=10000.0,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        quantity=3,
    )
    assert [(t["side"], t["quantity"]) for t in result.trades] == [("SELL", 3)]
    # Short 3 from 102 to 98: +12.
    assert result.final_capital == pytest.approx(10012.0)


def test_signal_to_orders_supports_two_leg_allocations():
    engine = BacktestEngine()

    signal = StrategySignal(
        action=SignalAction.BUY,
        timestamp=pd.Timestamp("2026-01-01", tz="UTC").to_pydatetime(),
        allocations={
            "instrument_a": 1.0,
            "instrument_b": -1.0,
        },
    )

    orders = engine.signal_to_orders(
        signal=signal,
        execution_id=uuid4(),
        instrument_ids={
            "instrument_a": uuid4(),
            "instrument_b": uuid4(),
        },
        market_prices={
            "instrument_a": 100.0,
            "instrument_b": 90.0,
        },
        timestamp=signal.timestamp,
    )

    assert len(orders) == 2
    assert {order.order_side.value for order in orders} == {"BUY", "SELL"}
    assert {order.quantity for order in orders} == {1}
class StatisticalArbitrageBuyStrategy(Strategy):
    def generate_signal(self, context):
        return StrategySignal(
            action=SignalAction.BUY,
            timestamp=context.timestamp,
            allocations={
                "instrument_a": 1.0,
                "instrument_b": -1.0,
            },
        )


def test_engine_executes_both_statistical_arbitrage_legs():
    data = pd.DataFrame(
        {
            "close": [100.0],
            "instrument_a": [100.0],
            "instrument_b": [90.0],
        },
        index=pd.date_range(
            "2026-01-01",
            periods=1,
            freq="D",
            tz="UTC",
        ),
    )

    engine = BacktestEngine()

    instrument_a_id = uuid4()
    instrument_b_id = uuid4()

    result = engine.run(
        strategy=StatisticalArbitrageBuyStrategy(),
        data=data,
        initial_capital=100000.0,
        execution_id=uuid4(),
        instrument_id=instrument_a_id,
        instrument_ids={
            "instrument_a": instrument_a_id,
            "instrument_b": instrument_b_id,
        },
        quantity=1,
    )

    assert len(result.trades) == 2

    sides = {trade["side"] for trade in result.trades}
    assert sides == {"BUY", "SELL"}

def test_engine_accepts_multiple_instrument_ids_for_multi_leg_strategy():
    engine = BacktestEngine()

    signal = StrategySignal(
        action=SignalAction.BUY,
        timestamp=pd.Timestamp(
            "2026-01-01",
            tz="UTC",
        ).to_pydatetime(),
        allocations={
            "instrument_a": 1.0,
            "instrument_b": -1.0,
        },
    )

    instrument_a_id = uuid4()
    instrument_b_id = uuid4()

    orders = engine.signal_to_orders(
        signal=signal,
        execution_id=uuid4(),
        instrument_ids={
            "instrument_a": instrument_a_id,
            "instrument_b": instrument_b_id,
        },
        market_prices={
            "instrument_a": 100.0,
            "instrument_b": 90.0,
        },
        timestamp=signal.timestamp,
    )

    assert len(orders) == 2

    order_instruments = {
        str(order.instrument_id)
        for order in orders
    }

    assert order_instruments == {
        str(instrument_a_id),
        str(instrument_b_id),
    }


def test_engine_executes_taa_allocations():
    data = pd.DataFrame(
        {
            "close": [100.0],
            "asset_a": [100.0],
            "asset_b": [200.0],
            "asset_c": [50.0],
        },
        index=pd.date_range(
            "2026-01-01",
            periods=1,
            freq="D",
            tz="UTC",
        ),
    )

    class TAAAllocationStrategy(Strategy):
        def generate_signal(self, context):
            allocations = {
                "asset_a": 0.5,
                "asset_b": 0.5,
                "asset_c": 0.0,
            }

            current_allocations = context.market_data.get(
                "current_allocations"
            )

            action = (
                SignalAction.BUY
                if current_allocations != allocations
                else SignalAction.HOLD
            )

            return StrategySignal(
                action=action,
                timestamp=context.timestamp,
                allocations=allocations,
            )

    engine = BacktestEngine()

    asset_a_id = uuid4()
    asset_b_id = uuid4()
    asset_c_id = uuid4()

    result = engine.run(
        strategy=TAAAllocationStrategy(),
        data=data,
        initial_capital=100000.0,
        execution_id=uuid4(),
        instrument_id=asset_a_id,
        instrument_ids={
            "asset_a": asset_a_id,
            "asset_b": asset_b_id,
            "asset_c": asset_c_id,
        },
        quantity=1,
    )

    assert len(result.trades) == 2

    trades_by_instrument = {
        trade["instrument_id"]: trade
        for trade in result.trades
    }

    assert trades_by_instrument[str(asset_a_id)]["quantity"] == 500
    assert trades_by_instrument[str(asset_b_id)]["quantity"] == 250

    assert trades_by_instrument[str(asset_a_id)]["price"] == 100.0
    assert trades_by_instrument[str(asset_b_id)]["price"] == 200.0

def test_engine_does_not_repeat_unchanged_taa_allocations():
    data = pd.DataFrame(
        {
            "close": [100.0, 100.0],
            "asset_a": [100.0, 100.0],
            "asset_b": [200.0, 200.0],
            "asset_c": [50.0, 50.0],
        },
        index=pd.date_range(
            "2026-01-01",
            periods=2,
            freq="D",
            tz="UTC",
        ),
    )

    class TAAAllocationStrategy(Strategy):
        def generate_signal(self, context):
            allocations = {
                "asset_a": 0.5,
                "asset_b": 0.5,
                "asset_c": 0.0,
            }

            current_allocations = context.market_data.get(
                "current_allocations"
            )

            action = (
                SignalAction.BUY
                if current_allocations != allocations
                else SignalAction.HOLD
            )

            return StrategySignal(
                action=action,
                timestamp=context.timestamp,
                allocations=allocations,
            )

    engine = BacktestEngine()

    asset_a_id = uuid4()
    asset_b_id = uuid4()
    asset_c_id = uuid4()

    result = engine.run(
        strategy=TAAAllocationStrategy(),
        data=data,
        initial_capital=100000.0,
        execution_id=uuid4(),
        instrument_id=asset_a_id,
        instrument_ids={
            "asset_a": asset_a_id,
            "asset_b": asset_b_id,
            "asset_c": asset_c_id,
        },
        quantity=1,
    )

    assert len(result.trades) == 2


def test_engine_rebalances_changed_taa_allocations():
    data = pd.DataFrame(
        {
            "close": [100.0, 100.0],
            "asset_a": [100.0, 100.0],
            "asset_b": [200.0, 200.0],
        },
        index=pd.date_range(
            "2026-01-01",
            periods=2,
            freq="D",
            tz="UTC",
        ),
    )

    class TAARebalanceStrategy(Strategy):
        def generate_signal(self, context):
            if context.timestamp == data.index[0]:
                allocations = {
                    "asset_a": 0.5,
                    "asset_b": 0.5,
                }
            else:
                allocations = {
                    "asset_a": 0.0,
                    "asset_b": 1.0,
                }

            current_allocations = context.market_data.get(
                "current_allocations"
            )

            action = (
                SignalAction.BUY
                if current_allocations != allocations
                else SignalAction.HOLD
            )

            return StrategySignal(
                action=action,
                timestamp=context.timestamp,
                allocations=allocations,
            )

    engine = BacktestEngine()

    asset_a_id = uuid4()
    asset_b_id = uuid4()

    result = engine.run(
        strategy=TAARebalanceStrategy(),
        data=data,
        execution_id=uuid4(),
        instrument_id=asset_a_id,
        instrument_ids={
            "asset_a": asset_a_id,
            "asset_b": asset_b_id,
        },
        initial_capital=100000.0,
    )

    asset_a_trades = [
        trade
        for trade in result.trades
        if trade["instrument_id"] == str(asset_a_id)
    ]

    asset_b_trades = [
        trade
        for trade in result.trades
        if trade["instrument_id"] == str(asset_b_id)
    ]

    assert len(asset_a_trades) >= 2
    assert len(asset_b_trades) >= 1

    assert any(
        trade["side"] == OrderSide.SELL
        for trade in asset_a_trades
    )


def test_backtest_runs_are_isolated():
    data = pd.DataFrame(
        {
            "close": [100.0],
        },
        index=pd.date_range(
            "2026-01-01",
            periods=1,
            freq="D",
            tz="UTC",
        ),
    )

    engine = BacktestEngine()

    result_a = engine.run(
        strategy=BuyStrategy(),
        data=data,
        initial_capital=1000.0,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        quantity=1,
    )

    result_b = engine.run(
        strategy=BuyStrategy(),
        data=data,
        initial_capital=2000.0,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        quantity=1,
    )

    assert result_a is not result_b
    assert result_a.trades is not result_b.trades
    assert result_a.equity_curve is not result_b.equity_curve

    assert result_a.initial_capital == 1000.0
    assert result_b.initial_capital == 2000.0

    assert len(result_a.trades) == 1
    assert len(result_b.trades) == 1

    assert result_a.equity_curve[0]["portfolio_value"] == pytest.approx(1000.0)
    assert result_b.equity_curve[0]["portfolio_value"] == pytest.approx(2000.0)

    assert result_a.trades[0]["instrument_id"] != result_b.trades[0]["instrument_id"]

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.enums import ExecutionStatus, ExecutionType
from app.services.backtesting.backtest_service import BacktestService


def test_backtest_service_runs_execution_to_completion(tmp_path, monkeypatch):
    from app.services.backtesting import artifact_manager as artifact_manager_module

    artifact_root = tmp_path
    monkeypatch.setattr(
        artifact_manager_module.settings,
        "backtest_cache_dir",
        artifact_root,
    )

    db = MagicMock()
    service = BacktestService(db)

    execution = SimpleNamespace(
        id=uuid4(),
        execution_type=ExecutionType.BACKTEST,
        status=ExecutionStatus.PENDING,
        instrument_id=uuid4(),
        timeframe="1D",
        initial_capital=100000.0,
        execution_metrics=None,
    )

    strategy = MagicMock()

    records = [
        SimpleNamespace(
            timestamp=datetime(2026, 1, 1),
            open=100.0,
            high=101.0,
            low=99.0,
            close=100.0,
            volume=1000,
        )
    ]

    result = SimpleNamespace(
        start_timestamp=datetime(2026, 1, 1),
        end_timestamp=datetime(2026, 1, 1),
        initial_capital=100000.0,
        final_capital=100000.0,
        total_return=0.0,
        trades=[],
        equity_curve=[
            {
                "timestamp": datetime(2026, 1, 1),
                "portfolio_value": 100000.0,
            }
        ],
        max_drawdown=0.0,
    )

    provenance = {
        "instrument_id": str(execution.instrument_id),
        "frequency": "1D",
        "row_count": 1,
        "provider": "test_provider",
        "requested_start_date": "2026-01-01",
        "requested_end_date": "2026-01-01",
        "requested_start_timestamp": None,
        "requested_end_timestamp": None,
        "dataset_cache_key": "test-cache-key",
        "data_version": "test-data-version",
        "data_fingerprint": "test-fingerprint",
        "data_acquired_at": "2026-01-01T00:00:00+00:00",
        "cache_hit": False,
    }
    data = __import__("pandas").DataFrame(
        [{
            "open": 100.0,
            "high": 101.0,
            "low": 99.0,
            "close": 100.0,
            "volume": 1000,
        }],
        index=__import__("pandas").DatetimeIndex(
            [datetime(2026, 1, 1, tzinfo=__import__("datetime").timezone.utc)],
            name="timestamp",
        ),
    )
    service.dataset_loader.load = MagicMock(
        return_value=SimpleNamespace(ohlcv=data, metadata=provenance)
    )

    service.execution_service.start_execution = MagicMock(
        side_effect=lambda execution: setattr(
            execution,
            "status",
            ExecutionStatus.RUNNING,
        )
    )

    service.execution_service.complete_execution = MagicMock(
        side_effect=lambda execution: setattr(
            execution,
            "status",
            ExecutionStatus.COMPLETED,
        )
    )

    service.execution_service.fail_execution = MagicMock()

    service.execution_service.repository.update = MagicMock()

    with patch.object(
        service.engine,
        "run",
        return_value=result,
    ) as engine_run:
        returned = service.run(
            execution=execution,
            strategy=strategy,
        )

    assert returned is result
    assert execution.status == ExecutionStatus.COMPLETED

    service.execution_service.start_execution.assert_called_once_with(
        execution=execution,
    )

    engine_run.assert_called_once()

    call_kwargs = engine_run.call_args.kwargs
    assert call_kwargs["strategy"] is strategy
    assert call_kwargs["execution_id"] == execution.id
    assert call_kwargs["instrument_id"] == execution.instrument_id
    assert call_kwargs["initial_capital"] == execution.initial_capital

    assert {
        key: value
        for key, value in execution.execution_metrics.items()
        if key != "canonical_result"
    } == {
        "start_timestamp": "2026-01-01T00:00:00",
        "end_timestamp": "2026-01-01T00:00:00",
        "initial_capital": 100000.0,
        "final_capital": 100000.0,
        "total_return": 0.0,
        "trade_count": 0,
        "max_drawdown": 0.0,
        "data_provenance": provenance,
    }

    canonical = execution.execution_metrics["canonical_result"]
    assert canonical["schema_version"] == 1
    assert canonical["metadata"]["execution_id"] == str(execution.id)
    assert canonical["metadata"]["instrument_ids"] == [str(execution.instrument_id)]
    assert canonical["metrics"]["total_return"] == 0.0
    assert canonical["metrics"]["trade_count"] == 0
    assert canonical["equity_curve"][0]["portfolio_value"] == 100000.0
    assert canonical["provenance"] == provenance

    artifact_dir = artifact_root / "jobs" / str(execution.id)
    assert (artifact_dir / "results" / "result.json").is_file()
    assert (artifact_dir / "results" / "equity_curve.json").is_file()
    assert (artifact_dir / "results" / "trades.json").is_file()
    assert (artifact_dir / "data" / "provenance.json").is_file()

    manifest_path = artifact_dir / "reproducibility.json"
    assert manifest_path.is_file()

    import json

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["schema_version"] == 1
    assert manifest["data_provenance"] == provenance
    assert manifest["result"] == {
        "canonical_result": "results/result.json",
        "equity_curve": "results/equity_curve.json",
        "trades": "results/trades.json",
    }

    service.execution_service.complete_execution.assert_called_once_with(
        execution=execution,
    )

    service.execution_service.fail_execution.assert_not_called()

def test_backtest_service_marks_execution_failed_on_engine_error():
    db = MagicMock()
    service = BacktestService(db)

    execution = SimpleNamespace(
        id=uuid4(),
        execution_type=ExecutionType.BACKTEST,
        status=ExecutionStatus.PENDING,
        instrument_id=uuid4(),
        timeframe="1D",
        initial_capital=100000.0,
        execution_metrics=None,
    )

    strategy = MagicMock()

    service.dataset_loader.load = MagicMock(
        return_value=SimpleNamespace(
            ohlcv=__import__("pandas").DataFrame({"close": [100.0]}),
            metadata={"cache_hit": False, "row_count": 0},
        )
    )

    service.execution_service.start_execution = MagicMock(
        side_effect=lambda execution: setattr(
            execution,
            "status",
            ExecutionStatus.RUNNING,
        )
    )

    service.execution_service.fail_execution = MagicMock(
        side_effect=lambda execution, error_message, error_details=None: (
            setattr(execution, "status", ExecutionStatus.FAILED),
            setattr(execution, "error_message", error_message),
        )
    )

    service.execution_service.complete_execution = MagicMock()

    with patch.object(
        service.engine,
        "run",
        side_effect=RuntimeError("Backtest engine failed"),
    ):
        with pytest.raises(
            RuntimeError,
            match="Backtest engine failed",
        ):
            service.run(
                execution=execution,
                strategy=strategy,
            )

    assert execution.status == ExecutionStatus.FAILED
    assert execution.error_message == "Backtest engine failed"

    service.execution_service.fail_execution.assert_called_once()
    failure_kwargs = service.execution_service.fail_execution.call_args.kwargs
    assert failure_kwargs["execution"] is execution
    assert failure_kwargs["error_message"] == "Backtest engine failed"
    assert failure_kwargs["error_details"]["execution_id"] == str(execution.id)
    assert failure_kwargs["error_details"]["stage"] in {
        "engine", "market_data"
    }

    service.execution_service.complete_execution.assert_not_called()

def test_backtest_job_runner_uses_its_own_database_session():
    from unittest.mock import patch

    from app.services.backtesting.job_runner import BacktestJobRunner

    execution_id = uuid4()
    execution = MagicMock()

    db = MagicMock()

    mock_backtest_service = MagicMock()
    mock_backtest_service.execution_service.get_required_execution.return_value = (
        execution
    )
    mock_backtest_service.run.return_value = "result"

    mock_strategy = MagicMock()

    with patch(
        "app.services.backtesting.job_runner.SessionLocal",
        return_value=db,
    ) as session_factory, patch(
        "app.services.backtesting.job_runner.BacktestService",
        return_value=mock_backtest_service,
    ), patch(
        "app.strategies.factory.StrategyRegistry.get",
        return_value=mock_strategy,
    ) as registry_get:
        result = BacktestJobRunner().run(
            execution_id=execution_id,
            strategy_key="momentum",
            strategy_config={"lookback": 20},
            quantity=1,
        )

    assert result == "result"

    session_factory.assert_called_once_with()
    db.close.assert_called_once_with()

    registry_get.assert_called_once_with(
        "momentum",
        lookback=20,
    )

    mock_backtest_service.execution_service.get_required_execution.assert_called_once_with(
        execution_id=execution_id,
    )

    mock_backtest_service.run.assert_called_once_with(
        execution=execution,
        strategy=mock_strategy,
        start_timestamp=None,
        end_timestamp=None,
        quantity=1,
        strategy_key="momentum",
    )


def test_backtest_job_runner_closes_session_on_strategy_lookup_failure():
    from unittest.mock import patch

    from app.services.backtesting.job_runner import BacktestJobRunner

    execution_id = uuid4()
    db = MagicMock()

    with patch(
        "app.services.backtesting.job_runner.SessionLocal",
        return_value=db,
    ), patch(
        "app.strategies.factory.StrategyRegistry.get",
        side_effect=LookupError("strategy not found"),
    ):
        with pytest.raises(LookupError, match="strategy not found"):
            BacktestJobRunner().run(
                execution_id=execution_id,
                strategy_key="unknown_strategy",
            )

    db.close.assert_called_once_with()

def _executor_test_worker(value):
    return value * 2


def _process_identity_worker():
    return os.getpid()


def _slow_executor_test_worker():
    time.sleep(5)
    return "finished"


def test_backtest_timeout_setting_must_be_positive():
    from pydantic import ValidationError

    from app.config.settings import Settings

    with pytest.raises(ValidationError):
        Settings(
            app_name="test",
            app_env="test",
            debug=False,
            host="127.0.0.1",
            port=8000,
            database_url="postgresql://test",
            secret_key="test",
            algorithm="HS256",
            access_token_expire_minutes=30,
            backtest_timeout_seconds=0,
        )

def _hard_timeout_test_worker():
    import time
    time.sleep(5)


def _hard_timeout_test_worker(*_args, **_kwargs):
    import time
    time.sleep(5)


def test_backtest_executor_hard_timeout_terminates_process():
    from app.services.backtesting.executor import BacktestExecutor

    executor = BacktestExecutor(
        max_workers=1,
        timeout_seconds=1,
    )

    try:
        # A worker that outlives the 1-second limit, whatever the machine's speed.
        future = executor.submit(
            execution_id=uuid4(),
            strategy_key="momentum",
            quantity=1,
            worker_target=_hard_timeout_test_worker,
        )

        with pytest.raises(TimeoutError):
            future.result(timeout=5)

        assert future.done()
    finally:
        executor.shutdown(wait=True)

def _successful_executor_test_worker(
    execution_id,
    strategy_key,
    strategy_config,
    start_timestamp,
    end_timestamp,
    quantity,
):
    return


def test_backtest_executor_successful_process_completion():
    from app.services.backtesting.executor import BacktestExecutor

    executor = BacktestExecutor(
        max_workers=1,
        timeout_seconds=5,
    )

    try:
        future = executor.submit(
            execution_id=uuid4(),
            strategy_key="momentum",
            quantity=1,
            worker_target=_successful_executor_test_worker,
        )

        assert future.result(timeout=5) is None
        assert future.done()

        assert all(
            not process.is_alive()
            for process in executor._processes
        )
    finally:
        executor.shutdown(wait=True)



def test_backtest_executor_enforces_max_workers():
    from app.services.backtesting.executor import BacktestExecutor

    executor = BacktestExecutor(
        max_workers=1,
        timeout_seconds=5,
    )

    try:
        first_future = executor.submit(
            execution_id=uuid4(),
            strategy_key="momentum",
            quantity=1,
            worker_target=_successful_executor_test_worker,
        )

        with pytest.raises(RuntimeError, match="at capacity"):
            executor.submit(
                execution_id=uuid4(),
                strategy_key="momentum",
                quantity=1,
                worker_target=_successful_executor_test_worker,
            )

        assert first_future.result(timeout=5) is None

        second_future = executor.submit(
            execution_id=uuid4(),
            strategy_key="momentum",
            quantity=1,
            worker_target=_successful_executor_test_worker,
        )

        assert second_future.result(timeout=5) is None
    finally:
        executor.shutdown(wait=True)

def _shutdown_test_worker(
    execution_id,
    strategy_key,
    strategy_config,
    start_timestamp,
    end_timestamp,
    quantity,
):
    import time
    time.sleep(5)


def test_backtest_executor_shutdown_without_wait_terminates_workers():
    from app.services.backtesting.executor import BacktestExecutor

    executor = BacktestExecutor(
        max_workers=1,
        timeout_seconds=30,
    )

    executor.submit(
        execution_id=uuid4(),
        strategy_key="momentum",
        quantity=1,
        worker_target=_shutdown_test_worker,
    )

    try:
        import time
        time.sleep(0.5)

        processes = list(executor._processes)

        assert len(processes) == 1
        process = processes[0]
        assert process.is_alive()
    finally:
        executor.shutdown(wait=False)

    process.join(timeout=2)

    assert not process.is_alive()


def test_backtest_executor_shutdown_waits_for_monitor_threads():
    from app.services.backtesting.executor import BacktestExecutor

    executor = BacktestExecutor(
        max_workers=1,
        timeout_seconds=5,
    )

    future = executor.submit(
        execution_id=uuid4(),
        strategy_key="momentum",
        quantity=1,
        worker_target=_successful_executor_test_worker,
    )

    assert future.result(timeout=5) is None

    executor.shutdown(wait=True)

    assert all(
        not monitor.is_alive()
        for monitor in executor._monitor_threads
    )

def test_backtest_service_preserves_original_error_if_failure_persistence_fails():
    db = MagicMock()
    service = BacktestService(db)

    execution = SimpleNamespace(
        id=uuid4(),
        execution_type=ExecutionType.BACKTEST,
        status=ExecutionStatus.PENDING,
        instrument_id=uuid4(),
        timeframe="1D",
        initial_capital=100000.0,
        execution_metrics=None,
    )

    strategy = MagicMock()

    service.dataset_loader.load = MagicMock(
        return_value=SimpleNamespace(
            ohlcv=__import__("pandas").DataFrame({"close": [100.0]}),
            metadata={"cache_hit": False, "row_count": 0},
        )
    )

    service.execution_service.start_execution = MagicMock(
        side_effect=lambda execution: setattr(
            execution,
            "status",
            ExecutionStatus.RUNNING,
        )
    )

    service.execution_service.fail_execution = MagicMock(
        side_effect=OSError("Could not persist failure"),
    )

    with patch.object(
        service.engine,
        "run",
        side_effect=RuntimeError("Backtest engine failed"),
    ):
        with pytest.raises(
            RuntimeError,
            match="Backtest engine failed",
        ):
            service.run(
                execution=execution,
                strategy=strategy,
            )

    service.execution_service.fail_execution.assert_called_once()
    failure_kwargs = service.execution_service.fail_execution.call_args.kwargs
    assert failure_kwargs["execution"] is execution
    assert failure_kwargs["error_message"] == "Backtest engine failed"
    assert failure_kwargs["error_details"]["code"] == (
        "BACKTEST_STRATEGY_EXECUTION_FAILED"
    )

def test_backtest_executor_timeout_future_survives_failure_persistence_error(
    tmp_path, monkeypatch
):
    from unittest.mock import patch

    from app.config import settings
    from app.services.backtesting.executor import BacktestExecutor

    monkeypatch.setattr(settings, "backtest_cache_dir", tmp_path)
    execution_id = uuid4()

    executor = BacktestExecutor(
        max_workers=1,
        timeout_seconds=1,
    )

    with patch(
        "app.services.backtesting.executor._mark_execution_failed",
        side_effect=OSError("Database unavailable"),
    ):
        try:
            future = executor.submit(
                execution_id=execution_id,
                strategy_key="momentum",
                quantity=1,
                worker_target=_shutdown_test_worker,
            )

            with pytest.raises(TimeoutError, match="timed out"):
                future.result(timeout=8)

            assert future.done()
            error_log = (
                tmp_path / "jobs" / str(execution_id) / "logs" / "error.log"
            )
            assert error_log.exists()
            assert "timed out" in error_log.read_text(encoding="utf-8")
        finally:
            executor.shutdown(wait=True)

def _failing_executor_test_worker(
    execution_id,
    strategy_key,
    strategy_config,
    start_timestamp,
    end_timestamp,
    quantity,
):
    import os
    os._exit(1)


def test_backtest_executor_worker_exit_future_survives_failure_persistence_error(
    tmp_path, monkeypatch
):
    from unittest.mock import patch

    from app.config import settings
    from app.services.backtesting.executor import BacktestExecutor

    monkeypatch.setattr(settings, "backtest_cache_dir", tmp_path)
    execution_id = uuid4()

    executor = BacktestExecutor(
        max_workers=1,
        timeout_seconds=5,
    )

    with patch(
        "app.services.backtesting.executor._mark_execution_failed",
        side_effect=OSError("Database unavailable"),
    ):
        try:
            future = executor.submit(
                execution_id=execution_id,
                strategy_key="momentum",
                quantity=1,
                worker_target=_failing_executor_test_worker,
            )

            with pytest.raises(
                RuntimeError,
                match="exit code 1",
            ):
                future.result(timeout=8)

            assert future.done()
            error_log = (
                tmp_path / "jobs" / str(execution_id) / "logs" / "error.log"
            )
            assert error_log.exists()
            assert "exited unexpectedly" in error_log.read_text(encoding="utf-8")
        finally:
            executor.shutdown(wait=True)

def test_backtest_service_marks_execution_failed_on_market_data_load_error():
    db = MagicMock()
    service = BacktestService(db)

    execution = SimpleNamespace(
        id=uuid4(),
        execution_type=ExecutionType.BACKTEST,
        status=ExecutionStatus.PENDING,
        instrument_id=uuid4(),
        timeframe="1D",
        initial_capital=100000.0,
        execution_metrics=None,
    )

    service.execution_service.start_execution = MagicMock(
        side_effect=lambda execution: setattr(
            execution,
            "status",
            ExecutionStatus.RUNNING,
        )
    )
    service.execution_service.fail_execution = MagicMock(
        side_effect=lambda execution, error_message, error_details=None: (
            setattr(execution, "status", ExecutionStatus.FAILED),
            setattr(execution, "error_message", error_message),
        )
    )
    service.dataset_loader.load = MagicMock(
        side_effect=ValueError("Market data unavailable"),
    )

    with pytest.raises(ValueError, match="Market data unavailable"):
        service.run(
            execution=execution,
            strategy=MagicMock(),
        )

    assert execution.status == ExecutionStatus.FAILED
    assert execution.error_message == "Market data unavailable"
    service.execution_service.fail_execution.assert_called_once()
    failure_kwargs = service.execution_service.fail_execution.call_args.kwargs
    assert failure_kwargs["execution"] is execution
    assert failure_kwargs["error_message"] == "Market data unavailable"
    assert failure_kwargs["error_details"]["execution_id"] == str(execution.id)
    assert failure_kwargs["error_details"]["stage"] in {
        "engine", "market_data"
    }


def test_engine_trade_records_distinguish_opening_and_closing_fills():
    data = pd.DataFrame(
        {"close": [100.0, 110.0, 120.0]},
        index=pd.date_range(
            "2026-01-01",
            periods=3,
            freq="D",
            tz="UTC",
        ),
    )

    result = BacktestEngine().run(
        strategy=BuyThenSellStrategy(),
        data=data,
        initial_capital=100000.0,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        quantity=10,
    )

    assert result.trades[0]["realized_pnl"] == 0.0
    assert result.trades[1]["realized_pnl"] == 200.0
