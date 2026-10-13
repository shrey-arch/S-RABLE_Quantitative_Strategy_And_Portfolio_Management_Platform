from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from app.config.settings import settings


logger = logging.getLogger(__name__)


class BacktestArtifactManager:
    """Manages reproducible artifacts for a single backtest execution."""

    def __init__(
        self,
        execution_id: UUID | str,
        *,
        root_dir: Path | str | None = None,
    ) -> None:
        self.execution_id = str(execution_id)
        root = Path(root_dir or settings.backtest_cache_dir)
        self.job_dir = root / "jobs" / self.execution_id

        self.logs_dir = self.job_dir / "logs"
        self.data_dir = self.job_dir / "data"
        self.results_dir = self.job_dir / "results"
        self.temporary_dir = self.job_dir / "tmp"

    def initialize(
        self,
        *,
        request: dict[str, Any],
        config: dict[str, Any],
        status: str = "PENDING",
    ) -> None:
        """Create the package and persist the initial snapshots."""
        for directory in (
            self.logs_dir,
            self.data_dir,
            self.results_dir,
            self.temporary_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)

        self.write_json("request.json", request)
        self.write_json("config.json", config)
        self.update_status(status)

    def write_json(
        self,
        relative_path: str,
        payload: Any,
        *,
        persistent: bool = True,
    ) -> Path:
        """Atomically write JSON inside the execution package."""
        base = self.job_dir if persistent else self.temporary_dir
        target = (base / relative_path).resolve()

        # Prevent absolute paths and traversal outside the selected root.
        allowed_root = base.resolve()
        if target != allowed_root and allowed_root not in target.parents:
            raise ValueError("Artifact path must remain inside its package directory.")

        target.parent.mkdir(parents=True, exist_ok=True)

        fd, temp_name = tempfile.mkstemp(
            prefix=f".{target.name}.",
            suffix=".tmp",
            dir=target.parent,
        )
        temp_path = Path(temp_name)

        try:
            with os.fdopen(fd, "w", encoding="utf-8") as file:
                json.dump(
                    payload,
                    file,
                    indent=2,
                    sort_keys=True,
                    default=self._json_default,
                    allow_nan=False,
                )
                file.write("\n")
                file.flush()
                os.fsync(file.fileno())

            os.replace(temp_path, target)
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise

        return target

    def update_status(
        self,
        status: str,
        *,
        details: dict[str, Any] | None = None,
    ) -> Path:
        payload = {
            "execution_id": self.execution_id,
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if details:
            payload["details"] = details

        return self.write_json("status.json", payload)

    def write_provenance(self, provenance: dict[str, Any]) -> Path:
        return self.write_json("data/provenance.json", provenance)

    def write_result(self, result: dict[str, Any]) -> Path:
        return self.write_json("results/result.json", result)

    def write_equity_curve(self, equity_curve: list[dict[str, Any]]) -> Path:
        return self.write_json("results/equity_curve.json", equity_curve)

    def write_trades(self, trades: list[dict[str, Any]]) -> Path:
        return self.write_json("results/trades.json", trades)

    def write_reproducibility_manifest(self, manifest: dict[str, Any]) -> Path:
        """Persist the inputs and references needed to reproduce a backtest."""
        path = self.job_dir / "reproducibility.json"
        self.write_json("reproducibility.json", manifest)
        return path

    def update_reproducibility_manifest(
        self,
        updates: dict[str, Any],
    ) -> Path:
        """Merge additional details into an existing reproducibility manifest."""
        manifest_path = self.job_dir / "reproducibility.json"

        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        else:
            manifest = {"schema_version": 1}

        if not isinstance(manifest, dict):
            raise ValueError("Reproducibility manifest must contain a JSON object.")

        manifest.update(updates)
        return self.write_json("reproducibility.json", manifest)

    def cleanup_temporary_files(self) -> None:
        """Remove temporary execution files, preserving results and provenance."""
        if self.temporary_dir.exists():
            shutil.rmtree(self.temporary_dir)

    def cleanup_logs(self) -> None:
        """Remove logs according to the caller's retention policy."""
        if self.logs_dir.exists():
            shutil.rmtree(self.logs_dir)

    def cleanup_expired_artifacts(
        self,
        *,
        now: datetime | None = None,
    ) -> dict[str, bool]:
        """Clean expired logs and temporary files for terminal executions only.

        Persistent request/config/status, result, and provenance artifacts are
        deliberately retained. The package must have a terminal status before
        any cleanup is attempted.
        """
        if not self.job_dir.exists():
            return {"logs_removed": False, "temporary_removed": False}

        try:
            status_payload = json.loads(
                (self.job_dir / "status.json").read_text(encoding="utf-8")
            )
            status = status_payload.get("status")
            updated_at = datetime.fromisoformat(status_payload["updated_at"])
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)
        except (OSError, ValueError, KeyError, TypeError):
            logger.warning(
                "Skipping artifact cleanup because status is missing or invalid: %s",
                self.execution_id,
            )
            return {"logs_removed": False, "temporary_removed": False}

        if status not in {"COMPLETED", "FAILED", "CANCELLED"}:
            return {"logs_removed": False, "temporary_removed": False}

        current_time = now or datetime.now(timezone.utc)
        if current_time.tzinfo is None:
            current_time = current_time.replace(tzinfo=timezone.utc)

        logs_removed = False
        temporary_removed = False

        log_days = settings.backtest_log_retention_days
        if (
            self.logs_dir.exists()
            and current_time - updated_at >= timedelta(days=log_days)
        ):
            shutil.rmtree(self.logs_dir)
            logs_removed = True

        temporary_hours = settings.backtest_temporary_retention_hours
        if (
            self.temporary_dir.exists()
            and current_time - updated_at >= timedelta(hours=temporary_hours)
        ):
            shutil.rmtree(self.temporary_dir)
            temporary_removed = True

        return {
            "logs_removed": logs_removed,
            "temporary_removed": temporary_removed,
        }

    @staticmethod
    def _json_default(value: Any) -> Any:
        if isinstance(value, (datetime,)):
            return value.isoformat()
        if isinstance(value, (UUID, Path)):
            return str(value)
        if hasattr(value, "item"):
            return value.item()
        if hasattr(value, "isoformat"):
            return value.isoformat()
        raise TypeError(f"Value is not JSON serializable: {type(value).__name__}")
