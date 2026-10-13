from datetime import datetime
from unittest.mock import MagicMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.enums import ExecutionStatus, ExecutionType


client = TestClient(app)


def make_mock_execution():
    execution = MagicMock()

    execution.id = uuid4()
    execution.strategy_id = uuid4()
    execution.broker_account_id = uuid4()
    execution.instrument_id = uuid4()
    execution.execution_type = ExecutionType.BACKTEST
    execution.status = ExecutionStatus.PENDING
    execution.timeframe = "1D"
    execution.initial_capital = 100000
    execution.execution_config = {"lookback": 100}
    execution.execution_metrics = None
    execution.error_message = None
    execution.started_at = None
    execution.completed_at = None

    execution.created_at = MagicMock()
    execution.created_at.isoformat.return_value = (
        "2026-09-26T00:00:00+00:00"
    )

    execution.updated_at = MagicMock()
    execution.updated_at.isoformat.return_value = (
        "2026-09-26T00:00:00+00:00"
    )

    return execution


def test_list_executions():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        mock_service = MagicMock()
        mock_service.list_executions.return_value = [
            make_mock_execution(),
        ]

        execution_routes.ExecutionService = lambda db: mock_service

        response = client.get("/executions")

        assert response.status_code == 200

        data = response.json()

        assert len(data) == 1
        assert data[0]["execution_type"] == "BACKTEST"
        assert data[0]["status"] == "PENDING"
        assert data[0]["timeframe"] == "1D"
        assert data[0]["initial_capital"] == 100000

        mock_service.list_executions.assert_called_once_with()
    finally:
        execution_routes.ExecutionService = original_service


def test_get_execution():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        execution = make_mock_execution()
        execution_id = execution.id

        mock_service = MagicMock()
        mock_service.get_execution.return_value = execution

        execution_routes.ExecutionService = lambda db: mock_service

        response = client.get(f"/executions/{execution_id}")

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(execution_id)
        assert data["strategy_id"] == str(execution.strategy_id)
        assert data["execution_type"] == "BACKTEST"
        assert data["status"] == "PENDING"

        mock_service.get_execution.assert_called_once_with(
            execution_id=execution_id,
        )
    finally:
        execution_routes.ExecutionService = original_service


def test_get_execution_not_found():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        mock_service = MagicMock()
        mock_service.get_execution.return_value = None

        execution_routes.ExecutionService = lambda db: mock_service

        execution_id = uuid4()

        response = client.get(f"/executions/{execution_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Execution not found."

        mock_service.get_execution.assert_called_once_with(
            execution_id=execution_id,
        )
    finally:
        execution_routes.ExecutionService = original_service


def test_create_execution():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        execution = make_mock_execution()

        mock_service = MagicMock()
        mock_service.create_execution.return_value = execution

        execution_routes.ExecutionService = lambda db: mock_service

        strategy_id = execution.strategy_id
        broker_account_id = execution.broker_account_id
        instrument_id = execution.instrument_id

        response = client.post(
            "/executions",
            json={
                "strategy_id": str(strategy_id),
                "broker_account_id": str(broker_account_id),
                "instrument_id": str(instrument_id),
                "execution_type": "BACKTEST",
                "status": "PENDING",
                "timeframe": "1D",
                "initial_capital": 100000,
                "execution_config": {
                    "lookback": 100,
                },
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["execution_type"] == "BACKTEST"
        assert data["status"] == "PENDING"
        assert data["timeframe"] == "1D"
        assert data["initial_capital"] == 100000

        mock_service.create_execution.assert_called_once_with(
            strategy_id=strategy_id,
            broker_account_id=broker_account_id,
            instrument_id=instrument_id,
            execution_type=ExecutionType.BACKTEST,
            status=ExecutionStatus.PENDING,
            timeframe="1D",
            initial_capital=100000,
            execution_config={"lookback": 100},
        )
    finally:
        execution_routes.ExecutionService = original_service


def test_update_execution():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        execution = make_mock_execution()
        execution_id = execution.id

        mock_service = MagicMock()
        mock_service.get_execution.return_value = execution
        mock_service.update_execution.return_value = execution

        execution_routes.ExecutionService = lambda db: mock_service

        response = client.patch(
            f"/executions/{execution_id}",
            json={
                "execution_config": {
                    "lookback": 200,
                },
            },
        )

        assert response.status_code == 200

        mock_service.get_execution.assert_called_once_with(
            execution_id=execution_id,
        )

        mock_service.update_execution.assert_called_once_with(
            execution=execution,
            execution_config={"lookback": 200},
        )
    finally:
        execution_routes.ExecutionService = original_service


def test_update_execution_not_found():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        mock_service = MagicMock()
        mock_service.get_execution.return_value = None

        execution_routes.ExecutionService = lambda db: mock_service

        execution_id = uuid4()

        response = client.patch(
            f"/executions/{execution_id}",
            json={
                "execution_config": {
                    "lookback": 200,
                },
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Execution not found."

        mock_service.update_execution.assert_not_called()
    finally:
        execution_routes.ExecutionService = original_service


def test_delete_execution():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        execution = make_mock_execution()
        execution_id = execution.id

        mock_service = MagicMock()
        mock_service.get_execution.return_value = execution

        execution_routes.ExecutionService = lambda db: mock_service

        response = client.delete(f"/executions/{execution_id}")

        assert response.status_code == 204
        assert response.content == b""

        mock_service.get_execution.assert_called_once_with(
            execution_id=execution_id,
        )

        mock_service.delete_execution.assert_called_once_with(
            execution=execution,
        )
    finally:
        execution_routes.ExecutionService = original_service


def test_delete_execution_not_found():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        mock_service = MagicMock()
        mock_service.get_execution.return_value = None

        execution_routes.ExecutionService = lambda db: mock_service

        execution_id = uuid4()

        response = client.delete(f"/executions/{execution_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Execution not found."

        mock_service.delete_execution.assert_not_called()
    finally:
        execution_routes.ExecutionService = original_service


def test_create_execution_rejects_invalid_input():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        mock_service = MagicMock()
        execution_routes.ExecutionService = lambda db: mock_service

        response = client.post(
            "/executions",
            json={
                "strategy_id": "not-a-uuid",
                "execution_type": "BACKTEST",
                "status": "PENDING",
                "timeframe": "1D",
                "initial_capital": 100000,
            },
        )

        assert response.status_code == 422
        mock_service.create_execution.assert_not_called()
    finally:
        execution_routes.ExecutionService = original_service

def test_start_execution():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        execution = make_mock_execution()
        execution.status = ExecutionStatus.RUNNING
        execution_id = execution.id

        mock_service = MagicMock()
        mock_service.get_execution.return_value = execution
        mock_service.start_execution.return_value = execution

        execution_routes.ExecutionService = lambda db: mock_service

        response = client.post(
            f"/executions/{execution_id}/start",
        )

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(execution_id)
        assert data["status"] == "RUNNING"

        mock_service.start_execution.assert_called_once_with(
            execution=execution,
        )
    finally:
        execution_routes.ExecutionService = original_service


def test_start_execution_not_found():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        mock_service = MagicMock()
        mock_service.get_execution.return_value = None

        execution_routes.ExecutionService = lambda db: mock_service

        execution_id = uuid4()

        response = client.post(
            f"/executions/{execution_id}/start",
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Execution not found."

        mock_service.get_execution.assert_called_once_with(
            execution_id=execution_id,
        )

        mock_service.start_execution.assert_not_called()
    finally:
        execution_routes.ExecutionService = original_service


def test_complete_execution():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        execution = make_mock_execution()
        execution.status = ExecutionStatus.COMPLETED
        execution_id = execution.id

        mock_service = MagicMock()
        mock_service.get_execution.return_value = execution
        mock_service.complete_execution.return_value = execution

        execution_routes.ExecutionService = lambda db: mock_service

        response = client.post(
            f"/executions/{execution_id}/complete",
        )

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(execution_id)
        assert data["status"] == "COMPLETED"

        mock_service.complete_execution.assert_called_once_with(
            execution=execution,
        )
    finally:
        execution_routes.ExecutionService = original_service


def test_complete_execution_not_found():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        mock_service = MagicMock()
        mock_service.get_execution.return_value = None

        execution_routes.ExecutionService = lambda db: mock_service

        execution_id = uuid4()

        response = client.post(
            f"/executions/{execution_id}/complete",
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Execution not found."

        mock_service.get_execution.assert_called_once_with(
            execution_id=execution_id,
        )

        mock_service.complete_execution.assert_not_called()
    finally:
        execution_routes.ExecutionService = original_service

def test_fail_execution():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        execution = make_mock_execution()
        execution.status = ExecutionStatus.FAILED
        execution.error_message = "Backtest failed"
        execution_id = execution.id

        mock_service = MagicMock()
        mock_service.get_execution.return_value = execution
        mock_service.fail_execution.return_value = execution

        execution_routes.ExecutionService = lambda db: mock_service

        response = client.post(
            f"/executions/{execution_id}/fail",
            json={
                "error_message": "Backtest failed",
            },
        )

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(execution_id)
        assert data["status"] == "FAILED"
        assert data["error_message"] == "Backtest failed"

        mock_service.fail_execution.assert_called_once_with(
            execution=execution,
            error_message="Backtest failed",
        )
    finally:
        execution_routes.ExecutionService = original_service


def test_fail_execution_not_found():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        mock_service = MagicMock()
        mock_service.get_execution.return_value = None

        execution_routes.ExecutionService = lambda db: mock_service

        execution_id = uuid4()

        response = client.post(
            f"/executions/{execution_id}/fail",
            json={
                "error_message": "Backtest failed",
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Execution not found."

        mock_service.get_execution.assert_called_once_with(
            execution_id=execution_id,
        )

        mock_service.fail_execution.assert_not_called()
    finally:
        execution_routes.ExecutionService = original_service


def test_fail_execution_requires_error_message():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        mock_service = MagicMock()
        execution_routes.ExecutionService = lambda db: mock_service

        execution_id = uuid4()

        response = client.post(
            f"/executions/{execution_id}/fail",
            json={},
        )

        assert response.status_code == 422
        mock_service.get_execution.assert_not_called()
        mock_service.fail_execution.assert_not_called()
    finally:
        execution_routes.ExecutionService = original_service

def test_cancel_execution():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        execution = make_mock_execution()
        execution.status = ExecutionStatus.CANCELLED
        execution_id = execution.id

        mock_service = MagicMock()
        mock_service.get_execution.return_value = execution
        mock_service.cancel_execution.return_value = execution

        execution_routes.ExecutionService = lambda db: mock_service

        response = client.post(
            f"/executions/{execution_id}/cancel",
        )

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(execution_id)
        assert data["status"] == "CANCELLED"

        mock_service.cancel_execution.assert_called_once_with(
            execution=execution,
        )
    finally:
        execution_routes.ExecutionService = original_service


def test_cancel_execution_not_found():
    import app.api.executions.routes as execution_routes

    original_service = execution_routes.ExecutionService

    try:
        mock_service = MagicMock()
        mock_service.get_execution.return_value = None

        execution_routes.ExecutionService = lambda db: mock_service

        execution_id = uuid4()

        response = client.post(
            f"/executions/{execution_id}/cancel",
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Execution not found."

        mock_service.get_execution.assert_called_once_with(
            execution_id=execution_id,
        )

        mock_service.cancel_execution.assert_not_called()
    finally:
        execution_routes.ExecutionService = original_service

def test_create_backtest():
    import app.api.backtesting.routes as backtest_routes

    original_execution_service = backtest_routes.ExecutionService
    original_executor = backtest_routes._executor

    try:
        execution = make_mock_execution()

        mock_execution_service = MagicMock()
        mock_execution_service.create_execution.return_value = execution

        mock_executor = MagicMock()
        mock_executor.submit.return_value = MagicMock()

        backtest_routes.ExecutionService = (
            lambda db: mock_execution_service
        )
        backtest_routes._executor = mock_executor

        strategy_id = execution.strategy_id
        instrument_id = execution.instrument_id

        response = client.post(
            "/backtests",
            json={
                "strategy_id": str(strategy_id),
                "strategy_key": "momentum",
                "instrument_id": str(instrument_id),
                "timeframe": "1D",
                "initial_capital": 100000,
                "start_timestamp": "2026-01-01T00:00:00+00:00",
                "end_timestamp": "2026-01-31T00:00:00+00:00",
                "execution_config": {
                    "lookback": 20,
                },
                "quantity": 1,
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["execution_type"] == "BACKTEST"
        assert data["status"] == "PENDING"
        assert data["timeframe"] == "1D"
        assert data["initial_capital"] == 100000

        mock_execution_service.create_execution.assert_called_once_with(
            strategy_id=strategy_id,
            broker_account_id=None,
            instrument_id=instrument_id,
            execution_type=ExecutionType.BACKTEST,
            status=ExecutionStatus.PENDING,
            timeframe="1D",
            initial_capital=100000,
            execution_config={"lookback": 20},
        )

        mock_executor.submit.assert_called_once_with(
            execution_id=execution.id,
            strategy_key="momentum",
            strategy_config={"lookback": 20},
            start_timestamp=datetime.fromisoformat(
                "2026-01-01T00:00:00+00:00"
            ),
            end_timestamp=datetime.fromisoformat(
                "2026-01-31T00:00:00+00:00"
            ),
            quantity=1,
        )

    finally:
        backtest_routes.ExecutionService = original_execution_service
        backtest_routes._executor = original_executor



def test_backtest_worker_forwards_job_to_runner():
    from unittest.mock import patch

    from app.services.backtesting.executor import _run_backtest_job

    execution_id = uuid4()

    with patch(
        "app.services.backtesting.executor.BacktestJobRunner"
    ) as runner_class:
        runner = runner_class.return_value
        runner.run.return_value = "backtest-result"

        result = _run_backtest_job(
            execution_id=execution_id,
            strategy_key="momentum",
            strategy_config={"lookback": 20},
            start_timestamp=datetime.fromisoformat(
                "2026-01-01T00:00:00+00:00"
            ),
            end_timestamp=datetime.fromisoformat(
                "2026-01-31T00:00:00+00:00"
            ),
            quantity=1,
        )

        assert result == "backtest-result"

        runner_class.assert_called_once_with()

        runner.run.assert_called_once_with(
            execution_id=execution_id,
            strategy_key="momentum",
            strategy_config={"lookback": 20},
            start_timestamp=datetime.fromisoformat(
                "2026-01-01T00:00:00+00:00"
            ),
            end_timestamp=datetime.fromisoformat(
                "2026-01-31T00:00:00+00:00"
            ),
            quantity=1,
        )

def test_create_backtest_submission_failure_returns_500_if_persistence_fails():
    import app.api.backtesting.routes as backtest_routes

    original_execution_service = backtest_routes.ExecutionService
    original_executor = backtest_routes._executor

    try:
        execution = make_mock_execution()
        execution.status = ExecutionStatus.PENDING

        mock_execution_service = MagicMock()
        mock_execution_service.create_execution.return_value = execution
        mock_execution_service.fail.side_effect = OSError(
            "Database unavailable"
        )

        mock_executor = MagicMock()
        mock_executor.submit.side_effect = RuntimeError(
            "Worker could not start"
        )

        backtest_routes.ExecutionService = (
            lambda db: mock_execution_service
        )
        backtest_routes._executor = mock_executor

        response = client.post(
            "/backtests",
            json={
                "strategy_id": str(execution.strategy_id),
                "strategy_key": "momentum",
                "instrument_id": str(execution.instrument_id),
                "timeframe": "1D",
                "initial_capital": 100000,
                "start_timestamp": "2026-01-01T00:00:00+00:00",
                "end_timestamp": "2026-01-31T00:00:00+00:00",
                "execution_config": {"lookback": 20},
                "quantity": 1,
            },
        )

        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to submit backtest job."

        mock_execution_service.fail_execution.assert_called_once()
        failure_kwargs = (
            mock_execution_service.fail_execution.call_args.kwargs
        )
        assert failure_kwargs["execution"] is execution
        assert failure_kwargs["error_message"] == "Worker could not start"
        error_details = failure_kwargs["error_details"]
        assert error_details["category"] == "WORKER"
        assert error_details["code"] == "BACKTEST_WORKER_SUBMISSION_FAILED"
        assert error_details["stage"] == "worker_submission"
        assert error_details["execution_id"] == str(execution.id)
    finally:
        backtest_routes.ExecutionService = original_execution_service
        backtest_routes._executor = original_executor
