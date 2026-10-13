from app.exceptions.backtesting_errors import (
    BacktestErrorCategory,
    BacktestErrorCode,
)


def test_backtest_error_categories_have_stable_values():
    assert BacktestErrorCategory.VALIDATION == "VALIDATION"
    assert BacktestErrorCategory.MARKET_DATA == "MARKET_DATA"
    assert BacktestErrorCategory.STRATEGY == "STRATEGY"
    assert BacktestErrorCategory.TIMEOUT == "TIMEOUT"
    assert BacktestErrorCategory.WORKER == "WORKER"
    assert BacktestErrorCategory.INTERNAL == "INTERNAL"


def test_backtest_error_codes_have_stable_values():
    assert BacktestErrorCode.INVALID_REQUEST == "BACKTEST_INVALID_REQUEST"
    assert BacktestErrorCode.INVALID_EXECUTION_STATE == "BACKTEST_INVALID_EXECUTION_STATE"
    assert BacktestErrorCode.MARKET_DATA_UNAVAILABLE == "BACKTEST_MARKET_DATA_UNAVAILABLE"
    assert BacktestErrorCode.MARKET_DATA_INVALID == "BACKTEST_MARKET_DATA_INVALID"
    assert BacktestErrorCode.STRATEGY_NOT_FOUND == "BACKTEST_STRATEGY_NOT_FOUND"
    assert BacktestErrorCode.STRATEGY_EXECUTION_FAILED == "BACKTEST_STRATEGY_EXECUTION_FAILED"
    assert BacktestErrorCode.EXECUTION_TIMEOUT == "BACKTEST_EXECUTION_TIMEOUT"
    assert BacktestErrorCode.WORKER_EXIT_UNEXPECTEDLY == "BACKTEST_WORKER_EXIT_UNEXPECTEDLY"
    assert BacktestErrorCode.WORKER_SUBMISSION_FAILED == "BACKTEST_WORKER_SUBMISSION_FAILED"
    assert BacktestErrorCode.INTERNAL_ERROR == "BACKTEST_INTERNAL_ERROR"


def test_backtest_error_codes_are_unique():
    codes = [code.value for code in BacktestErrorCode]
    assert len(codes) == len(set(codes))


def test_timeout_error_is_classified_as_timeout():
    from app.exceptions.backtesting_errors import (
        BacktestErrorCategory,
        BacktestErrorCode,
        classify_backtest_error,
    )

    result = classify_backtest_error(TimeoutError("timed out"))

    assert result.category == BacktestErrorCategory.TIMEOUT
    assert result.code == BacktestErrorCode.EXECUTION_TIMEOUT


def test_value_error_defaults_to_internal_without_context():
    from app.exceptions.backtesting_errors import (
        BacktestErrorCategory,
        BacktestErrorCode,
        classify_backtest_error,
    )

    result = classify_backtest_error(ValueError("invalid input"))

    assert result.category == BacktestErrorCategory.INTERNAL
    assert result.code == BacktestErrorCode.INTERNAL_ERROR


def test_unexpected_error_is_classified_as_internal():
    from app.exceptions.backtesting_errors import (
        BacktestErrorCategory,
        BacktestErrorCode,
        classify_backtest_error,
    )

    result = classify_backtest_error(RuntimeError("unexpected failure"))

    assert result.category == BacktestErrorCategory.INTERNAL
    assert result.code == BacktestErrorCode.INTERNAL_ERROR

def test_explicit_context_classifies_worker_submission_failure():
    from app.exceptions.backtesting_errors import (
        BacktestErrorCategory,
        BacktestErrorCode,
        classify_backtest_error,
    )

    result = classify_backtest_error(
        RuntimeError("worker could not start"),
        context="worker_submission",
    )

    assert result.category == BacktestErrorCategory.WORKER
    assert result.code == BacktestErrorCode.WORKER_SUBMISSION_FAILED


def test_explicit_context_classifies_worker_exit_failure():
    from app.exceptions.backtesting_errors import (
        BacktestErrorCategory,
        BacktestErrorCode,
        classify_backtest_error,
    )

    result = classify_backtest_error(
        RuntimeError("worker exited"),
        context="worker_exit",
    )

    assert result.category == BacktestErrorCategory.WORKER
    assert result.code == BacktestErrorCode.WORKER_EXIT_UNEXPECTEDLY


def test_explicit_context_classifies_strategy_lookup_failure():
    from app.exceptions.backtesting_errors import (
        BacktestErrorCategory,
        BacktestErrorCode,
        classify_backtest_error,
    )

    result = classify_backtest_error(
        LookupError("strategy not found"),
        context="strategy_lookup",
    )

    assert result.category == BacktestErrorCategory.STRATEGY
    assert result.code == BacktestErrorCode.STRATEGY_NOT_FOUND


def test_explicit_context_classifies_strategy_execution_failure():
    from app.exceptions.backtesting_errors import (
        BacktestErrorCategory,
        BacktestErrorCode,
        classify_backtest_error,
    )

    result = classify_backtest_error(
        RuntimeError("strategy failed"),
        context="strategy_execution",
    )

    assert result.category == BacktestErrorCategory.STRATEGY
    assert result.code == BacktestErrorCode.STRATEGY_EXECUTION_FAILED


def test_unknown_context_falls_back_to_default_classification():
    from app.exceptions.backtesting_errors import (
        BacktestErrorCategory,
        BacktestErrorCode,
        classify_backtest_error,
    )

    result = classify_backtest_error(
        ValueError("unexpected"),
        context="unknown_context",
    )

    assert result.category == BacktestErrorCategory.INTERNAL
    assert result.code == BacktestErrorCode.INTERNAL_ERROR

from datetime import datetime
from uuid import UUID

from app.exceptions.backtesting_errors import (
    BacktestErrorCategory,
    BacktestErrorCode,
    build_backtest_error_payload,
)


def test_error_payload_contains_actionable_fields():
    execution_id = UUID("12345678-1234-5678-1234-567812345678")

    payload = build_backtest_error_payload(
        TimeoutError("worker exceeded deadline"),
        execution_id=execution_id,
        stage="worker_monitor",
    )

    assert payload["category"] == BacktestErrorCategory.TIMEOUT.value
    assert payload["code"] == BacktestErrorCode.EXECUTION_TIMEOUT.value
    assert payload["message"] == "worker exceeded deadline"
    assert payload["stage"] == "worker_monitor"
    assert payload["execution_id"] == str(execution_id)
    assert isinstance(datetime.fromisoformat(payload["timestamp"]), datetime)


def test_error_payload_uses_explicit_context_classification():
    payload = build_backtest_error_payload(
        RuntimeError("could not start process"),
        execution_id="execution-123",
        stage="worker_submission",
        context="worker_submission",
    )

    assert payload["category"] == BacktestErrorCategory.WORKER.value
    assert payload["code"] == BacktestErrorCode.WORKER_SUBMISSION_FAILED.value
    assert payload["execution_id"] == "execution-123"


def test_error_payload_has_fallback_message_for_empty_exception():
    payload = build_backtest_error_payload(
        RuntimeError(),
        execution_id="execution-456",
        stage="engine",
    )

    assert payload["message"] == "RuntimeError"
    assert payload["stage"] == "engine"
