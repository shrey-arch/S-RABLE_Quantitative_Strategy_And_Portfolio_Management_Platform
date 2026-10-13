from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

import pandas as pd

from app.services.backtesting.artifact_manager import BacktestArtifactManager
from app.backtesting.canonical_result import canonicalize_backtest_result
from app.backtesting.engine import BacktestEngine
from app.data.loaders import MarketDatasetLoader
from app.enums import ExecutionStatus
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
            self.execution_service.start(
                execution=execution,
            )
            update_artifact_status(ExecutionStatus.RUNNING.value)

            try:
                dataset = self.dataset_loader.load(
                    instrument_id=execution.instrument_id,
                    frequency=execution.timeframe,
                    start_timestamp=start_timestamp,
                    end_timestamp=end_timestamp,
                )
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

            data = dataset.ohlcv

            try:
                result = self.engine.run(
                    strategy=strategy,
                    data=data,
                    execution_id=execution.id,
                    instrument_id=execution.instrument_id,
                    initial_capital=execution.initial_capital,
                    instrument_ids=instrument_ids,
                    quantity=quantity,
                )
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
                provenance=dataset.metadata,
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
                "data_provenance": dataset.metadata,
                "canonical_result": canonical_result,
            }

            self.execution_service.repository.update(
                execution=execution,
            )

            self.execution_service.complete(
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
