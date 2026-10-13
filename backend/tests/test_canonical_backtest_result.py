from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.backtesting.canonical_result import canonicalize_backtest_result


@pytest.fixture
def result():
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 1, 2, tzinfo=timezone.utc)
    return SimpleNamespace(
        start_timestamp=start,
        end_timestamp=end,
        initial_capital=1000.0,
        final_capital=1100.0,
        total_return=0.1,
        max_drawdown=0.02,
        performance_stats={},
        trades=[
            {
                "timestamp": end,
                "instrument_id": str(uuid4()),
                "side": "BUY",
                "quantity": 2,
                "price": 50.0,
                "brokerage": 1.0,
                "total_charges": 1.5,
            }
        ],
        equity_curve=[
            {"timestamp": start, "portfolio_value": 1000.0},
            {"timestamp": end, "portfolio_value": 1100.0},
        ],
    )


def canonicalize(result):
    return canonicalize_backtest_result(
        result,
        execution_id=uuid4(),
        strategy=SimpleNamespace(name="test_strategy"),
        instrument_id=uuid4(),
        provenance={"data_fingerprint": "test-fingerprint"},
    )


def test_canonical_result_contains_standard_sections(result):
    canonical = canonicalize(result)

    assert canonical["schema_version"] == 1
    assert set(canonical) == {
        "schema_version",
        "metadata",
        "metrics",
        "equity_curve",
        "trades",
        "periodic_returns",
        "provenance",
    }
    assert canonical["metrics"]["total_return"] == 0.1
    assert canonical["metrics"]["net_profit"] == 100.0
    assert canonical["metrics"]["trade_count"] == 1
    assert canonical["metrics"]["sharpe_ratio"] is None
    assert canonical["metrics"]["cagr"] is None
    assert canonical["metrics"]["win_rate"] is None
    assert canonical["trades"][0]["timestamp"].endswith("+00:00")
    assert canonical["equity_curve"][1]["portfolio_value"] == 1100.0


def test_canonical_result_preserves_existing_quantitative_values(result):
    original_return = result.total_return
    original_drawdown = result.max_drawdown
    original_equity = [point.copy() for point in result.equity_curve]

    canonicalize(result)

    assert result.total_return == original_return
    assert result.max_drawdown == original_drawdown
    assert result.equity_curve == original_equity


def test_rejects_missing_trade_fields(result):
    result.trades[0].pop("price")

    with pytest.raises(ValueError, match="missing fields"):
        canonicalize(result)


def test_rejects_non_finite_equity_value(result):
    result.equity_curve[1]["portfolio_value"] = float("nan")

    with pytest.raises(ValueError, match="finite"):
        canonicalize(result)


def test_rejects_reversed_date_range(result):
    result.start_timestamp = datetime(2026, 1, 3, tzinfo=timezone.utc)

    with pytest.raises(ValueError, match="start_timestamp"):
        canonicalize(result)


def test_rejects_out_of_order_equity_timestamps(result):
    result.equity_curve.reverse()

    with pytest.raises(ValueError, match="timestamps must be ordered"):
        canonicalize(result)


def test_rejects_non_positive_initial_capital(result):
    result.initial_capital = 0

    with pytest.raises(ValueError, match="greater than zero"):
        canonicalize(result)


def test_accepts_metrics_from_performance_stats(result):
    result.performance_stats = {
        "cagr": 0.12,
        "sharpe_ratio": 1.4,
        "win_rate": 0.6,
    }

    canonical = canonicalize(result)

    assert canonical["metrics"]["cagr"] == 0.12
    assert canonical["metrics"]["sharpe_ratio"] == 1.4
    assert canonical["metrics"]["win_rate"] == 0.6
from copy import deepcopy


def test_rejects_inconsistent_total_return(result):
    result.total_return = 0.25

    with pytest.raises(ValueError, match="total_return is inconsistent"):
        canonicalize(result)


def test_rejects_empty_equity_curve(result):
    result.equity_curve = []

    with pytest.raises(ValueError, match="equity_curve must not be empty"):
        canonicalize(result)


def test_rejects_final_capital_inconsistent_with_equity(result):
    result.final_capital = 1200.0
    result.total_return = 0.2

    with pytest.raises(ValueError, match="final_capital is inconsistent"):
        canonicalize(result)


def test_rejects_mixed_timezone_awareness_in_date_range(result):
    result.end_timestamp = datetime(2026, 1, 2)

    with pytest.raises(ValueError, match="consistent timezone awareness"):
        canonicalize(result)


def test_rejects_empty_trade_instrument_id(result):
    result.trades[0]["instrument_id"] = None

    with pytest.raises(ValueError, match="instrument_id must not be empty"):
        canonicalize(result)


def test_records_actual_and_requested_period_separately(result):
    requested_start = datetime(2025, 12, 31, tzinfo=timezone.utc)
    requested_end = datetime(2026, 1, 3, tzinfo=timezone.utc)

    canonical = canonicalize_backtest_result(
        result,
        execution_id=uuid4(),
        strategy=SimpleNamespace(name="test_strategy"),
        instrument_id=uuid4(),
        start_timestamp=requested_start,
        end_timestamp=requested_end,
    )

    metadata = canonical["metadata"]
    assert metadata["start_timestamp"] == result.start_timestamp.isoformat()
    assert metadata["end_timestamp"] == result.end_timestamp.isoformat()
    assert metadata["requested_start_timestamp"] == requested_start.isoformat()
    assert metadata["requested_end_timestamp"] == requested_end.isoformat()


def test_rejects_non_json_compatible_provenance(result):
    canonicalizer_args = {
        "execution_id": uuid4(),
        "strategy": SimpleNamespace(name="test_strategy"),
        "instrument_id": uuid4(),
        "provenance": {"unexpected": object()},
    }

    with pytest.raises(ValueError, match="JSON-compatible"):
        canonicalize_backtest_result(result, **canonicalizer_args)

def test_canonical_result_uses_explicit_strategy_key(result):
    canonical = canonicalize_backtest_result(
        result,
        execution_id=uuid4(),
        strategy=SimpleNamespace(name="different_display_name"),
        instrument_id=uuid4(),
        strategy_key="momentum",
    )

    assert canonical["metadata"]["strategy"] == "momentum"


def test_canonical_result_includes_all_mapped_instrument_ids(result):
    primary_id = uuid4()
    mapped_ids = {
        "asset_a": uuid4(),
        "asset_b": uuid4(),
    }

    canonical = canonicalize_backtest_result(
        result,
        execution_id=uuid4(),
        strategy=SimpleNamespace(name="test_strategy"),
        instrument_id=primary_id,
        instrument_ids=mapped_ids,
    )

    actual_ids = canonical["metadata"]["instrument_ids"]
    assert actual_ids == [
        str(primary_id),
        str(mapped_ids["asset_a"]),
        str(mapped_ids["asset_b"]),
    ]
