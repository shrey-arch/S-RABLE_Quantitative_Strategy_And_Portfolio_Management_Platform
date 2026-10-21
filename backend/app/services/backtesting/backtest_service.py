from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

import pandas as pd

from app.services.backtesting.artifact_manager import BacktestArtifactManager
from app.backtesting.broker import SimulatedBroker
from app.backtesting.canonical_result import canonicalize_backtest_result
from app.backtesting.engine import BacktestEngine
from app.data.loaders import MarketDatasetLoader
from app.enums import ExecutionStatus, ExecutionType, Timeframe
from app.exceptions.backtesting_errors import (
    build_backtest_error_payload,
    classify_backtest_error,
)
from app.models import Execution
from app.services.executions.execution_service import ExecutionService


logger = logging.getLogger(__name__)


class BacktestService:
    """
    Application-level orchestration for a persisted backtest execution.

    This service owns the lifecycle boundary around BacktestEngine:
        PENDING -> RUNNING -> COMPLETED
        PENDING/RUNNING -> FAILED
    """

    def __init__(self, db):
        self.execution_service = ExecutionService(db)
        self.dataset_loader = MarketDatasetLoader(db)
        self.engine = BacktestEngine()

    @staticmethod
    def market_data_to_dataframe(records) -> pd.DataFrame:
        """Convert persisted MarketData records into engine input."""
        if not records:
            return pd.DataFrame()

        rows = [
            {
                "timestamp": record.timestamp,
                "open": record.open,
                "high": record.high,
                "low": record.low,
                "close": record.close,
                "volume": record.volume,
            }
            for record in records
        ]

        dataframe = pd.DataFrame(rows)
        dataframe["timestamp"] = pd.to_datetime(
            dataframe["timestamp"],
            utc=True,
        )
        dataframe = dataframe.set_index("timestamp")
        return dataframe.sort_index()

    @staticmethod
    def combine_closes(datasets, layout: str) -> tuple[pd.DataFrame, dict[str, UUID]]:
        """Close prices of several instruments side by side, on the dates they all
        have. Column names are what the strategy expects:

        * pair:     instrument_a, instrument_b (plus close = instrument_a for the engine)
        * universe: close (the first instrument), asset_2, asset_3, ...
        """
        if layout == "pair":
            keys = ["instrument_a", "instrument_b"]
        else:
            keys = ["close"] + [f"asset_{n}" for n in range(2, len(datasets) + 1)]

        frame = pd.concat(
            {key: dataset.ohlcv["close"] for key, dataset in zip(keys, datasets)},
            axis=1,
            join="inner",
        ).dropna()

        if frame.empty:
            raise ValueError(
                "The chosen instruments have no market data on the same dates "
                "in this range."
            )

        if layout == "pair":
            frame["close"] = frame["instrument_a"]

        instrument_ids = {
            key: dataset.instrument.id for key, dataset in zip(keys, datasets)
        }
        return frame.sort_index(), instrument_ids

    def _store_records(self, execution) -> None:
        """Store the run's simulated orders, trades and positions (Phase 15), in
        the same commit that marks the run COMPLETED, so a completed backtest
        always has them. A failure here never fails the backtest: it is undone
        on its own and the records can be stored later from the results page."""
        if not isinstance(execution, Execution):
            return
        if execution.execution_type != ExecutionType.BACKTEST:
            return
        db = self.execution_service.repository.db
        try:
            from app.services.records.service import store_backtest_records

            with db.begin_nested():
                store_backtest_records(db, execution, completing=True)
        except Exception:
            logger.exception(
                "Storing trading records failed: execution_id=%s",
                execution.id,
            )

    def run(
        self,
        *,
        execution: Execution,
        strategy,
        start_timestamp: datetime | None = None,
        end_timestamp: datetime | None = None,
        instrument_ids: dict[str, UUID] | None = None,
        quantity: int = 1,
        strategy_key: str | None = None,
        other_instrument_ids: list[UUID] | None = None,
        instrument_layout: str = "single",
        broker: SimulatedBroker | None = None,
    ):
        if execution.execution_type.value != "BACKTEST":
            raise ValueError(
                "BacktestService requires a BACKTEST execution."
            )

        if execution.status != ExecutionStatus.PENDING:
            raise ValueError(
                "Backtest execution must be in PENDING status."
            )

        artifact_manager = BacktestArtifactManager(execution.id)

        def update_artifact_status(status, *, details=None):
            try:
                update = getattr(artifact_manager, "update_status", None)
                if callable(update):
                    update(status, details=details)
            except Exception:
                logger.exception(
                    "Could not update backtest artifact status: "
                    "execution_id=%s status=%s",
                    execution.id,
                    status,
                )

        try:
            self.execution_service.start_execution(
                execution=execution,
            )
            update_artifact_status(ExecutionStatus.RUNNING.value)

            try:
                dataset = self.dataset_loader.load(
                    instrument_id=execution.instrument_id,
                    frequency=Timeframe(execution.timeframe),
                    start_timestamp=start_timestamp,
                    end_timestamp=end_timestamp,
                )
                provenance = dataset.metadata
                data = dataset.ohlcv
                if data is None or data.empty:
                    raise ValueError(
                        "No market data for the chosen instrument and dates. "
                        "Import historical data for this range first."
                    )

                if instrument_layout != "single":
                    datasets = [dataset] + [
                        self.dataset_loader.load(
                            instrument_id=other_id,
                            frequency=Timeframe(execution.timeframe),
                            start_timestamp=start_timestamp,
                            end_timestamp=end_timestamp,
                        )
                        for other_id in (other_instrument_ids or [])
                    ]
                    data, instrument_ids = self.combine_closes(
                        datasets, instrument_layout
                    )
                    provenance = {
                        **dataset.metadata,
                        "instruments": [d.metadata for d in datasets],
                        "aligned_rows": len(data),
                    }
            except Exception as exc:
                classification = classify_backtest_error(
                    exc,
                    context="market_data_unavailable",
                )
                logger.exception(
                    "Backtest market-data loading failed: category=%s "
                    "code=%s execution_id=%s",
                    classification.category,
                    classification.code,
                    execution.id,
                )
                raise

            try:
                try:
                    result = self.engine.run(
                        strategy=strategy,
                        data=data,
                        execution_id=execution.id,
                        instrument_id=execution.instrument_id,
                        initial_capital=float(execution.initial_capital),
                        instrument_ids=instrument_ids,
                        quantity=quantity,
                        broker=broker,
                    )
                finally:
                    # Feature 6: a sandbox strategy owns a child process; close it.
                    closer = getattr(strategy, "close", None)
                    if callable(closer):
                        closer()
            except Exception as exc:
                classification = classify_backtest_error(
                    exc,
                    context="strategy_execution",
                )
                logger.exception(
                    "Backtest strategy execution failed: category=%s "
                    "code=%s execution_id=%s",
                    classification.category,
                    classification.code,
                    execution.id,
                )
                raise

            canonical_result = canonicalize_backtest_result(
                result,
                execution_id=execution.id,
                strategy=strategy,
                instrument_id=execution.instrument_id,
                start_timestamp=start_timestamp,
                end_timestamp=end_timestamp,
                config=getattr(execution, "execution_config", None),
                provenance=provenance,
                strategy_key=strategy_key,
                instrument_ids=instrument_ids,
            )

            artifact_manager.write_result(canonical_result)
            artifact_manager.write_equity_curve(
                canonical_result["equity_curve"]
            )
            artifact_manager.write_trades(
                canonical_result["trades"]
            )
            artifact_manager.write_provenance(
                canonical_result["provenance"]
            )
            artifact_manager.update_reproducibility_manifest(
                {
                    "data_provenance": canonical_result["provenance"],
                    "result": {
                        "canonical_result": "results/result.json",
                        "equity_curve": "results/equity_curve.json",
                        "trades": "results/trades.json",
                    },
                }
            )

            execution.execution_metrics = {
                "start_timestamp": result.start_timestamp.isoformat(),
                "end_timestamp": result.end_timestamp.isoformat(),
                "initial_capital": result.initial_capital,
                "final_capital": result.final_capital,
                "total_return": result.total_return,
                "trade_count": len(result.trades),
                "max_drawdown": result.max_drawdown,
                "data_provenance": provenance,
                "canonical_result": canonical_result,
            }

            self.execution_service.repository.update(
                execution=execution,
            )

            self._store_records(execution)
            self.execution_service.complete_execution(
                execution=execution,
            )
            update_artifact_status(ExecutionStatus.COMPLETED.value)

            return result

        except Exception as exc:
            logger.exception(
                "Backtest execution failed: execution_id=%s",
                execution.id,
            )

            if execution.status in {
                ExecutionStatus.PENDING,
                ExecutionStatus.RUNNING,
            }:
                try:
                    context = None
                    stage = "backtest_execution"

                    if isinstance(exc, TimeoutError):
                        context = None
                        stage = "engine"
                    elif "dataset" in str(exc).lower() or "market data" in str(exc).lower():
                        context = "market_data_unavailable"
                        stage = "market_data"
                    else:
                        context = "strategy_execution"
                        stage = "engine"

                    error_details = build_backtest_error_payload(
                        exc,
                        execution_id=execution.id,
                        stage=stage,
                        context=context,
                    )
                    self.execution_service.fail_execution(
                        execution=execution,
                        error_message=str(exc) or type(exc).__name__,
                        error_details=error_details,
                    )
                    update_artifact_status(
                        ExecutionStatus.FAILED.value,
                        details=error_details,
                    )
                except Exception:
                    logger.exception(
                        "Could not persist backtest failure: execution_id=%s",
                        execution.id,
                    )

            raise
