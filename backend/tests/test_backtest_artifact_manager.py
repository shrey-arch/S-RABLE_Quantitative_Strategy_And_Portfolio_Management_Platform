import json
from pathlib import Path
from uuid import uuid4

import pytest

from app.services.backtesting.artifact_manager import BacktestArtifactManager


def test_initialize_creates_artifact_package(tmp_path: Path):
    execution_id = uuid4()
    manager = BacktestArtifactManager(execution_id, root_dir=tmp_path)

    manager.initialize(
        request={
            "strategy_key": "momentum",
            "start_timestamp": "2025-01-01T00:00:00",
            "end_timestamp": "2025-02-01T00:00:00",
        },
        config={"lookback": 20, "initial_capital": 100000},
    )

    assert manager.job_dir.is_dir()
    assert (manager.logs_dir).is_dir()
    assert (manager.data_dir).is_dir()
    assert (manager.results_dir).is_dir()
    assert json.loads((manager.job_dir / "request.json").read_text())["strategy_key"] == "momentum"
    assert json.loads((manager.job_dir / "config.json").read_text())["initial_capital"] == 100000
    assert json.loads((manager.job_dir / "status.json").read_text())["status"] == "PENDING"


def test_write_result_and_provenance(tmp_path: Path):
    manager = BacktestArtifactManager(uuid4(), root_dir=tmp_path)
    manager.initialize(request={}, config={})

    manager.write_provenance({"provider": "test", "data_version": "v1"})
    manager.write_result({"total_return": 0.12})
    manager.write_equity_curve([{"timestamp": "2025-01-01", "equity": 1000}])
    manager.write_trades([{"symbol": "TEST", "quantity": 1}])

    assert json.loads((manager.data_dir / "provenance.json").read_text())["provider"] == "test"
    assert json.loads((manager.results_dir / "result.json").read_text())["total_return"] == 0.12
    assert len(json.loads((manager.results_dir / "equity_curve.json").read_text())) == 1
    assert len(json.loads((manager.results_dir / "trades.json").read_text())) == 1


def test_write_json_rejects_path_traversal(tmp_path: Path):
    manager = BacktestArtifactManager(uuid4(), root_dir=tmp_path)
    manager.initialize(request={}, config={})

    with pytest.raises(ValueError, match="inside its package"):
        manager.write_json("../outside.json", {"unsafe": True})


def test_cleanup_temporary_files_preserves_persistent_artifacts(tmp_path: Path):
    manager = BacktestArtifactManager(uuid4(), root_dir=tmp_path)
    manager.initialize(request={"strategy_key": "momentum"}, config={})
    manager.write_provenance({"provider": "test"})
    manager.write_result({"total_return": 0.1})
    manager.write_json("scratch.json", {"temporary": True}, persistent=False)

    manager.cleanup_temporary_files()

    assert not manager.temporary_dir.exists()
    assert (manager.job_dir / "request.json").exists()
    assert (manager.data_dir / "provenance.json").exists()
    assert (manager.results_dir / "result.json").exists()


def test_cleanup_logs_does_not_delete_results_or_provenance(tmp_path: Path):
    manager = BacktestArtifactManager(uuid4(), root_dir=tmp_path)
    manager.initialize(request={}, config={})
    manager.write_provenance({"provider": "test"})
    manager.write_result({"total_return": 0.1})
    (manager.logs_dir / "execution.log").write_text("test log")

    manager.cleanup_logs()

    assert not manager.logs_dir.exists()
    assert (manager.data_dir / "provenance.json").exists()
    assert (manager.results_dir / "result.json").exists()


def test_update_status_records_lifecycle_and_details(tmp_path: Path):
    manager = BacktestArtifactManager(uuid4(), root_dir=tmp_path)
    manager.initialize(request={}, config={})

    manager.update_status("RUNNING")
    running = json.loads((manager.job_dir / "status.json").read_text())
    assert running["status"] == "RUNNING"
    assert running["execution_id"] == manager.execution_id
    assert running["updated_at"]

    manager.update_status(
        "FAILED",
        details={"stage": "market_data", "error": "Data unavailable"},
    )
    failed = json.loads((manager.job_dir / "status.json").read_text())
    assert failed["status"] == "FAILED"
    assert failed["details"] == {
        "stage": "market_data",
        "error": "Data unavailable",
    }


def test_cleanup_expired_artifacts_removes_expired_logs_and_temp_but_preserves_results(
    tmp_path: Path,
    monkeypatch,
):
    from datetime import datetime, timedelta, timezone

    from app.services.backtesting import artifact_manager as artifact_manager_module

    monkeypatch.setattr(
        artifact_manager_module.settings,
        "backtest_log_retention_days",
        30,
    )
    monkeypatch.setattr(
        artifact_manager_module.settings,
        "backtest_temporary_retention_hours",
        24,
    )

    manager = BacktestArtifactManager(uuid4(), root_dir=tmp_path)
    manager.initialize(request={"strategy_key": "momentum"}, config={})
    manager.write_provenance({"provider": "test"})
    manager.write_result({"total_return": 0.1})
    manager.write_json("scratch.json", {"temporary": True}, persistent=False)
    (manager.logs_dir / "execution.log").write_text("old log", encoding="utf-8")

    old_time = datetime.now(timezone.utc) - timedelta(days=31)
    manager.update_status("COMPLETED")
    status_path = manager.job_dir / "status.json"
    payload = json.loads(status_path.read_text(encoding="utf-8"))
    payload["updated_at"] = old_time.isoformat()
    status_path.write_text(json.dumps(payload), encoding="utf-8")

    outcome = manager.cleanup_expired_artifacts()

    assert outcome == {"logs_removed": True, "temporary_removed": True}
    assert not manager.logs_dir.exists()
    assert not manager.temporary_dir.exists()
    assert (manager.job_dir / "request.json").exists()
    assert (manager.job_dir / "config.json").exists()
    assert (manager.job_dir / "status.json").exists()
    assert (manager.results_dir / "result.json").exists()
    assert (manager.data_dir / "provenance.json").exists()


def test_cleanup_expired_artifacts_skips_active_jobs(tmp_path: Path):
    from datetime import datetime, timedelta, timezone

    manager = BacktestArtifactManager(uuid4(), root_dir=tmp_path)
    manager.initialize(request={}, config={})
    manager.write_json("scratch.json", {"temporary": True}, persistent=False)
    (manager.logs_dir / "execution.log").write_text("active log", encoding="utf-8")

    old_time = datetime.now(timezone.utc) - timedelta(days=31)
    status_path = manager.job_dir / "status.json"
    payload = json.loads(status_path.read_text(encoding="utf-8"))
    payload["updated_at"] = old_time.isoformat()
    status_path.write_text(json.dumps(payload), encoding="utf-8")

    outcome = manager.cleanup_expired_artifacts()

    assert outcome == {"logs_removed": False, "temporary_removed": False}
    assert manager.logs_dir.exists()
    assert manager.temporary_dir.exists()


def test_cleanup_expired_artifacts_keeps_unexpired_terminal_job_files(
    tmp_path: Path,
    monkeypatch,
):
    from app.services.backtesting import artifact_manager as artifact_manager_module

    monkeypatch.setattr(
        artifact_manager_module.settings,
        "backtest_log_retention_days",
        30,
    )
    monkeypatch.setattr(
        artifact_manager_module.settings,
        "backtest_temporary_retention_hours",
        24,
    )

    manager = BacktestArtifactManager(uuid4(), root_dir=tmp_path)
    manager.initialize(request={}, config={})
    manager.update_status("FAILED")
    manager.write_json("scratch.json", {"temporary": True}, persistent=False)
    (manager.logs_dir / "execution.log").write_text("recent log", encoding="utf-8")

    outcome = manager.cleanup_expired_artifacts()

    assert outcome == {"logs_removed": False, "temporary_removed": False}
    assert manager.logs_dir.exists()
    assert manager.temporary_dir.exists()


def test_write_reproducibility_manifest(tmp_path: Path):
    manager = BacktestArtifactManager(uuid4(), root_dir=tmp_path)
    manager.initialize(request={}, config={})

    manifest = {
        "schema_version": 1,
        "engine": {"implementation": "app.backtesting.engine.BacktestEngine"},
        "strategy": {
            "key": "tactical_asset_allocation",
            "parameters": {"lookback": 10, "top_k": 3},
        },
        "execution": {
            "initial_capital": 100000,
            "timeframe": "1D",
            "quantity": 1,
        },
    }

    path = manager.write_reproducibility_manifest(manifest)

    assert path == manager.job_dir / "reproducibility.json"
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored["strategy"]["parameters"] == {"lookback": 10, "top_k": 3}
    assert stored["engine"]["implementation"] == (
        "app.backtesting.engine.BacktestEngine"
    )


def test_update_reproducibility_manifest_preserves_existing_fields(
    tmp_path: Path,
):
    manager = BacktestArtifactManager(uuid4(), root_dir=tmp_path)
    manager.initialize(request={}, config={})
    manager.write_reproducibility_manifest(
        {
            "schema_version": 1,
            "strategy": {"key": "example", "parameters": {"lookback": 10}},
        }
    )

    manager.update_reproducibility_manifest(
        {"data_provenance": {"source": "market_data", "records": 100}}
    )

    stored = json.loads(
        (manager.job_dir / "reproducibility.json").read_text(encoding="utf-8")
    )
    assert stored["strategy"]["key"] == "example"
    assert stored["strategy"]["parameters"] == {"lookback": 10}
    assert stored["data_provenance"] == {
        "source": "market_data",
        "records": 100,
    }
