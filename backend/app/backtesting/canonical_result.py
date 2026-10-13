from __future__ import annotations

import json
import math
from datetime import date, datetime
from numbers import Real
from typing import Any
from uuid import UUID


REQUIRED_TRADE_FIELDS = {
    "timestamp",
    "instrument_id",
    "side",
    "quantity",
    "price",
    "brokerage",
    "total_charges",
}

REQUIRED_EQUITY_FIELDS = {"timestamp", "portfolio_value"}


def _timestamp(value: Any, field: str) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time()).isoformat()
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
        except ValueError as exc:
            raise ValueError(f"{field} must be a valid timestamp.") from exc
    raise ValueError(f"{field} must be a datetime or ISO timestamp string.")


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError(f"{field} must be numeric.")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{field} must be finite.")
    return result


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if isinstance(value, Real) and not isinstance(value, bool):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("Result contains a non-finite numeric value.")
        return number
    return value


def canonicalize_backtest_result(
    result: Any,
    *,
    execution_id: UUID | str,
    strategy: Any,
    instrument_id: UUID | str | None,
    start_timestamp: datetime | None = None,
    end_timestamp: datetime | None = None,
    config: dict | None = None,
    provenance: dict | None = None,
    strategy_key: str | None = None,
    instrument_ids: dict[str, UUID] | None = None,
) -> dict:
    """Validate and normalize a backtest result without changing engine output."""

    required = (
        "start_timestamp",
        "end_timestamp",
        "initial_capital",
        "final_capital",
        "total_return",
        "trades",
        "equity_curve",
        "max_drawdown",
    )
    missing = [field for field in required if not hasattr(result, field)]
    if missing:
        raise ValueError(f"Backtest result is missing required fields: {missing}")

    start = _timestamp(
        start_timestamp if start_timestamp is not None else result.start_timestamp,
        "start_timestamp",
    )
    end = _timestamp(
        end_timestamp if end_timestamp is not None else result.end_timestamp,
        "end_timestamp",
    )
    parsed_start = datetime.fromisoformat(start)
    parsed_end = datetime.fromisoformat(end)

    if (parsed_start.utcoffset() is None) != (parsed_end.utcoffset() is None):
        raise ValueError(
            "start_timestamp and end_timestamp must use consistent timezone awareness."
        )
    if parsed_start > parsed_end:
        raise ValueError("start_timestamp must not be after end_timestamp.")

    initial_capital = _number(result.initial_capital, "initial_capital")
    final_capital = _number(result.final_capital, "final_capital")
    total_return = _number(result.total_return, "total_return")
    max_drawdown = _number(result.max_drawdown, "max_drawdown")

    if initial_capital <= 0:
        raise ValueError("initial_capital must be greater than zero.")
    if not isinstance(result.trades, (list, tuple)):
        raise ValueError("trades must be a list.")
    if not isinstance(result.equity_curve, (list, tuple)):
        raise ValueError("equity_curve must be a list.")
    if not result.equity_curve:
        raise ValueError("equity_curve must not be empty.")

    expected_return = (final_capital - initial_capital) / initial_capital
    if not math.isclose(total_return, expected_return, rel_tol=1e-9, abs_tol=1e-12):
        raise ValueError(
            "total_return is inconsistent with initial_capital and final_capital."
        )

    trades = []
    for index, trade in enumerate(result.trades):
        if not isinstance(trade, dict):
            raise ValueError(f"trades[{index}] must be a dictionary.")
        missing_fields = REQUIRED_TRADE_FIELDS - trade.keys()
        if missing_fields:
            raise ValueError(
                f"trades[{index}] is missing fields: {sorted(missing_fields)}"
            )

        side = trade["side"]
        if not isinstance(side, str) or not side:
            raise ValueError(f"trades[{index}].side must be a non-empty string.")

        quantity = _number(trade["quantity"], f"trades[{index}].quantity")
        price = _number(trade["price"], f"trades[{index}].price")
        if quantity <= 0 or price <= 0:
            raise ValueError(f"trades[{index}] quantity and price must be positive.")

        if trade["instrument_id"] is None or not str(trade["instrument_id"]).strip():
            raise ValueError(f"trades[{index}].instrument_id must not be empty.")

        normalized_trade = {
            "timestamp": _timestamp(trade["timestamp"], f"trades[{index}].timestamp"),
            "instrument_id": str(trade["instrument_id"]),
            "side": side,
            "quantity": quantity,
            "price": price,
            "brokerage": _number(trade["brokerage"], f"trades[{index}].brokerage"),
            "total_charges": _number(
                trade["total_charges"], f"trades[{index}].total_charges"
            ),
        }
        trades.append(normalized_trade)

    equity_curve = []
    previous_timestamp = None
    for index, point in enumerate(result.equity_curve):
        if not isinstance(point, dict):
            raise ValueError(f"equity_curve[{index}] must be a dictionary.")
        missing_fields = REQUIRED_EQUITY_FIELDS - point.keys()
        if missing_fields:
            raise ValueError(
                f"equity_curve[{index}] is missing fields: {sorted(missing_fields)}"
            )

        timestamp = _timestamp(
            point["timestamp"], f"equity_curve[{index}].timestamp"
        )
        parsed_timestamp = datetime.fromisoformat(timestamp)
        if previous_timestamp is not None:
            if (parsed_timestamp.utcoffset() is None) != (
                previous_timestamp.utcoffset() is None
            ):
                raise ValueError(
                    "equity_curve timestamps must use consistent timezone awareness."
                )
            if parsed_timestamp < previous_timestamp:
                raise ValueError("equity_curve timestamps must be ordered.")
        previous_timestamp = parsed_timestamp

        equity_curve.append(
            {
                "timestamp": timestamp,
                "portfolio_value": _number(
                    point["portfolio_value"],
                    f"equity_curve[{index}].portfolio_value",
                ),
            }
        )

    if not math.isclose(
        equity_curve[-1]["portfolio_value"],
        final_capital,
        rel_tol=1e-9,
        abs_tol=1e-8,
    ):
        raise ValueError(
            "final_capital is inconsistent with the final equity_curve value."
        )

    stats = getattr(result, "performance_stats", None)
    if stats is None:
        stats = {}
    if not isinstance(stats, dict):
        raise ValueError("performance_stats must be a dictionary.")

    metrics = {
        "total_return": total_return,
        "net_profit": final_capital - initial_capital,
        "cagr": None,
        "sharpe_ratio": None,
        "max_drawdown": max_drawdown,
        "win_rate": None,
        "trade_count": len(trades),
    }
    for key in ("cagr", "sharpe_ratio", "win_rate"):
        if key in stats and stats[key] is not None:
            metrics[key] = _number(stats[key], f"performance_stats.{key}")

    strategy_name = (
        strategy_key
        or getattr(strategy, "strategy_key", None)
        or getattr(strategy, "name", None)
        or type(strategy).__name__
    )

    all_instrument_ids = []
    if instrument_id is not None:
        all_instrument_ids.append(str(instrument_id))
    for mapped_id in (instrument_ids or {}).values():
        normalized_id = str(mapped_id)
        if normalized_id not in all_instrument_ids:
            all_instrument_ids.append(normalized_id)

    canonical = {
        "schema_version": 1,
        "metadata": {
            "execution_id": str(execution_id),
            "strategy": str(strategy_name),
            "instrument_ids": all_instrument_ids,
            "start_timestamp": _timestamp(result.start_timestamp, "result.start_timestamp"),
            "end_timestamp": _timestamp(result.end_timestamp, "result.end_timestamp"),
            "requested_start_timestamp": (
                _timestamp(start_timestamp, "requested_start_timestamp")
                if start_timestamp is not None else None
            ),
            "requested_end_timestamp": (
                _timestamp(end_timestamp, "requested_end_timestamp")
                if end_timestamp is not None else None
            ),
            "config": _json_value(config if config is not None else {}),
        },
        "metrics": metrics,
        "equity_curve": equity_curve,
        "trades": trades,
        "periodic_returns": _json_value(stats.get("periodic_returns")),
        "provenance": _json_value(provenance if provenance is not None else {}),
    }

    try:
        json.dumps(canonical, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError("Canonical result must contain only JSON-compatible values.") from exc

    return canonical
