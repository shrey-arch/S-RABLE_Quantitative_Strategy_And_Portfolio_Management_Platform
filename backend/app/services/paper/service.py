"""Paper trading account and order engine (Feature 1, P1).

Rules (equity delivery, CNC):
- MARKET: fills at the latest quote plus slippage (buy) or minus slippage
  (sell), rounded to the instrument's tick (up for a buy, down for a sell).
- LIMIT: fills at the quote when it is at or better than the limit.
- SL: waits for the trigger (buy: quote >= trigger; sell: quote <= trigger),
  then works as a LIMIT order at its price.
- SL_M: waits for the trigger, then fills as a MARKET order.
- Only a quote newer than the one seen when the order was placed, and from
  the order's own session, can fill or trigger it.
- Orders placed while the market is closed are after-market orders for the
  next session. Day validity: an order not filled by 15:30 expires.
- Buys reserve cash (quantity x price + slippage + charges); sells need
  holdings not already in other open sells. No short selling, no leverage.
Every number is computed here; the UI only shows it."""

from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Instrument, PaperAccount, PaperCashEntry, PaperFill, PaperHolding, PaperOrder, User
from app.services.paper import clock
from app.services.paper.charges import calculate_charges
from app.services.paper.quotes import Quote, QuoteUnavailable, try_quote, yahoo_symbol

DEFAULT_CASH = Decimal("1000000.00")
MAX_CASH = Decimal("1000000000.00")
MAX_QUANTITY = 1_000_000
LIVE = ("OPEN", "TRIGGER_PENDING")
SIDES = ("BUY", "SELL")
ORDER_TYPES = ("MARKET", "LIMIT", "SL", "SL_M")
CENT = Decimal("0.01")


class PaperError(Exception):
    """A request the rules refuse (422), or a missing price (503)."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def _d(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _money(value) -> Decimal:
    return _d(value).quantize(CENT, rounding=ROUND_HALF_UP)


def _to_tick(price: Decimal, tick: Decimal, rounding) -> Decimal:
    if tick <= 0:
        return price.quantize(CENT, rounding=rounding)
    return ((price / tick).to_integral_value(rounding=rounding) * tick).quantize(Decimal("0.0001"))


def inr(value) -> str:
    """Rs with Indian digit grouping: 1401660.72 -> 'Rs 14,01,660.72'."""
    amount = _money(value)
    sign = "-" if amount < 0 else ""
    whole, frac = f"{abs(amount):.2f}".split(".")
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    text = ",".join(groups + [tail]) if groups else tail
    return f"{sign}Rs {text}.{frac}"


def _on_tick(price: Decimal, tick: Decimal) -> bool:
    return tick <= 0 or (price / tick) == (price / tick).to_integral_value()


# --- account ---------------------------------------------------------------


def _opening(db: Session, account: PaperAccount, note: str) -> None:
    db.add(
        PaperCashEntry(
            account_id=account.id,
            kind="OPENING",
            amount=account.cash,
            balance_after=account.cash,
            note=note,
        )
    )


def get_account(db: Session, user: User, *, lock: bool = False) -> PaperAccount:
    """The user's paper account, created with Rs 10,00,000 on first use."""
    statement = select(PaperAccount).where(PaperAccount.user_id == user.id)
    if lock:
        statement = statement.with_for_update()
    account = db.scalar(statement)
    if account is None:
        account = PaperAccount(
            user_id=user.id,
            initial_cash=DEFAULT_CASH,
            cash=DEFAULT_CASH,
            realised_pnl=Decimal("0"),
            total_charges=Decimal("0"),
            slippage_bps=5.0,
            brokerage_per_order=Decimal("0"),
            watchlist=[],
            reset_count=0,
        )
        db.add(account)
        db.flush()
        _opening(db, account, "Account opened")
        db.commit()
        if lock:
            account = db.scalar(statement)
    return account


def reset_account(db: Session, user: User, initial_cash=None) -> PaperAccount:
    account = get_account(db, user, lock=True)
    cash = _money(initial_cash) if initial_cash is not None else _money(account.initial_cash)
    if cash <= 0 or cash > MAX_CASH:
        raise PaperError("Starting cash must be more than Rs 0 and at most Rs 100 crore.")
    for model in (PaperCashEntry, PaperFill, PaperOrder, PaperHolding):
        db.execute(delete(model).where(model.account_id == account.id))
    account.initial_cash = cash
    account.cash = cash
    account.realised_pnl = Decimal("0")
    account.total_charges = Decimal("0")
    account.reset_count += 1
    account.last_reset_at = clock.now_utc()
    db.flush()
    _opening(db, account, f"Account reset ({account.reset_count})")
    db.commit()
    db.refresh(account)
    return account


def update_settings(db: Session, user: User, *, slippage_bps=None, brokerage_per_order=None) -> PaperAccount:
    account = get_account(db, user, lock=True)
    if slippage_bps is not None:
        account.slippage_bps = float(slippage_bps)
    if brokerage_per_order is not None:
        account.brokerage_per_order = _money(brokerage_per_order)
    db.commit()
    db.refresh(account)
    return account


def set_watchlist(db: Session, user: User, instrument_ids: list[UUID]) -> PaperAccount:
    account = get_account(db, user, lock=True)
    unique = list(dict.fromkeys(str(i) for i in instrument_ids))
    if unique:
        found = {
            str(i)
            for i in db.scalars(select(Instrument.id).where(Instrument.id.in_([UUID(u) for u in unique])))
        }
        missing = [u for u in unique if u not in found]
        if missing:
            raise PaperError("Unknown instrument in the watchlist.")
    account.watchlist = unique
    db.commit()
    db.refresh(account)
    return account


def blocked_cash(db: Session, account: PaperAccount, *, excluding: UUID | None = None) -> Decimal:
    statement = select(PaperOrder.reserved_amount).where(
        PaperOrder.account_id == account.id,
        PaperOrder.side == "BUY",
        PaperOrder.status.in_(LIVE),
    )
    if excluding is not None:
        statement = statement.where(PaperOrder.id != excluding)
    return sum((_d(v) for v in db.scalars(statement) if v is not None), Decimal("0"))


def _held(db: Session, account: PaperAccount, instrument_id) -> PaperHolding | None:
    return db.scalar(
        select(PaperHolding).where(
            PaperHolding.account_id == account.id, PaperHolding.instrument_id == instrument_id
        )
    )


def _selling(db: Session, account: PaperAccount, instrument_id, *, excluding: UUID | None = None) -> int:
    statement = select(PaperOrder.quantity).where(
        PaperOrder.account_id == account.id,
        PaperOrder.instrument_id == instrument_id,
        PaperOrder.side == "SELL",
        PaperOrder.status.in_(LIVE),
    )
    if excluding is not None:
        statement = statement.where(PaperOrder.id != excluding)
    return sum(db.scalars(statement))


# --- orders ----------------------------------------------------------------


@dataclass
class OrderInput:
    side: str
    order_type: str
    quantity: int
    price: Decimal | None
    trigger_price: Decimal | None


def _instrument(db: Session, instrument_id: UUID) -> Instrument:
    instrument = db.get(Instrument, instrument_id)
    if instrument is None:
        raise PaperError("Instrument not found.", status=404)
    if not instrument.is_active:
        raise PaperError("This instrument is inactive.")
    try:
        yahoo_symbol(instrument)
    except QuoteUnavailable as exc:
        raise PaperError(str(exc)) from exc
    return instrument


def _check_shape(order: OrderInput, instrument: Instrument) -> None:
    if order.side not in SIDES:
        raise PaperError("Side must be BUY or SELL.")
    if order.order_type not in ORDER_TYPES:
        raise PaperError("Order type must be MARKET, LIMIT, SL or SL_M.")
    if not isinstance(order.quantity, int) or order.quantity < 1 or order.quantity > MAX_QUANTITY:
        raise PaperError(f"Quantity must be a whole number from 1 to {MAX_QUANTITY:,}.")
    tick = _d(instrument.tick_size)
    needs_price = order.order_type in ("LIMIT", "SL")
    needs_trigger = order.order_type in ("SL", "SL_M")
    if needs_price and (order.price is None or order.price <= 0):
        raise PaperError("A price above 0 is required for LIMIT and SL orders.")
    if not needs_price and order.price is not None:
        raise PaperError("MARKET and SL_M orders take no price.")
    if needs_trigger and (order.trigger_price is None or order.trigger_price <= 0):
        raise PaperError("A trigger price above 0 is required for SL and SL_M orders.")
    if not needs_trigger and order.trigger_price is not None:
        raise PaperError("MARKET and LIMIT orders take no trigger price.")
    for label, value in (("Price", order.price), ("Trigger price", order.trigger_price)):
        if value is not None and not _on_tick(value, tick):
            raise PaperError(f"{label} must be a multiple of the tick size {tick.normalize()}.")
    if order.order_type == "SL":
        if order.side == "BUY" and order.trigger_price > order.price:
            raise PaperError("For a buy SL order the trigger price must be at or below the price.")
        if order.side == "SELL" and order.trigger_price < order.price:
            raise PaperError("For a sell SL order the trigger price must be at or above the price.")


def _check_trigger(order: OrderInput, quote: Quote | None) -> None:
    if quote is None or order.order_type not in ("SL", "SL_M"):
        return
    last = _d(quote.price)
    if order.side == "BUY" and order.trigger_price <= last:
        raise PaperError(f"For a buy stop order the trigger price must be above the last price ({last}).")
    if order.side == "SELL" and order.trigger_price >= last:
        raise PaperError(f"For a sell stop order the trigger price must be below the last price ({last}).")


def _slipped(price: Decimal, side: str, account: PaperAccount, tick: Decimal) -> Decimal:
    factor = _d(account.slippage_bps) / Decimal(10000)
    if side == "BUY":
        return _to_tick(price * (1 + factor), tick, ROUND_CEILING)
    return _to_tick(price * (1 - factor), tick, ROUND_FLOOR)


def _reserve(order: OrderInput, account: PaperAccount, instrument: Instrument, quote: Quote | None) -> Decimal | None:
    """Cash an open BUY holds back: worst expected cost including charges."""
    if order.side != "BUY":
        return None
    tick = _d(instrument.tick_size)
    if order.order_type == "LIMIT":
        price = order.price
    elif order.order_type == "SL":
        price = order.price
    else:
        reference = order.trigger_price if order.order_type == "SL_M" else None
        if reference is None:
            if quote is None:
                raise PaperError("The price could not be loaded, so the order cannot be checked. Try again shortly.", status=503)
            reference = _d(quote.price)
        else:
            reference = max(reference, _d(quote.price)) if quote is not None else reference
        price = _slipped(reference, "BUY", account, tick)
    value = price * order.quantity
    charges = calculate_charges(side="BUY", trade_value=value, brokerage=account.brokerage_per_order)
    return _money(value + _d(charges["total"]))


def _check_funds(db: Session, account: PaperAccount, order: OrderInput, instrument, reserve, *, excluding=None) -> None:
    if order.side == "BUY":
        available = _d(account.cash) - blocked_cash(db, account, excluding=excluding)
        if reserve > available:
            raise PaperError(
                f"Insufficient funds: this order needs {inr(reserve)} and {inr(max(available, Decimal(0)))} is available."
            )
    else:
        holding = _held(db, account, instrument.id)
        held = holding.quantity if holding else 0
        selling = _selling(db, account, instrument.id, excluding=excluding)
        if order.quantity > held - selling:
            raise PaperError(
                f"You can sell at most {max(held - selling, 0)}: you hold {held} and {selling} are in open sell orders. Short selling is not allowed."
            )


def preview_order(db: Session, user: User, instrument_id: UUID, order: OrderInput) -> dict:
    """The estimated price, value, charges and funds check, without placing."""
    account = get_account(db, user)
    instrument = _instrument(db, instrument_id)
    _check_shape(order, instrument)
    quote, problem = try_quote(instrument)
    tick = _d(instrument.tick_size)
    if order.order_type in ("LIMIT", "SL"):
        price = order.price
    elif quote is not None:
        reference = _d(quote.price)
        if order.order_type == "SL_M":
            reference = order.trigger_price
        price = _slipped(reference, order.side, account, tick)
    else:
        price = None
    value = _money(price * order.quantity) if price is not None else None
    charges = (
        calculate_charges(side=order.side, trade_value=value, brokerage=account.brokerage_per_order)
        if value is not None
        else None
    )
    problem_text = None
    try:
        _check_trigger(order, quote)
        reserve = _reserve(order, account, instrument, quote)
        _check_funds(db, account, order, instrument, reserve)
    except PaperError as exc:
        problem_text = str(exc)
    session, after_market = clock.order_session(clock.now_utc())
    return {
        "estimated_price": float(price) if price is not None else None,
        "estimated_value": float(value) if value is not None else None,
        "charges": charges,
        "estimated_total": (
            float(value + _d(charges["total"])) if order.side == "BUY" and value is not None
            else float(value - _d(charges["total"])) if value is not None else None
        ),
        "available_cash": float(_d(account.cash) - blocked_cash(db, account)),
        "quote": quote,
        "quote_problem": problem,
        "session_date": session.isoformat(),
        "after_market": after_market,
        "allowed": problem_text is None and (price is not None),
        "problem": problem_text or (problem if price is None else None),
    }


def place_order(db: Session, user: User, instrument_id: UUID, order: OrderInput) -> PaperOrder:
    account = get_account(db, user, lock=True)
    instrument = _instrument(db, instrument_id)
    _check_shape(order, instrument)
    now = clock.now_utc()
    session, after_market = clock.order_session(now)
    quote, _problem = try_quote(instrument)
    if order.order_type == "MARKET" and not after_market and quote is None:
        raise PaperError("The price could not be loaded, so the order cannot be placed. Try again shortly.", status=503)
    _check_trigger(order, quote)
    reserve = _reserve(order, account, instrument, quote)
    _check_funds(db, account, order, instrument, reserve)
    row = PaperOrder(
        account_id=account.id,
        instrument_id=instrument.id,
        side=order.side,
        order_type=order.order_type,
        product="CNC",
        quantity=order.quantity,
        price=order.price,
        trigger_price=order.trigger_price,
        status="TRIGGER_PENDING" if order.order_type in ("SL", "SL_M") else "OPEN",
        session_date=session,
        after_market=after_market,
        placed_quote_time=None,
        reserved_amount=reserve,
        source="MANUAL",
    )
    db.add(row)
    db.flush()
    if (
        not after_market
        and quote is not None
        and clock.is_market_open(now)
        and quote.time >= clock.session_open(session)
    ):
        _try_fill(db, account, row, instrument, quote, now)
    if row.status in LIVE:
        # Later quotes only: the quote seen now cannot fill the order again.
        row.placed_quote_time = quote.time if quote is not None else None
    db.commit()
    db.refresh(row)
    return row


def _owned_order(db: Session, account: PaperAccount, order_id: UUID, *, lock: bool = False) -> PaperOrder:
    statement = select(PaperOrder).where(PaperOrder.id == order_id, PaperOrder.account_id == account.id)
    if lock:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if row is None:
        raise PaperError("Order not found.", status=404)
    return row


def modify_order(db: Session, user: User, order_id: UUID, *, quantity=None, price=None, trigger_price=None) -> PaperOrder:
    account = get_account(db, user, lock=True)
    row = _owned_order(db, account, order_id, lock=True)
    _expire(db, account, clock.now_utc())
    if row.status not in LIVE:
        raise PaperError(f"Only open orders can be changed; this order is {row.status}.", status=409)
    instrument = db.get(Instrument, row.instrument_id)
    new = OrderInput(
        side=row.side,
        order_type=row.order_type,
        quantity=quantity if quantity is not None else row.quantity,
        price=_d(price) if price is not None else (_d(row.price) if row.price is not None else None),
        trigger_price=(
            _d(trigger_price) if trigger_price is not None
            else (_d(row.trigger_price) if row.trigger_price is not None else None)
        ),
    )
    _check_shape(new, instrument)
    quote, _problem = try_quote(instrument)
    if row.status == "TRIGGER_PENDING":
        _check_trigger(new, quote)
    reserve = _reserve(new, account, instrument, quote)
    _check_funds(db, account, new, instrument, reserve, excluding=row.id)
    row.quantity = new.quantity
    row.price = new.price
    row.trigger_price = new.trigger_price
    row.reserved_amount = reserve
    db.commit()
    db.refresh(row)
    return row


def cancel_order(db: Session, user: User, order_id: UUID) -> PaperOrder:
    account = get_account(db, user, lock=True)
    row = _owned_order(db, account, order_id, lock=True)
    _expire(db, account, clock.now_utc())
    if row.status not in LIVE:
        raise PaperError(f"Only open orders can be cancelled; this order is {row.status}.", status=409)
    row.status = "CANCELLED"
    row.status_message = "Cancelled by you."
    db.commit()
    db.refresh(row)
    return row


# --- matching --------------------------------------------------------------


def _try_fill(db: Session, account: PaperAccount, row: PaperOrder, instrument: Instrument, quote: Quote, now: datetime) -> None:
    """Fill or trigger `row` with `quote` if the rules allow."""
    last = _d(quote.price)
    tick = _d(instrument.tick_size)
    if row.status == "TRIGGER_PENDING":
        trigger = _d(row.trigger_price)
        hit = last >= trigger if row.side == "BUY" else last <= trigger
        if not hit:
            return
        row.triggered_at = now
        if row.order_type == "SL_M":
            _fill(db, account, row, instrument, quote, _slipped(last, row.side, account, tick), now)
            return
        row.status = "OPEN"
    if row.order_type in ("MARKET", "SL_M"):
        _fill(db, account, row, instrument, quote, _slipped(last, row.side, account, tick), now)
        return
    limit = _d(row.price)
    if (row.side == "BUY" and last <= limit) or (row.side == "SELL" and last >= limit):
        _fill(db, account, row, instrument, quote, last, now)


def _fill(db: Session, account: PaperAccount, row: PaperOrder, instrument: Instrument, quote: Quote, price: Decimal, now: datetime) -> None:
    value = _money(price * row.quantity)
    charges = calculate_charges(side=row.side, trade_value=value, brokerage=account.brokerage_per_order)
    total = _d(charges["total"])
    holding = _held(db, account, instrument.id)
    realised = None
    if row.side == "BUY":
        available = _d(account.cash) - blocked_cash(db, account, excluding=row.id)
        cost = value + total
        if cost > available:
            row.status = "REJECTED"
            row.status_message = f"Insufficient funds when the order filled: needed {inr(cost)}, available {inr(max(available, Decimal(0)))}."
            return
        net = -cost
        if holding is None:
            holding = PaperHolding(account_id=account.id, instrument_id=instrument.id, quantity=row.quantity, average_price=price)
            db.add(holding)
        else:
            quantity = holding.quantity + row.quantity
            holding.average_price = ((_d(holding.average_price) * holding.quantity + price * row.quantity) / quantity).quantize(Decimal("0.0001"))
            holding.quantity = quantity
    else:
        held = holding.quantity if holding else 0
        if row.quantity > held:
            row.status = "REJECTED"
            row.status_message = f"Not enough holdings when the order filled: held {held}."
            return
        realised = _money((price - _d(holding.average_price)) * row.quantity)
        net = value - total
        if holding.quantity == row.quantity:
            db.delete(holding)
        else:
            holding.quantity -= row.quantity
    fill = PaperFill(
        order_id=row.id,
        account_id=account.id,
        instrument_id=instrument.id,
        side=row.side,
        quantity=row.quantity,
        price=price,
        quote_price=_d(quote.price),
        quote_time=quote.time,
        trade_value=value,
        charges=charges,
        total_charges=total,
        net_amount=_money(net),
        realised_pnl=realised,
        filled_at=now,
    )
    db.add(fill)
    db.flush()
    account.cash = _money(_d(account.cash) + net)
    account.total_charges = _money(_d(account.total_charges) + total)
    if realised is not None:
        account.realised_pnl = _money(_d(account.realised_pnl) + realised)
    db.add(
        PaperCashEntry(
            account_id=account.id,
            kind=row.side,
            amount=_money(net),
            balance_after=account.cash,
            fill_id=fill.id,
            note=f"{row.side} {row.quantity} {instrument.symbol} @ {price}",
        )
    )
    row.status = "FILLED"
    row.filled_at = now
    row.average_price = price
    row.reserved_amount = None
    row.status_message = None


def _expire(db: Session, account: PaperAccount, now: datetime) -> int:
    local = clock.to_ist(now)
    today = local.date()
    rows = db.scalars(
        select(PaperOrder).where(PaperOrder.account_id == account.id, PaperOrder.status.in_(LIVE))
    ).all()
    count = 0
    for row in rows:
        if row.session_date < today or (row.session_date == today and now >= clock.session_close(today)):
            row.status = "EXPIRED"
            row.status_message = "Not filled by the 15:30 close (day order)."
            row.reserved_amount = None
            count += 1
    return count


def match_account(db: Session, account: PaperAccount, now: datetime | None = None) -> int:
    """Expire stale orders, then fill or trigger live ones on the latest quotes.
    The caller holds the account lock. Returns the number of fills."""
    now = now or clock.now_utc()
    _expire(db, account, now)
    if not clock.is_market_open(now):
        return 0
    today = clock.to_ist(now).date()
    open_at = clock.session_open(today)
    fills = 0
    rows = db.scalars(
        select(PaperOrder)
        .where(PaperOrder.account_id == account.id, PaperOrder.status.in_(LIVE), PaperOrder.session_date == today)
        .order_by(PaperOrder.created_at)
    ).all()
    for row in rows:
        instrument = db.get(Instrument, row.instrument_id)
        quote, _problem = try_quote(instrument)
        if quote is None or quote.time < open_at:
            continue
        if row.placed_quote_time is not None and quote.time <= row.placed_quote_time:
            continue
        _try_fill(db, account, row, instrument, quote, now)
        if row.status == "FILLED":
            fills += 1
    return fills


def refresh_account(db: Session, user: User) -> PaperAccount:
    """Match the user's orders before showing them (pages call this)."""
    account = get_account(db, user, lock=True)
    match_account(db, account)
    db.commit()
    db.refresh(account)
    return account


def match_all(db: Session, now: datetime | None = None) -> int:
    """The background matcher: every account with live orders."""
    now = now or clock.now_utc()
    ids = db.scalars(select(PaperOrder.account_id).where(PaperOrder.status.in_(LIVE)).distinct()).all()
    fills = 0
    for account_id in ids:
        account = db.scalar(select(PaperAccount).where(PaperAccount.id == account_id).with_for_update())
        if account is None:
            continue
        fills += match_account(db, account, now)
        db.commit()
    return fills


# --- read models -----------------------------------------------------------


def holdings_view(db: Session, account: PaperAccount) -> list[dict]:
    rows = db.scalars(select(PaperHolding).where(PaperHolding.account_id == account.id)).all()
    out = []
    for h in rows:
        instrument = db.get(Instrument, h.instrument_id)
        quote, problem = try_quote(instrument)
        average = _d(h.average_price)
        price = _d(quote.price) if quote else None
        value = _money(price * h.quantity) if price is not None else None
        out.append(
            {
                "instrument_id": str(h.instrument_id),
                "symbol": instrument.symbol,
                "quantity": h.quantity,
                "average_price": float(average),
                "invested": float(_money(average * h.quantity)),
                "last_price": float(price) if price is not None else None,
                "quote": quote,
                "quote_problem": problem,
                "market_value": float(value) if value is not None else None,
                "unrealised_pnl": float(_money((price - average) * h.quantity)) if price is not None else None,
            }
        )
    out.sort(key=lambda r: r["symbol"])
    return out


def account_view(db: Session, account: PaperAccount) -> dict:
    holdings = holdings_view(db, account)
    blocked = blocked_cash(db, account)
    priced = all(h["market_value"] is not None for h in holdings)
    holdings_value = sum((_d(h["market_value"]) for h in holdings if h["market_value"] is not None), Decimal("0"))
    unrealised = sum((_d(h["unrealised_pnl"]) for h in holdings if h["unrealised_pnl"] is not None), Decimal("0"))
    invested = sum((_d(h["invested"]) for h in holdings), Decimal("0"))
    from app.services.live.sessions import live_positions_value

    live = _d(live_positions_value(db, account.id))
    equity = _d(account.cash) + holdings_value + live if priced else None
    return {
        "live_positions_value": float(_money(live)),
        "account": account,
        "blocked_cash": float(blocked),
        "available_cash": float(_d(account.cash) - blocked),
        "invested": float(_money(invested)),
        "holdings_value": float(_money(holdings_value)) if priced else None,
        "unrealised_pnl": float(_money(unrealised)) if priced else None,
        "equity": float(_money(equity)) if equity is not None else None,
        "total_pnl": float(_money(equity - _d(account.initial_cash))) if equity is not None else None,
        "holdings_count": len(holdings),
        "all_priced": priced,
    }
