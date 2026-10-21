"""Portfolio backtest against Nifty 50 (Feature 4): what the API checks and the
worker job that loads the data, runs app.portfolio_backtest.simulation and
stores the result.

A run is an Execution of type PORTFOLIO_BACKTEST. It belongs to the first chosen
strategy (executions belong to a strategy); every chosen strategy is in its run
settings. Each strategy is backtested as a sleeve on the instrument, parameters
and costs of its latest completed backtest, fixed when the run is submitted.
"""

from __future__ import annotations

import bisect
import logging
import math
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID, uuid4

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.backtesting.broker import SimulatedBroker
from app.backtesting.engine import BacktestEngine
from app.data.calendars import NSEMarketCalendar
from app.db import SessionLocal
from app.enums import ExecutionStatus
from app.ml.factor_definitions import REGIME_RULES, regime_compatibility
from app.ml.factors import calculate_strategy_factors
from app.ml.scoring import DEFAULT_STRATEGY_WEIGHTS, STRATEGY_FACTORS, calculate_composite_score
from app.models import Instrument, RegimeModelRecord, Strategy
from app.portfolio_backtest import simulation as sim
from app.services.executions.execution_service import ExecutionService
from app.services.regime import service as regime_service
from app.services.scoring.service import NO_BACKTEST, NOT_A_TEMPLATE, latest_backtests
from app.services.validation.eligibility import hindsight, validation_statuses
from app.strategies.factory import build_strategy

logger = logging.getLogger(__name__)

IST = sim.IST
# Factors use a trailing window of each instrument's closes up to the rebalance day.
FACTOR_BARS = 300
PAIR_REASON = (
    "Pair strategies trade two instruments against each other, so there is no single "
    "asset to hold; they are not allocated."
)
VERSION = "1.0"


def ist_day(timestamp) -> date:
    stamp = pd.Timestamp(timestamp)
    if stamp.tzinfo is None:
        stamp = stamp.tz_localize("UTC")
    return stamp.tz_convert(IST).date()


def resolve_strategies(
    db: Session, user_id: UUID, strategy_ids: list[UUID], require_validated: bool = False
) -> tuple[list[dict], list[dict]]:
    """The chosen strategies that can be a sleeve (with their source backtest) and
    those that cannot (with why). Raises LookupError if one is not the user's.
    With require_validated (Feature 5), a strategy without an eligible validation
    is left out with its validation reason."""
    ids = list(dict.fromkeys(strategy_ids))
    strategies = {s.id: s for s in db.query(Strategy).filter(Strategy.id.in_(ids), Strategy.user_id == user_id)}
    if len(strategies) != len(ids):
        raise LookupError("One or more strategies were not found.")
    latest = latest_backtests(db, ids)
    validations = validation_statuses(db, strategies.values())
    usable, excluded = [], []
    for strategy_id in ids:
        strategy = strategies[strategy_id]
        run = latest.get(strategy_id)
        validation = plain(validations[strategy_id])
        entry = {"strategy_id": str(strategy_id), "name": strategy.name}
        if require_validated and not validation["eligible"]:
            excluded.append({**entry, "reason": validation["reason"]})
            continue
        if run is None:
            excluded.append({**entry, "reason": NO_BACKTEST})
            continue
        rs = run.run_settings if isinstance(run.run_settings, dict) else {}
        key = rs.get("strategy_key")
        if key not in STRATEGY_FACTORS:
            excluded.append({**entry, "reason": NOT_A_TEMPLATE})
            continue
        if key == "statistical_arbitrage":
            excluded.append({**entry, "reason": PAIR_REASON})
            continue
        instrument = db.get(Instrument, run.instrument_id) if run.instrument_id else None
        if instrument is None:
            excluded.append({**entry, "reason": "The instrument of its latest backtest no longer exists."})
            continue
        usable.append(
            {
                **entry,
                "strategy_key": key,
                "parameters": run.execution_config or {},
                "instrument_id": str(instrument.id),
                "symbol": instrument.symbol,
                "asset": instrument.trading_symbol,
                "source_backtest_id": str(run.id),
                "initial_capital": float(run.initial_capital),
                "quantity": int(rs.get("quantity") or 1),
                "slippage_bps": float(rs.get("slippage_bps") or 0),
                "brokerage_rate": float(rs.get("brokerage_rate") or 0),
                "validation": validation,
            }
        )
    return usable, excluded


def hindsight_notes(usable: list[dict], start: date) -> list[str]:
    """For a run that keeps only validated strategies: which were validated on data
    from inside the backtest period (choosing them by it uses hindsight)."""
    out = []
    for item in usable:
        why = hindsight(item.get("validation") or {}, start)
        if why:
            out.append(f"{item['name']} was {why}.")
    return out


# --- point-in-time inputs ---------------------------------------------------------


def score_at(closes: pd.DataFrame, days: list[date], strategy_key: str, day: date) -> sim.ScoreResult:
    """The composite score on `day` from the instrument's closes up to that day
    (`days`: the IST date of each row of `closes`, in order)."""
    i = bisect.bisect_right(days, day)
    upto = closes.iloc[max(0, i - FACTOR_BARS) : i]
    if upto.empty:
        return None, None, "No stored bar on or before this day."
    try:
        factors = calculate_strategy_factors(strategy_key, upto)
    except ValueError as exc:
        return None, None, f"Not enough history for the factors: {exc}"
    return (
        float(calculate_composite_score(strategy_key, factors, DEFAULT_STRATEGY_WEIGHTS[strategy_key])),
        {k: float(v) for k, v in factors.items()},
        None,
    )


class RegimeAsOf:
    """The regime model's classification on or before a day (features use only
    data up to each classified day)."""

    def __init__(self, record: RegimeModelRecord, classified: pd.DataFrame):
        labels = {row["regime_id"]: row for row in record.model_metadata["labels"]["regimes"]}
        by_day = {}
        for timestamp, row in classified.iterrows():
            label = labels[int(row["regime_id"])]
            by_day[ist_day(timestamp)] = {
                "code": label["code"],
                "name": label["name"],
                "volatility_state": label["volatility_state"],
                "trend_state": label["trend_state"],
                "as_of": ist_day(timestamp).isoformat(),
            }
        self.days = sorted(by_day)
        self.by_day = by_day

    def __call__(self, day: date) -> dict | None:
        i = bisect.bisect_right(self.days, day)
        return self.by_day[self.days[i - 1]] if i else None


def compatible(strategy_key: str, regime: dict) -> tuple[bool, str]:
    result = regime_compatibility(strategy_key, regime)
    return result["status"] != "NOT_COMPATIBLE", (
        f"{REGIME_RULES[strategy_key]['rule']} Regime on this day: {regime['name']}."
    )


# --- the job ------------------------------------------------------------------------


def _sleeve(db: Session, item: dict, start: date, end: date) -> tuple[sim.Sleeve, pd.DataFrame, dict]:
    dataset = regime_service.load_closes(db, UUID(item["instrument_id"]), None, end)
    data = dataset.ohlcv
    if data is None or data.empty:
        raise ValueError(f"{item['symbol']} has no stored daily bars up to {end.isoformat()}.")
    last = ist_day(data.index[-1])
    if last < start:
        raise ValueError(
            f"{item['name']}: {item['symbol']} has no stored daily bars in the period "
            f"(its last bar is on {last.isoformat()})."
        )
    start_at = datetime.combine(start, time.min, tzinfo=IST)
    result = BacktestEngine().run(
        strategy=build_strategy(item["strategy_key"], item["parameters"]),
        data=data,
        execution_id=uuid4(),
        instrument_id=UUID(item["instrument_id"]),
        initial_capital=item["initial_capital"],
        broker=SimulatedBroker(slippage_bps=item["slippage_bps"], brokerage_rate=item["brokerage_rate"]),
        quantity=item["quantity"],
        trade_from=start_at if ist_day(data.index[0]) < start else None,
    )
    values = pd.Series(
        {ist_day(p["timestamp"]): float(p["portfolio_value"]) for p in result.equity_curve}
    )
    values = values[values.index >= start]
    sleeve = sim.Sleeve(
        key=item["strategy_id"],
        name=item["name"],
        strategy_key=item["strategy_key"],
        asset=item["asset"],
        values=values,
    )
    summary = {
        "strategy_id": item["strategy_id"],
        "trades": sum(1 for t in result.trades if ist_day(t["timestamp"]) >= start),
        "first_day": values.index[0].isoformat() if len(values) else None,
    }
    return sleeve, data, summary


def run_portfolio_backtest(db: Session, settings: dict) -> dict:
    """Load everything the simulation needs (from the stored settings) and run it."""
    start = date.fromisoformat(settings["start_date"])
    end = date.fromisoformat(settings["end_date"])
    sleeves, closes, summaries = [], {}, []
    for item in settings["strategies"]:
        sleeve, data, summary = _sleeve(db, item, start, end)
        if len(sleeve.values) == 0:
            raise ValueError(f"{item['name']}: its instrument has no bars in the period.")
        sleeves.append(sleeve)
        closes[sleeve.key] = (data, [ist_day(t) for t in data.index])
        summaries.append({**summary, "name": item["name"], "symbol": item["symbol"]})

    bench = regime_service.load_closes(db, UUID(settings["benchmark_instrument_id"]), None, end).ohlcv
    if bench is None or bench.empty:
        raise ValueError("The benchmark has no stored daily bars.")
    benchmark = pd.Series({ist_day(t): float(c) for t, c in bench["close"].items()})

    regime_at = None
    regime_info = None
    if settings.get("regime_filter"):
        model = settings["regime_model"]
        record = db.get(RegimeModelRecord, UUID(model["id"]))
        if record is None or record.status != regime_service.READY:
            raise ValueError("The regime model of this run is no longer available.")
        _, classified = regime_service.classify_stored(db, record)
        regime_at = RegimeAsOf(record, classified)
        regime_info = model

    keys = {s.key: s.strategy_key for s in sleeves}
    limits = settings["limits"]
    calendar = NSEMarketCalendar()
    inputs = sim.SimulationInputs(
        sleeves=sleeves,
        benchmark=benchmark,
        start=start,
        end=end,
        capital=float(settings["capital"]),
        frequency=settings["frequency"],
        cash_reserve=float(limits["cash_reserve"]),
        max_strategy_weight=float(limits["max_strategy_weight"]),
        max_asset_weight=float(limits["max_asset_weight"]),
        brokerage_rate=float(settings["brokerage_rate"]),
        slippage_bps=float(settings["slippage_bps"]),
        score=lambda sleeve, day: score_at(*closes[sleeve.key], keys[sleeve.key], day),
        regime_at=regime_at,
        compatible=compatible,
        sixty_forty=bool(settings.get("sixty_forty")),
        trading_day=calendar.is_trading_day,
    )
    result = sim.simulate(inputs)
    days = result["days"]
    in_sample = None
    if regime_info and regime_info.get("training_start") and regime_info.get("training_end"):
        first = ist_day(regime_info["training_start"])
        last = ist_day(regime_info.get("in_sample_end") or regime_info["training_end"])
        n = sum(1 for d in days if first <= date.fromisoformat(d) <= last)
        in_sample = {
            "days": n,
            "of_days": len(days),
            "flag": (
                f"The regime model was trained on {n} of the {len(days)} days, so its "
                "classification of those days is in-sample."
                if n
                else None
            ),
        }
    notes = [sim.PRICE_INDEX_NOTE, sim.CASH_NOTE]
    if settings.get("sixty_forty"):
        notes.append(sim.DEBT_NOTE.format(rate=sim.DEBT_RATE))
    notes.append(
        "Scores and regimes on each rebalance day use only data up to that day; each "
        f"strategy's factors use its instrument's last {FACTOR_BARS} daily bars up to that day."
    )
    notes.append(
        "Each sleeve is the strategy's own backtest (its latest backtest's instrument, "
        "parameters, capital, quantity and costs); the portfolio's rebalancing cost is "
        "the traded value x (brokerage + slippage)."
    )
    if settings.get("require_validated"):
        notes.append(
            "Only strategies with a passing validation of their current version were "
            "included (Feature 5)."
        )
        notes.extend(settings.get("hindsight") or [])
    return {
        **result,
        "version": VERSION,
        "sleeves": summaries,
        "regime_model": regime_info,
        "regime_in_sample": in_sample,
        "notes": notes,
        "benchmark": {
            "instrument_id": settings["benchmark_instrument_id"],
            "symbol": settings.get("benchmark_symbol"),
        },
    }


def plain(value):
    """JSON-ready: numpy scalars as Python values, NaN and infinities as None."""
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, (float, np.floating)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    return value


def run_portfolio_backtest_job(
    execution_id: UUID,
    strategy_key: str,
    strategy_config: dict | None,
    start_timestamp: datetime | None,
    end_timestamp: datetime | None,
    quantity: int,
    run_options: dict | None = None,
):
    """Worker entry point (the executor's job signature)."""
    db = SessionLocal()
    service = ExecutionService(db)
    execution = service.get_required_execution(execution_id=execution_id)
    try:
        if execution.status != ExecutionStatus.PENDING:
            return None
        service.start_execution(execution=execution)
        result = run_portfolio_backtest(db, execution.run_settings)
        execution.execution_metrics = {"portfolio_backtest": plain(result)}
        service.repository.update(execution=execution)
        service.complete_execution(execution=execution)
        return None
    except Exception as exc:
        logger.exception("Portfolio backtest failed: execution_id=%s", execution_id)
        db.rollback()
        try:
            execution = service.get_required_execution(execution_id=execution_id)
            if execution.status in {ExecutionStatus.PENDING, ExecutionStatus.RUNNING}:
                service.fail_execution(execution=execution, error_message=str(exc) or type(exc).__name__)
        except Exception:
            logger.exception("Could not store the portfolio backtest failure: %s", execution_id)
        raise
    finally:
        db.close()
