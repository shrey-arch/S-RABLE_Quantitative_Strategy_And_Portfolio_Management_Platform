from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from uuid import UUID


class BacktestErrorCategory(StrEnum):
    """High-level categories for backtest execution failures."""

    VALIDATION = "VALIDATION"
    MARKET_DATA = "MARKET_DATA"
    STRATEGY = "STRATEGY"
    TIMEOUT = "TIMEOUT"
    WORKER = "WORKER"
    INTERNAL = "INTERNAL"


class BacktestErrorCode(StrEnum):
    """Stable machine-readable codes for backtest failures."""

    INVALID_REQUEST = "BACKTEST_INVALID_REQUEST"
    INVALID_EXECUTION_STATE = "BACKTEST_INVALID_EXECUTION_STATE"
    MARKET_DATA_UNAVAILABLE = "BACKTEST_MARKET_DATA_UNAVAILABLE"
    MARKET_DATA_INVALID = "BACKTEST_MARKET_DATA_INVALID"
    STRATEGY_NOT_FOUND = "BACKTEST_STRATEGY_NOT_FOUND"
    STRATEGY_EXECUTION_FAILED = "BACKTEST_STRATEGY_EXECUTION_FAILED"
    EXECUTION_TIMEOUT = "BACKTEST_EXECUTION_TIMEOUT"
    WORKER_EXIT_UNEXPECTEDLY = "BACKTEST_WORKER_EXIT_UNEXPECTEDLY"
    WORKER_SUBMISSION_FAILED = "BACKTEST_WORKER_SUBMISSION_FAILED"
    INTERNAL_ERROR = "BACKTEST_INTERNAL_ERROR"


@dataclass(frozen=True)
class BacktestErrorClassification:
    category: BacktestErrorCategory
    code: BacktestErrorCode


def classify_backtest_error(
    error: Exception,
    *,
    context: str | None = None,
) -> BacktestErrorClassification:
    """Classify failures using known context, falling back conservatively."""

    context_classifications = {
        "worker_submission": BacktestErrorClassification(
            category=BacktestErrorCategory.WORKER,
            code=BacktestErrorCode.WORKER_SUBMISSION_FAILED,
        ),
        "worker_exit": BacktestErrorClassification(
            category=BacktestErrorCategory.WORKER,
            code=BacktestErrorCode.WORKER_EXIT_UNEXPECTEDLY,
        ),
        "strategy_lookup": BacktestErrorClassification(
            category=BacktestErrorCategory.STRATEGY,
            code=BacktestErrorCode.STRATEGY_NOT_FOUND,
        ),
        "strategy_execution": BacktestErrorClassification(
            category=BacktestErrorCategory.STRATEGY,
            code=BacktestErrorCode.STRATEGY_EXECUTION_FAILED,
        ),
        "market_data_unavailable": BacktestErrorClassification(
            category=BacktestErrorCategory.MARKET_DATA,
            code=BacktestErrorCode.MARKET_DATA_UNAVAILABLE,
        ),
        "market_data_invalid": BacktestErrorClassification(
            category=BacktestErrorCategory.MARKET_DATA,
            code=BacktestErrorCode.MARKET_DATA_INVALID,
        ),
        "validation": BacktestErrorClassification(
            category=BacktestErrorCategory.VALIDATION,
            code=BacktestErrorCode.INVALID_REQUEST,
        ),
        "invalid_execution_state": BacktestErrorClassification(
            category=BacktestErrorCategory.VALIDATION,
            code=BacktestErrorCode.INVALID_EXECUTION_STATE,
        ),
    }

    if context is not None and context in context_classifications:
        return context_classifications[context]

    if isinstance(error, TimeoutError):
        return BacktestErrorClassification(
            category=BacktestErrorCategory.TIMEOUT,
            code=BacktestErrorCode.EXECUTION_TIMEOUT,
        )

    return BacktestErrorClassification(
        category=BacktestErrorCategory.INTERNAL,
        code=BacktestErrorCode.INTERNAL_ERROR,
    )


def build_backtest_error_payload(
    error: Exception,
    *,
    execution_id: UUID | str,
    stage: str,
    context: str | None = None,
) -> dict:
    """Build JSON-serializable, actionable metadata for a failed backtest."""

    classification = classify_backtest_error(error, context=context)

    return {
        "category": classification.category.value,
        "code": classification.code.value,
        "message": str(error) or type(error).__name__,
        "stage": stage,
        "execution_id": str(execution_id),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
