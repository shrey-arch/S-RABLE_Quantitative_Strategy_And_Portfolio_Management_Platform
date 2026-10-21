from datetime import datetime, timezone
from uuid import UUID

from app.enums import ExecutionStatus
from app.executions.lifecycle import can_transition
from app.models import Execution
from app.services.notifications.execution_events import (
    FINISHED,
    notify_execution_finished,
)
from app.repositories.executions.execution_repository import (
    ExecutionRepository,
)


class ExecutionService:
    def __init__(self, db):
        self.repository = ExecutionRepository(db)

    def create_execution(
        self,
        *,
        strategy_id: UUID,
        broker_account_id: UUID | None,
        instrument_id: UUID | None,
        execution_type,
        status,
        timeframe: str,
        initial_capital,
        execution_config: dict | None,
        run_settings: dict | None = None,
    ) -> Execution:
        return self.repository.create(
            strategy_id=strategy_id,
            broker_account_id=broker_account_id,
            instrument_id=instrument_id,
            execution_type=execution_type,
            status=status,
            timeframe=timeframe,
            initial_capital=initial_capital,
            execution_config=execution_config,
            run_settings=run_settings,
        )

    def list_executions(self) -> list[Execution]:
        return self.repository.list()

    def list_for_user(self, *, user_id: UUID, **filters) -> list[Execution]:
        return self.repository.list_for_user(user_id=user_id, **filters)

    def get_for_user(self, *, execution_id: UUID, user_id: UUID) -> Execution | None:
        return self.repository.get_by_id_for_user(
            execution_id=execution_id,
            user_id=user_id,
        )

    def get_execution(
        self,
        *,
        execution_id: UUID,
    ) -> Execution | None:
        return self.repository.get_by_id(
            execution_id=execution_id,
        )

    def get_required_execution(
        self,
        *,
        execution_id: UUID,
    ) -> Execution:
        execution = self.get_execution(
            execution_id=execution_id,
        )

        if not execution:
            raise ValueError("Execution not found.")

        return execution

    def update_execution(
        self,
        *,
        execution: Execution,
        execution_config: dict | None = None,
    ) -> Execution:
        return self.repository.update(
            execution=execution,
            execution_config=execution_config,
        )

    def transition_execution(
        self,
        *,
        execution: Execution,
        target_status: ExecutionStatus,
        error_message: str | None = None,
        error_details: dict | None = None,
    ) -> Execution:
        # Decide on the stored status, not a stale in-memory copy, and keep the
        # row locked until this change is committed.
        if isinstance(execution, Execution):
            self.repository.lock(execution)

        current_status = execution.status

        if not can_transition(
            current_status,
            target_status,
        ):
            raise ValueError(
                f"Invalid execution status transition: "
                f"{current_status.value} -> {target_status.value}."
            )

        if (
            target_status == ExecutionStatus.FAILED
            and not error_message
        ):
            raise ValueError(
                "Error message is required when an execution fails."
            )

        now = datetime.now(timezone.utc)

        if target_status == ExecutionStatus.RUNNING:
            execution.started_at = now
            execution.error_message = None

        if target_status == ExecutionStatus.COMPLETED:
            execution.completed_at = now
            execution.error_message = None

        if target_status == ExecutionStatus.FAILED:
            execution.completed_at = now
            execution.error_message = error_message

            if error_details is not None:
                metrics = dict(execution.execution_metrics or {})
                metrics["error"] = dict(error_details)
                execution.execution_metrics = metrics

        if target_status == ExecutionStatus.CANCELLED:
            execution.completed_at = now
            execution.error_message = None

        execution.status = target_status

        updated = self.repository.update(
            execution=execution,
        )

        # Phase 16: tell the owner the run finished (a real run only).
        if isinstance(updated, Execution) and target_status in FINISHED:
            notify_execution_finished(self.repository.db, updated)

        return updated

    def start_execution(
        self,
        *,
        execution: Execution,
    ) -> Execution:
        return self.transition_execution(
            execution=execution,
            target_status=ExecutionStatus.RUNNING,
        )

    def complete_execution(
        self,
        *,
        execution: Execution,
    ) -> Execution:
        return self.transition_execution(
            execution=execution,
            target_status=ExecutionStatus.COMPLETED,
        )

    def fail_execution(
        self,
        *,
        execution: Execution,
        error_message: str,
        error_details: dict | None = None,
    ) -> Execution:
        return self.transition_execution(
            execution=execution,
            target_status=ExecutionStatus.FAILED,
            error_message=error_message,
            error_details=error_details,
        )

    def cancel_execution(
        self,
        *,
        execution: Execution,
    ) -> Execution:
        return self.transition_execution(
            execution=execution,
            target_status=ExecutionStatus.CANCELLED,
        )

    def delete_execution(
        self,
        *,
        execution: Execution,
    ) -> None:
        self.repository.delete(
            execution=execution,
        )
