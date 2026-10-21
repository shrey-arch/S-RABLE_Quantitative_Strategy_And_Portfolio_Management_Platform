"""Intraday (MIS) fills of a live session in the user's paper account (Feature 7).

Virtual money only. A session trades its own position: long or short, no
leverage (the position value never exceeds the session's capital), squared off
before the close. Each fill is a paper order (product MIS, source LIVE) and a
paper fill with the intraday charges, and moves the account's cash like any
paper fill; the position itself lives on the session (MIS positions are never
holdings)."""

from __future__ import annotations

from datetime import datetime
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal

from sqlalchemy.orm import Session

from app.models import Instrument, LiveSession, LiveSessionEvent, PaperAccount, PaperCashEntry, PaperFill, PaperOrder
from app.services.paper import service as paper
from app.services.paper.charges import calculate_mis_charges

CENT = Decimal("0.01")
AVG = Decimal("0.0001")


def _d(value) -> Decimal:
    return Decimal(str(value))


def slipped(price, side: str, slippage_bps: float, tick) -> Decimal:
    """The bar's close moved against the trade by the slippage, on the tick grid."""
    factor = _d(slippage_bps) / Decimal(10000)
    tick = _d(tick)
    if side == "BUY":
        return paper._to_tick(_d(price) * (1 + factor), tick, ROUND_CEILING)
    return paper._to_tick(_d(price) * (1 - factor), tick, ROUND_FLOOR)


def event(db: Session, s: LiveSession, kind: str, message: str, market_time: datetime | None, **data) -> LiveSessionEvent:
    row = LiveSessionEvent(session_id=s.id, kind=kind, market_time=market_time, message=message[:500], data=data)
    db.add(row)
    return row


def apply_fill(s: LiveSession, side: str, quantity: int, price: Decimal) -> Decimal | None:
    """Update the session's signed position and average price; returns the
    realised P&L of the part that closed (None when nothing closed)."""
    q = s.position_qty
    avg = _d(s.average_price) if s.average_price is not None else None
    d = quantity if side == "BUY" else -quantity
    if q == 0 or (q > 0) == (d > 0):
        total = abs(q) + quantity
        s.average_price = (((avg or Decimal(0)) * abs(q) + price * quantity) / total).quantize(AVG)
        s.position_qty = q + d
        return None
    closing = min(abs(q), quantity)
    sign = 1 if q > 0 else -1
    realised = ((price - avg) * closing * sign).quantize(CENT)
    s.realised_pnl = _d(s.realised_pnl) + realised
    new = q + d
    if new == 0:
        s.average_price = None
    elif (new > 0) != (q > 0):
        s.average_price = price  # flipped: the rest opened at this price
    s.position_qty = new
    return realised


def place(
    db: Session,
    s: LiveSession,
    account: PaperAccount,
    instrument: Instrument,
    side: str,
    quantity: int,
    close: float,
    at: datetime,
    reason: str,
) -> dict | None:
    """A MARKET MIS order filled at the bar close +/- slippage, with the intraday
    charges. Returns the fill as a dict, or None (and a RISK event) when refused."""
    price = slipped(close, side, s.slippage_bps, instrument.tick_size)
    value = (price * quantity).quantize(CENT)
    charges = calculate_mis_charges(side=side, trade_value=value, brokerage=account.brokerage_per_order)
    total = _d(charges["total"])
    if side == "BUY":
        available = _d(account.cash) - paper.blocked_cash(db, account)
        if value + total > available:
            event(
                db,
                s,
                "RISK",
                f"Refused: buying {quantity} needs {paper.inr(value + total)}, the account has {paper.inr(max(available, Decimal(0)))} available.",
                at,
                check="funds",
            )
            return None
        net = -(value + total)
    else:
        net = value - total
    row = PaperOrder(
        account_id=account.id,
        instrument_id=instrument.id,
        side=side,
        order_type="MARKET",
        product="MIS",
        quantity=quantity,
        status="FILLED",
        session_date=s.session_date,
        after_market=False,
        placed_quote_time=at,
        filled_at=at,
        average_price=price,
        source="LIVE",
        live_session_id=s.id,
        note=reason[:1000],
        tags=[],
    )
    db.add(row)
    db.flush()
    realised = apply_fill(s, side, quantity, price)
    fill = PaperFill(
        order_id=row.id,
        account_id=account.id,
        instrument_id=instrument.id,
        side=side,
        quantity=quantity,
        price=price,
        quote_price=_d(close),
        quote_time=at,
        trade_value=value,
        charges=charges,
        total_charges=total,
        net_amount=net.quantize(CENT),
        realised_pnl=realised,
        filled_at=at,
    )
    db.add(fill)
    db.flush()
    account.cash = (_d(account.cash) + net).quantize(CENT)
    account.total_charges = (_d(account.total_charges) + total).quantize(CENT)
    if realised is not None:
        account.realised_pnl = (_d(account.realised_pnl) + realised).quantize(CENT)
    db.add(
        PaperCashEntry(
            account_id=account.id,
            kind=side,
            amount=net.quantize(CENT),
            balance_after=account.cash,
            fill_id=fill.id,
            note=f"{side} {quantity} {instrument.symbol} @ {price} (intraday, live session)",
        )
    )
    s.charges = (_d(s.charges) + total).quantize(CENT)
    s.order_count += 1
    out = {
        "order_id": str(row.id),
        "fill_id": str(fill.id),
        "side": side,
        "quantity": quantity,
        "price": float(price),
        "close": float(close),
        "value": float(value),
        "charges": charges,
        "realised_pnl": float(realised) if realised is not None else None,
        "position": s.position_qty,
        "reason": reason,
    }
    event(db, s, "FILL", f"{side} {quantity} {instrument.symbol} @ {price} ({reason})", at, **out)
    return out


def equity(s: LiveSession, price: float | None) -> dict:
    """The session's money now: capital + realised + unrealised - charges."""
    unrealised = Decimal(0)
    if s.position_qty and s.average_price is not None and price is not None:
        unrealised = ((_d(price) - _d(s.average_price)) * s.position_qty).quantize(CENT)
    realised = _d(s.realised_pnl)
    charges = _d(s.charges)
    value = _d(s.capital) + realised + unrealised - charges
    return {
        "equity": float(value.quantize(CENT)),
        "realised_pnl": float(realised),
        "unrealised_pnl": float(unrealised),
        "charges": float(charges),
        "net_pnl": float((realised + unrealised - charges).quantize(CENT)),
        "position_value": float((abs(s.position_qty) * _d(price)).quantize(CENT)) if price is not None else None,
    }
