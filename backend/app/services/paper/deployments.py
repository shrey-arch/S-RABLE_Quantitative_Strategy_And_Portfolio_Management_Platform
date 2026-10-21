"""Paper trading P2: strategies trading the paper account at each day's close.

A deployment runs a saved strategy (core template or no-code rules) on daily
bars. After each NSE session closes, the daily job:
1. makes sure the day's bar is stored for the deployment's instruments
   (imported from Yahoo Finance if missing);
2. asks the strategy for its decision on all the history up to that close,
   exactly as the backtest engine does for one bar;
3. trades the difference between what it holds and its target with MARKET
   orders filled at that close (plus slippage and Indian charges);
4. records the day (closes, decision, orders, equity, drawdown), checks the
   loss limit, and finishes the deployment at its end date.

Paper delivery trading is long only: a SELL signal (a short in backtests)
means hold nothing, and negative allocations are held at 0. Pair strategies
(statistical arbitrage) need short selling, so they cannot be deployed.

Days are processed in order and each only once, so the job is safe to run
any number of times, and a missed day is caught up on the next run."""

from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.data.loaders import MarketDatasetLoader
from app.enums import NotificationPriority, NotificationType, Timeframe
from app.models import (
    Execution,
    Instrument,
    MarketData,
    Notification,
    PaperAccount,
    PaperDeployment,
    PaperDeploymentDay,
    PaperEquitySnapshot,
    PaperFill,
    PaperHolding,
    PaperOrder,
    User,
)
from app.services.backtesting.backtest_service import BacktestService
from app.services.paper import clock
from app.services.paper import service as paper
from app.services.paper.charges import calculate_charges
from app.services.paper.quotes import Quote, try_quote
from app.strategies.context import StrategyContext
from app.strategies.factory import build_strategy
from app.strategies.signal import SignalAction

logger = logging.getLogger(__name__)

STATUSES = ("ACTIVE", "PAUSED", "STOPPED", "COMPLETED", "FAILED")
# The daily job runs for a session once its close is this far behind.
SETTLE_MINUTES = 30
# A day whose bar is still missing this many trading days later is skipped.
MISSING_BAR_GRACE_DAYS = 2
STAGE5_DAYS = 30
RISK_FREE_RATE = 0.065
PERIODS = 252


class DeploymentError(Exception):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


# --- data ------------------------------------------------------------------


def _import_bars(db: Session, instrument_id: UUID, start: date, end: date) -> None:
    """Download daily bars from Yahoo Finance (tests replace this)."""
    from app.config import settings
    from app.providers.market_data.yahoo_finance import YahooFinanceProvider
    from app.services.market_data.importer import MarketDataImporter

    MarketDataImporter(db, YahooFinanceProvider(db), settings.market_data_provider).run(
        instrument_id=instrument_id, start_date=start, end_date=end
    )


bar_importer = _import_bars


def _has_bar(db: Session, instrument_id: UUID, day: date) -> bool:
    start = clock.session_open(day) - timedelta(hours=10)
    end = clock.session_close(day) + timedelta(hours=8)
    return bool(
        db.scalar(
            select(func.count(MarketData.id)).where(
                MarketData.instrument_id == instrument_id,
                MarketData.timeframe == Timeframe.ONE_DAY,
                MarketData.timestamp >= start,
                MarketData.timestamp < end,
            )
        )
    )


def ensure_bars(db: Session, instrument_ids: list[UUID], day: date) -> list[UUID]:
    """Import the day's bar where it is missing; returns instruments still without one."""
    missing = [i for i in instrument_ids if not _has_bar(db, i, day)]
    for instrument_id in missing:
        try:
            bar_importer(db, instrument_id, day - timedelta(days=7), day)
        except Exception:
            db.rollback()
            logger.warning("Could not import the %s bar for %s", day, instrument_id, exc_info=True)
    return [i for i in missing if not _has_bar(db, i, day)]


def close_on(db: Session, instrument_id: UUID, day: date) -> float | None:
    """The stored close of the day (None when there is no bar)."""
    start = clock.session_open(day) - timedelta(hours=10)
    end = clock.session_close(day) + timedelta(hours=8)
    value = db.scalar(
        select(MarketData.close)
        .where(
            MarketData.instrument_id == instrument_id,
            MarketData.timeframe == Timeframe.ONE_DAY,
            MarketData.timestamp >= start,
            MarketData.timestamp < end,
        )
        .order_by(MarketData.timestamp.desc())
        .limit(1)
    )
    return float(value) if value is not None else None


def _history(db: Session, dep: PaperDeployment, day: date) -> tuple[pd.DataFrame, dict[str, UUID]]:
    loader = MarketDatasetLoader(db)
    end = clock.session_close(day) + timedelta(hours=8)
    ids = [UUID(i) for i in dep.instrument_ids]
    datasets = [loader.load(instrument_id=i, frequency=Timeframe.ONE_DAY, end_timestamp=end) for i in ids]
    if dep.layout == "single":
        return datasets[0].ohlcv, {"default": ids[0]}
    return BacktestService.combine_closes(datasets, dep.layout)


# --- the deployment's own money and holdings ----------------------------------


def sleeve(db: Session, dep: PaperDeployment) -> tuple[Decimal, dict[str, int]]:
    """Cash and holdings of the deployment: its capital plus its own fills."""
    rows = db.execute(
        select(PaperFill.instrument_id, PaperFill.side, PaperFill.quantity, PaperFill.net_amount)
        .join(PaperOrder, PaperOrder.id == PaperFill.order_id)
        .where(PaperOrder.deployment_id == dep.id)
    ).all()
    cash = Decimal(str(dep.capital))
    held: dict[str, int] = {}
    for instrument_id, side, quantity, net in rows:
        cash += Decimal(str(net))
        key = str(instrument_id)
        held[key] = held.get(key, 0) + (quantity if side == "BUY" else -quantity)
    return cash, {k: v for k, v in held.items() if v}


# --- creating and controlling ----------------------------------------------


def create_deployment(
    db: Session,
    user: User,
    *,
    strategy,
    strategy_key: str,
    parameters: dict,
    rules: dict | None,
    layout: str,
    instrument_ids: list[UUID],
    quantity: int,
    capital,
    loss_limit: float | None,
    duration_days: int | None,
    validation_id: UUID | None = None,
) -> PaperDeployment:
    if layout == "pair":
        raise DeploymentError(
            "Pair strategies (statistical arbitrage) need short selling, which delivery "
            "paper trading does not allow."
        )
    account = paper.get_account(db, user, lock=True)
    capital = paper._money(capital)
    available = Decimal(str(account.cash)) - paper.blocked_cash(db, account)
    if capital > available:
        raise DeploymentError(
            f"The capital ({paper.inr(capital)}) is more than the account's available cash ({paper.inr(available)})."
        )
    for instrument_id in instrument_ids:
        instrument = db.get(Instrument, instrument_id)
        try:
            paper.yahoo_symbol(instrument)
        except Exception as exc:
            raise DeploymentError(str(exc)) from exc
    now = clock.now_utc()
    start, _after = clock.order_session(now)
    dep = PaperDeployment(
        account_id=account.id,
        strategy_id=strategy.id,
        validation_id=validation_id,
        name=strategy.name,
        strategy_key=strategy_key,
        strategy_version=strategy.version,
        parameters=parameters or {},
        rules=rules,
        layout=layout,
        instrument_ids=[str(i) for i in instrument_ids],
        quantity=quantity,
        capital=capital,
        loss_limit=loss_limit,
        start_date=start,
        end_date=start + timedelta(days=duration_days) if duration_days else None,
        status="ACTIVE",
        state={},
        peak_equity=capital,
        breaches=0,
    )
    db.add(dep)
    db.flush()
    _notify(
        db,
        account,
        dep,
        NotificationType.INFO,
        NotificationPriority.LOW,
        "Paper deployment started",
        f'"{dep.name}" trades the paper account at each close from {start:%d %b %Y}'
        + (f" until {dep.end_date:%d %b %Y}." if dep.end_date else "."),
    )
    if validation_id is not None:
        update_stage5(db, dep)
    db.commit()
    db.refresh(dep)
    return dep


def owned(db: Session, user: User, deployment_id: UUID, *, lock: bool = False) -> PaperDeployment:
    account = paper.get_account(db, user)
    statement = select(PaperDeployment).where(
        PaperDeployment.id == deployment_id, PaperDeployment.account_id == account.id
    )
    if lock:
        statement = statement.with_for_update()
    dep = db.scalar(statement)
    if dep is None:
        raise DeploymentError("Deployment not found.", status=404)
    return dep


def set_status(db: Session, user: User, deployment_id: UUID, action: str) -> PaperDeployment:
    dep = owned(db, user, deployment_id, lock=True)
    allowed = {
        "pause": ({"ACTIVE"}, "PAUSED", "Paused by you."),
        "resume": ({"PAUSED"}, "ACTIVE", None),
        "stop": ({"ACTIVE", "PAUSED"}, "STOPPED", "Stopped by you."),
    }
    sources, target, reason = allowed[action]
    if dep.status not in sources:
        raise DeploymentError(f"A {dep.status.lower()} deployment cannot be {action}d.", status=409)
    dep.status = target
    dep.status_reason = reason
    if target == "STOPPED":
        dep.completed_at = clock.now_utc()
        if dep.validation_id is not None:
            update_stage5(db, dep, finished=True, stopped=True)
    db.commit()
    db.refresh(dep)
    return dep


# --- the daily step ----------------------------------------------------------


def _decide(db: Session, dep: PaperDeployment, day: date, held: dict[str, int]):
    data, keys = _history(db, dep, day)
    if data is None or data.empty:
        raise DeploymentError("No market data is stored for the instruments.")
    last = data.index[-1]
    if clock.to_ist(last.to_pydatetime()).date() != day:
        return None, None, data, keys
    strategy = build_strategy(dep.strategy_key, dep.rules if dep.rules is not None else dep.parameters)
    prepare = getattr(strategy, "prepare", None)
    if callable(prepare):
        prepare(data)
    primary = dep.instrument_ids[0]
    context = StrategyContext(
        instrument=None,
        timestamp=last.to_pydatetime(),
        market_data={
            "data": data,
            "current_allocations": (dep.state or {}).get("current_allocations"),
            "position_quantity": held.get(primary, 0),
        },
    )
    signal = strategy.generate_signal(context)
    return signal, last, data, keys


def _targets(dep: PaperDeployment, signal, data: pd.DataFrame, keys: dict[str, UUID], held: dict[str, int], equity: Decimal) -> tuple[dict[str, int], list[str]]:
    notes: list[str] = []
    targets = dict(held)
    if signal.allocations:
        if signal.action == SignalAction.HOLD:
            return targets, notes
        for key, weight in signal.allocations.items():
            iid = str(keys[key])
            price = float(data[key].iloc[-1])
            if float(weight) < 0:
                notes.append("A short allocation is held at 0 (delivery is long only).")
            amount = float(equity) * max(float(weight), 0.0)
            targets[iid] = int(amount // price) if price > 0 else 0
        for iid in list(targets):
            if iid not in {str(v) for v in keys.values()}:
                targets[iid] = 0
        return targets, notes
    primary = dep.instrument_ids[0]
    current = held.get(primary, 0)
    if signal.action == SignalAction.BUY:
        targets[primary] = dep.quantity
    elif signal.action == SignalAction.SELL:
        targets[primary] = 0
        if current == 0:
            notes.append("SELL means hold nothing here: delivery paper trading does not short.")
    elif signal.action == SignalAction.EXIT:
        targets[primary] = 0
    else:
        targets[primary] = current
    return targets, notes


def _affordable(quantity: int, price: Decimal, budget: Decimal, brokerage) -> int:
    if quantity <= 0 or price <= 0 or budget <= 0:
        return 0
    q = min(quantity, int(budget / (price * Decimal("1.0015"))))
    while q > 0:
        value = paper._money(price * q)
        cost = value + Decimal(str(calculate_charges(side="BUY", trade_value=value, brokerage=brokerage)["total"]))
        if cost <= budget:
            return q
        q -= 1
    return 0


def _trade(db: Session, account: PaperAccount, dep: PaperDeployment, iid: str, side: str, quantity: int, close: float, day: date) -> dict:
    instrument = db.get(Instrument, UUID(iid))
    at = clock.session_close(day).astimezone(timezone.utc)
    row = PaperOrder(
        account_id=account.id,
        instrument_id=instrument.id,
        side=side,
        order_type="MARKET",
        product="CNC",
        quantity=quantity,
        status="OPEN",
        session_date=day,
        after_market=False,
        placed_quote_time=None,
        reserved_amount=None,
        source="STRATEGY",
        deployment_id=dep.id,
        tags=[],
    )
    db.add(row)
    db.flush()
    quote = Quote(symbol=instrument.symbol, price=close, time=at, previous_close=None, fetched_at=at)
    tick = Decimal(str(instrument.tick_size))
    price = paper._slipped(Decimal(str(close)), side, account, tick)
    paper._fill(db, account, row, instrument, quote, price, at)
    return {
        "order_id": str(row.id),
        "symbol": instrument.symbol,
        "side": side,
        "quantity": quantity,
        "status": row.status,
        "price": float(row.average_price) if row.average_price is not None else None,
        "message": row.status_message,
    }


def process_day(db: Session, dep: PaperDeployment, day: date) -> str:
    """One trading day. Returns 'done', 'wait' (bar not there yet) or 'skipped'."""
    if db.scalar(select(PaperDeploymentDay.id).where(PaperDeploymentDay.deployment_id == dep.id, PaperDeploymentDay.day == day)):
        return "done"
    ids = [UUID(i) for i in dep.instrument_ids]
    missing = ensure_bars(db, ids, day)
    if missing:
        due = clock.to_ist(clock.now_utc()).date()
        later = day
        for _ in range(MISSING_BAR_GRACE_DAYS):
            later = clock.next_trading_day(later)
        if due < later:
            return "wait"
        db.add(PaperDeploymentDay(deployment_id=dep.id, day=day, note="No daily bar for this session; skipped.", targets={}, orders=[], closes={}))
        dep.last_processed_date = day
        return "skipped"
    account = db.scalar(select(PaperAccount).where(PaperAccount.id == dep.account_id).with_for_update())
    cash, held = sleeve(db, dep)
    signal, _last, data, keys = _decide(db, dep, day, held)
    closes = {str(i): close_on(db, i, day) for i in ids}
    if signal is None:
        db.add(PaperDeploymentDay(deployment_id=dep.id, day=day, closes=closes, note="The day's bar is not in the aligned data; skipped.", targets={}, orders=[]))
        dep.last_processed_date = day
        return "skipped"
    value_before = sum((Decimal(str(closes.get(i) or 0)) * q for i, q in held.items()), Decimal("0"))
    targets, notes = _targets(dep, signal, data, keys, held, cash + value_before)
    orders = []
    plan = {i: targets.get(i, 0) - held.get(i, 0) for i in set(targets) | set(held)}
    for iid, delta in sorted(plan.items(), key=lambda kv: kv[1]):  # sells first
        if delta == 0 or closes.get(iid) is None:
            continue
        close = closes[iid]
        if delta < 0:
            holding = db.scalar(select(PaperHolding).where(PaperHolding.account_id == account.id, PaperHolding.instrument_id == UUID(iid)))
            qty = min(-delta, holding.quantity if holding else 0)
            if qty < -delta:
                notes.append(f"Sold {qty} instead of {-delta}: the account holds fewer shares.")
            if qty:
                orders.append(_trade(db, account, dep, iid, "SELL", qty, close, day))
        else:
            cash, _ = sleeve(db, dep)
            account_free = Decimal(str(account.cash)) - paper.blocked_cash(db, account)
            buy_price = paper._slipped(Decimal(str(close)), "BUY", account, Decimal(str(db.get(Instrument, UUID(iid)).tick_size)))
            qty = _affordable(delta, buy_price, min(cash, account_free), account.brokerage_per_order)
            if qty < delta:
                notes.append(f"Bought {qty} instead of {delta}: not enough cash in the deployment's capital.")
            if qty:
                orders.append(_trade(db, account, dep, iid, "BUY", qty, close, day))
    db.flush()
    cash, held = sleeve(db, dep)
    positions_value = sum((Decimal(str(closes.get(i) or 0)) * q for i, q in held.items()), Decimal("0"))
    equity = paper._money(cash + positions_value)
    peak = max(Decimal(str(dep.peak_equity or dep.capital)), equity)
    drawdown = float(1 - equity / peak) if peak > 0 else 0.0
    dep.peak_equity = peak
    if signal.allocations and signal.action != SignalAction.HOLD:
        dep.state = {**(dep.state or {}), "current_allocations": dict(signal.allocations)}
    db.add(
        PaperDeploymentDay(
            deployment_id=dep.id,
            day=day,
            closes=closes,
            signal=signal.action.value,
            allocations=dict(signal.allocations) if signal.allocations else None,
            targets=targets,
            orders=orders,
            cash=paper._money(cash),
            positions_value=paper._money(positions_value),
            equity=equity,
            drawdown=drawdown,
            note=" ".join(notes) or None,
        )
    )
    dep.last_processed_date = day
    loss = 1 - float(equity) / float(dep.capital)
    if dep.loss_limit is not None and loss >= dep.loss_limit:
        dep.breaches += 1
        if dep.validation_id is not None:
            dep.status = "COMPLETED"
            dep.status_reason = f"Loss limit of {dep.loss_limit:.0%} reached; the paper stage ended."
            dep.completed_at = clock.now_utc()
        else:
            dep.status = "PAUSED"
            dep.status_reason = f"Paused: the loss reached the {dep.loss_limit:.0%} limit."
        _notify(db, account, dep, NotificationType.WARNING, NotificationPriority.HIGH, "Paper deployment loss limit reached", f'"{dep.name}" lost {loss:.2%} of its capital. {dep.status_reason}')
    elif dep.end_date is not None and clock.next_trading_day(day) > dep.end_date:
        dep.status = "COMPLETED"
        dep.status_reason = "Reached its end date."
        dep.completed_at = clock.now_utc()
    if dep.status == "COMPLETED":
        if dep.validation_id is not None:
            update_stage5(db, dep, finished=True)
        else:
            _notify(db, account, dep, NotificationType.INFO, NotificationPriority.MEDIUM, "Paper deployment completed", f'"{dep.name}" finished with equity {paper.inr(equity)} (started with {paper.inr(dep.capital)}).')
    elif dep.validation_id is not None:
        update_stage5(db, dep)
    return "done"


def due_day(now: datetime) -> date | None:
    """The latest session whose close has settled (the job processes up to it)."""
    local = clock.to_ist(now)
    today = local.date()
    if clock.is_trading_day(today) and local >= clock.session_close(today) + timedelta(minutes=SETTLE_MINUTES):
        return today
    day = today - timedelta(days=1)
    while not clock.is_trading_day(day):
        day -= timedelta(days=1)
    return day


def run_deployment(db: Session, dep: PaperDeployment, through: date) -> int:
    processed = 0
    day = dep.start_date if dep.last_processed_date is None else clock.next_trading_day(dep.last_processed_date)
    while not clock.is_trading_day(day):
        day += timedelta(days=1)
    while day <= through and dep.status == "ACTIVE":
        if dep.end_date is not None and day > dep.end_date:
            break
        try:
            result = process_day(db, dep, day)
        except Exception as exc:
            db.rollback()
            logger.exception("Paper deployment %s failed on %s", dep.id, day)
            dep = db.get(PaperDeployment, dep.id)
            dep.status = "FAILED"
            dep.status_reason = f"Failed on {day:%d %b %Y}: {exc}"[:300]
            account = db.get(PaperAccount, dep.account_id)
            _notify(db, account, dep, NotificationType.ERROR, NotificationPriority.HIGH, "Paper deployment failed", dep.status_reason)
            if dep.validation_id is not None:
                update_stage5(db, dep, finished=True, stopped=True)
            db.commit()
            break
        db.commit()
        if result == "wait":
            break
        processed += 1
        day = clock.next_trading_day(day)
    return processed


def snapshot_account(db: Session, account: PaperAccount, day: date) -> PaperEquitySnapshot | None:
    """The account's value at the day's close (stored bar close, else the latest quote)."""
    if db.scalar(select(PaperEquitySnapshot.id).where(PaperEquitySnapshot.account_id == account.id, PaperEquitySnapshot.day == day)):
        return None
    holdings = db.scalars(select(PaperHolding).where(PaperHolding.account_id == account.id)).all()
    value = Decimal("0")
    notes = []
    for h in holdings:
        price = close_on(db, h.instrument_id, day)
        if price is None:
            missing = ensure_bars(db, [h.instrument_id], day)
            price = close_on(db, h.instrument_id, day) if not missing else None
        if price is None:
            instrument = db.get(Instrument, h.instrument_id)
            quote, _problem = try_quote(instrument)
            price = quote.price if quote else float(h.average_price)
            notes.append(f"{instrument.symbol} valued at {'the latest quote' if quote else 'its average price'}")
        value += Decimal(str(price)) * h.quantity
    snap = PaperEquitySnapshot(
        account_id=account.id,
        day=day,
        cash=paper._money(account.cash),
        holdings_value=paper._money(value),
        equity=paper._money(Decimal(str(account.cash)) + value),
        note="; ".join(notes) or None,
    )
    db.add(snap)
    db.commit()
    return snap


def run_due(db: Session, now: datetime | None = None, *, user: User | None = None) -> dict:
    """Process every active deployment up to the latest settled close, then
    record each account's closing value. Safe to run any number of times."""
    now = now or clock.now_utc()
    through = due_day(now)
    statement = select(PaperDeployment).where(PaperDeployment.status == "ACTIVE")
    accounts = select(PaperAccount)
    if user is not None:
        account = paper.get_account(db, user)
        statement = statement.where(PaperDeployment.account_id == account.id)
        accounts = accounts.where(PaperAccount.id == account.id)
    days = 0
    deployments = db.scalars(statement.order_by(PaperDeployment.created_at)).all()
    for dep in deployments:
        days += run_deployment(db, dep, through)
    snapshots = 0
    for account in db.scalars(accounts).all():
        if account.created_at.astimezone(clock.IST).date() > through:
            continue
        if snapshot_account(db, account, through) is not None:
            snapshots += 1
    return {"through": through.isoformat(), "deployments": len(deployments), "days_processed": days, "snapshots": snapshots}


# --- performance (P3) --------------------------------------------------------


def metrics(values: list[float], start_value: float) -> dict[str, Any]:
    """Return and risk of a daily equity series (252 days a year; Sharpe uses a
    6.5% a year risk-free rate, compounded per day)."""
    series = [start_value] + values
    returns = [series[i] / series[i - 1] - 1 for i in range(1, len(series)) if series[i - 1] > 0]
    peak, max_dd = series[0], 0.0
    for v in series:
        peak = max(peak, v)
        if peak > 0:
            max_dd = max(max_dd, 1 - v / peak)
    out: dict[str, Any] = {
        "days": len(values),
        "start_value": start_value,
        "end_value": series[-1],
        "total_return": series[-1] / start_value - 1 if start_value else None,
        "max_drawdown": max_dd,
        "annualized_mean_return": None,
        "annualized_volatility": None,
        "sharpe_ratio": None,
        "null_reasons": {},
    }
    if len(returns) >= 2:
        mean = sum(returns) / len(returns)
        var = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
        sd = math.sqrt(var)
        rf = (1 + RISK_FREE_RATE) ** (1 / PERIODS) - 1
        out["annualized_mean_return"] = mean * PERIODS
        out["annualized_volatility"] = sd * math.sqrt(PERIODS)
        if sd > 0:
            out["sharpe_ratio"] = (mean - rf) / sd * math.sqrt(PERIODS)
        else:
            out["null_reasons"]["sharpe_ratio"] = "The value did not change, so volatility is 0."
    else:
        reason = "Needs at least 2 trading days."
        for key in ("annualized_mean_return", "annualized_volatility", "sharpe_ratio"):
            out["null_reasons"][key] = reason
    return out


def trade_stats(db: Session, order_filter) -> dict[str, Any]:
    fills = db.scalars(select(PaperFill).join(PaperOrder, PaperOrder.id == PaperFill.order_id).where(order_filter)).all()
    sells = [f for f in fills if f.side == "SELL" and f.realised_pnl is not None]
    wins = [f for f in sells if float(f.realised_pnl) > 0]
    return {
        "fills": len(fills),
        "closed_trades": len(sells),
        "winning_trades": len(wins),
        "win_rate": len(wins) / len(sells) if sells else None,
        "realised_pnl": float(sum((Decimal(str(f.realised_pnl)) for f in sells), Decimal("0"))),
        "charges": float(sum((Decimal(str(f.total_charges)) for f in fills), Decimal("0"))),
    }


def deployment_performance(db: Session, dep: PaperDeployment) -> dict[str, Any]:
    days = db.scalars(select(PaperDeploymentDay).where(PaperDeploymentDay.deployment_id == dep.id, PaperDeploymentDay.equity.is_not(None)).order_by(PaperDeploymentDay.day)).all()
    out = metrics([float(d.equity) for d in days], float(dep.capital))
    out.update(trade_stats(db, PaperOrder.deployment_id == dep.id))
    return out


# --- validation stage 5 -------------------------------------------------------


def _backtest_annual(report: dict) -> float | None:
    curve = (report.get("stages", {}).get("backtest", {}) or {}).get("equity_curve") or []
    values = [float(p["portfolio_value"]) for p in curve]
    returns = [values[i] / values[i - 1] - 1 for i in range(1, len(values)) if values[i - 1] > 0]
    return sum(returns) / len(returns) * PERIODS if returns else None


def update_stage5(db: Session, dep: PaperDeployment, *, finished: bool = False, stopped: bool = False) -> None:
    """Write the paper stage into the validation report (and its verdict)."""
    from app.validation import thresholds as T
    from app.validation.pipeline import overall_verdict

    execution = db.get(Execution, dep.validation_id) if dep.validation_id else None
    if execution is None:
        return
    metrics_ = dict(execution.execution_metrics or {})
    report = dict(metrics_.get("validation") or {})
    if not report.get("stages"):
        return
    stages = dict(report["stages"])
    perf = deployment_performance(db, dep)
    planned = len(clock.trading_days(dep.start_date, dep.end_date)) if dep.end_date else None
    backtest_annual = _backtest_annual(report)
    paper_annual = perf["annualized_mean_return"]
    retention = (
        paper_annual / backtest_annual
        if paper_annual is not None and backtest_annual is not None and backtest_annual > 0
        else None
    )
    retention_reason = (
        "The backtest's annualised return is not above 0, so retention is not defined."
        if backtest_annual is not None and backtest_annual <= 0
        else perf["null_reasons"].get("annualized_mean_return")
    )
    stage = {
        "key": "paper_trading",
        "name": "Paper trading",
        "status": "RUNNING",
        "checks": [],
        "reason": f"Day {perf['days']} of {planned or '?'} on the paper account.",
        "error": None,
        "paper": {
            "deployment_id": str(dep.id),
            "status": dep.status,
            "start_date": dep.start_date.isoformat(),
            "end_date": dep.end_date.isoformat() if dep.end_date else None,
            "days_done": perf["days"],
            "days_planned": planned,
            "capital": float(dep.capital),
            "equity": perf["end_value"],
            "total_return": perf["total_return"],
            "max_drawdown": perf["max_drawdown"],
            "paper_annualized_mean_return": paper_annual,
            "backtest_annualized_mean_return": backtest_annual,
            "retention": retention,
            "loss_limit": dep.loss_limit,
            "breaches": dep.breaches,
            "fills": perf["fills"],
        },
    }
    if finished:
        stage["checks"] = [
            T.check(
                id="paper_retention",
                label="Paper return retained from the backtest",
                op=">=",
                threshold=T.PAPER_MIN_RETENTION,
                value=retention,
                unit="fraction",
                explanation="Annualised mean daily return on the paper account as a share of the stage 1 backtest's.",
                reason=retention_reason,
            ),
            T.check(
                id="paper_breaches",
                label="Loss-limit breaches",
                op="<=",
                threshold=0,
                value=float(dep.breaches),
                unit="count",
                explanation="Times the deployment's loss reached its limit.",
            ),
        ]
        failed = [c["label"] for c in stage["checks"] if not c["passed"]]
        stage["status"] = "PASS" if not failed else "FAIL"
        stage["reason"] = "Every check passed." if not failed else "Failed: " + "; ".join(failed) + "."
        if stopped:
            stage["status"] = "ERROR"
            stage["reason"] = f"The paper stage did not finish ({dep.status_reason or dep.status.lower()})."
    stages["paper_trading"] = stage
    report["stages"] = stages
    if report.get("verdict", {}).get("status") != "PENDING":
        report["verdict"] = overall_verdict(stages)
    metrics_["validation"] = report
    execution.execution_metrics = metrics_
    if finished:
        account = db.get(PaperAccount, dep.account_id)
        verdict = stage["status"]
        _notify(
            db,
            account,
            dep,
            NotificationType.INFO if verdict == "PASS" else NotificationType.ERROR,
            NotificationPriority.MEDIUM if verdict == "PASS" else NotificationPriority.HIGH,
            f"Paper trading stage {'passed' if verdict == 'PASS' else 'failed' if verdict == 'FAIL' else 'ended'}",
            f'"{dep.name}": {stage["reason"]}',
        )


def _notify(db: Session, account, dep: PaperDeployment, kind, priority, title: str, message: str) -> None:
    """A notification for the account's owner, linked to the validation if any."""
    db.add(
        Notification(
            user_id=account.user_id,
            execution_id=dep.validation_id,
            notification_type=kind,
            priority=priority,
            title=title[:150],
            message=message,
            is_read=False,
            notification_data={"event": "PAPER_DEPLOYMENT", "deployment_id": str(dep.id), "status": dep.status},
        )
    )
