"""Feature 1 (P1): paper trading account, quotes, orders, fills and charges.

Quotes come from a stand-in provider and the clock is fixed, so every fill,
charge and balance is checked against hand-worked values. Real Yahoo calls
never happen in tests."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import Exchange, InstrumentType
from app.main import app
from app.models import Instrument, PaperAccount, PaperCashEntry, User
from app.services.instruments.instrument_service import InstrumentService
from app.services.paper import clock, quotes
from app.services.paper import service as paper
from app.services.paper.charges import calculate_charges
from app.services.paper.quotes import Quote, QuoteUnavailable

client = TestClient(app)
IST = clock.IST


def ist(day: str, hm: str) -> datetime:
    return datetime.fromisoformat(f"{day}T{hm}:00").replace(tzinfo=IST).astimezone(timezone.utc)


class FakeQuotes:
    def __init__(self):
        self.prices: dict[str, tuple[float, datetime]] = {}
        self.calls = 0

    def set(self, symbol: str, price: float, at: datetime):
        self.prices[f"{symbol}.NS"] = (price, at)
        quotes._cache.clear()

    def fetch(self, yahoo_symbol: str) -> Quote:
        self.calls += 1
        if yahoo_symbol not in self.prices:
            raise QuoteUnavailable(f"No price from Yahoo Finance for {yahoo_symbol}.")
        price, at = self.prices[yahoo_symbol]
        return Quote(symbol=yahoo_symbol, price=price, time=at, previous_close=round(price * 0.99, 2))


class Clock:
    def __init__(self, monkeypatch):
        self.at = ist("2026-10-14", "10:00")
        monkeypatch.setattr(clock, "now_utc", lambda: self.at)

    def set(self, day: str, hm: str):
        self.at = ist(day, hm)


@pytest.fixture
def world(monkeypatch):
    db = SessionLocal()
    user = User(full_name="Paper", email=f"pp-{uuid4().hex[:8]}@example.com", password_hash="x")
    other = User(full_name="Other", email=f"po-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add_all([user, other])
    db.commit()
    tag = uuid4().hex[:5].upper()
    service = InstrumentService(db)
    made = []
    for name, tick in (("PAPA", 0.05), ("PAPB", 0.05)):
        made.append(
            service.create_instrument(
                symbol=f"{name}{tag}",
                trading_symbol=f"{name}{tag}-EQ",
                name=f"Paper {name}",
                exchange=Exchange.NSE,
                instrument_type=InstrumentType.EQUITY,
                isin=None,
                lot_size=1,
                tick_size=tick,
            )
        )
    fake = FakeQuotes()
    quotes.set_quote_provider(fake)
    now = Clock(monkeypatch)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {"db": db, "user": user, "other": other, "a": made[0], "b": made[1], "quotes": fake, "clock": now}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        quotes.set_quote_provider(None)
        db.rollback()
        db.execute(delete(PaperAccount).where(PaperAccount.user_id.in_([user.id, other.id])))
        db.execute(delete(Instrument).where(Instrument.id.in_([i.id for i in made])))
        db.execute(delete(User).where(User.id.in_([user.id, other.id])))
        db.commit()
        db.close()


def as_user(user):
    app.dependency_overrides[get_current_user] = lambda: user


def order(world, key="a", **body):
    data = {"instrument_id": str(world[key].id), "side": "BUY", "order_type": "MARKET", "quantity": 10}
    data.update(body)
    return client.post("/paper/orders", json=data)


def account():
    response = client.get("/paper/account")
    assert response.status_code == 200, response.text
    return response.json()


def at(world, hm: str, day: str = "2026-10-14"):
    return ist(day, hm)


# --- account ---------------------------------------------------------------


def test_routes_need_login():
    for method, path in (("get", "/paper/account"), ("get", "/paper/orders"), ("post", "/paper/orders"), ("get", "/paper/holdings")):
        assert getattr(client, method)(path).status_code == 401


def test_new_account_has_ten_lakh_and_states_the_price_source(world):
    data = account()
    assert data["initial_cash"] == data["cash"] == data["available_cash"] == data["equity"] == 1_000_000.0
    assert data["blocked_cash"] == 0 and data["holdings_count"] == 0 and data["total_pnl"] == 0
    assert data["slippage_bps"] == 5.0 and data["brokerage_per_order"] == 0
    assert data["price_source"] == {"name": "Yahoo Finance", "delayed": True, "note": quotes.DELAY_NOTE}
    assert data["market"]["is_open"] is True and data["simulation_only"] is True
    # The same account on every call; one opening ledger entry.
    assert account()["id"] == data["id"]
    entries = world["db"].scalars(select(PaperCashEntry).where(PaperCashEntry.account_id == data["id"])).all()
    assert [e.kind for e in entries] == ["OPENING"]


def test_market_status_outside_hours(world):
    world["clock"].set("2026-10-16", "18:00")  # Friday evening
    market = account()["market"]
    assert market["is_open"] is False
    assert market["next_open"].startswith("2026-10-19T09:15")


# --- market orders and charges ----------------------------------------------


def test_market_buy_fills_at_quote_plus_slippage_with_indian_charges(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    response = order(world, quantity=10)
    assert response.status_code == 201, response.text
    placed = response.json()
    # 1000 x (1 + 5 bps) = 1000.50 (on the 0.05 tick).
    assert placed["status"] == "FILLED" and placed["average_price"] == 1000.5
    fill = client.get("/paper/fills").json()[0]
    assert fill["trade_value"] == 10005.0 and fill["quote_price"] == 1000.0
    # Hand-worked: STT 10.01, exchange 0.30, SEBI 0.01, stamp 1.50, GST 0.06.
    assert fill["charges"] == {
        "brokerage": 0.0, "stt": 10.01, "exchange": 0.3, "sebi": 0.01,
        "stamp_duty": 1.5, "gst": 0.06, "total": 11.88,
    }
    assert fill["net_amount"] == -10016.88
    data = account()
    assert data["cash"] == 1_000_000 - 10016.88
    assert data["total_charges"] == 11.88
    holding = client.get("/paper/holdings").json()[0]
    assert holding["quantity"] == 10 and holding["average_price"] == 1000.5
    assert holding["market_value"] == 10000.0 and holding["unrealised_pnl"] == -5.0
    assert data["equity"] == round(1_000_000 - 10016.88 + 10000.0, 2)


def test_sell_books_realised_pnl_and_no_short_selling(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    order(world, quantity=10)
    assert order(world, side="SELL", quantity=11).status_code == 422
    assert "Short selling is not allowed" in order(world, side="SELL", quantity=11).json()["detail"]
    world["quotes"].set(a.symbol, 1100.0, at(world, "10:05"))
    sell = order(world, side="SELL", quantity=10).json()
    # 1100 x (1 - 5 bps) = 1099.45 (down to the tick).
    assert sell["status"] == "FILLED" and sell["average_price"] == 1099.45
    fill = client.get("/paper/fills").json()[0]
    assert fill["realised_pnl"] == round((1099.45 - 1000.5) * 10, 2)
    expected = calculate_charges(side="SELL", trade_value=Decimal("10994.50"), brokerage=0)
    assert fill["charges"] == expected and fill["charges"]["stamp_duty"] == 0
    assert client.get("/paper/holdings").json() == []
    data = account()
    assert data["realised_pnl"] == fill["realised_pnl"]
    assert data["cash"] == round(1_000_000 - 10016.88 + 10994.50 - expected["total"], 2)


def test_brokerage_setting_adds_gst(world):
    a = world["a"]
    response = client.patch("/paper/account/settings", json={"brokerage_per_order": 20, "slippage_bps": 0})
    assert response.status_code == 200
    world["quotes"].set(a.symbol, 500.0, at(world, "09:59"))
    order(world, quantity=2)
    fill = client.get("/paper/fills").json()[0]
    assert fill["price"] == 500.0
    assert fill["charges"]["brokerage"] == 20.0
    assert fill["charges"] == calculate_charges(side="BUY", trade_value=1000, brokerage=20)


# --- limit and stop orders ---------------------------------------------------


def test_limit_buy_waits_reserves_cash_and_fills_on_a_newer_quote(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    placed = order(world, order_type="LIMIT", price=990, quantity=100).json()
    assert placed["status"] == "OPEN"
    reserved = round(990 * 100 + calculate_charges(side="BUY", trade_value=99000, brokerage=0)["total"], 2)
    assert placed["reserved_amount"] == reserved
    data = account()
    assert data["blocked_cash"] == reserved and data["available_cash"] == round(1_000_000 - reserved, 2)
    # A price at the limit but no newer than the one seen at placement: no fill.
    world["quotes"].set(a.symbol, 990.0, at(world, "09:59"))
    assert client.get(f"/paper/orders/{placed['id']}").json()["status"] == "OPEN"
    # A newer quote at 985: fills at 985 (better than the limit), no slippage.
    world["clock"].set("2026-10-14", "10:20")
    world["quotes"].set(a.symbol, 985.0, at(world, "10:05"))
    filled = client.get(f"/paper/orders/{placed['id']}").json()
    assert filled["status"] == "FILLED" and filled["average_price"] == 985.0
    assert account()["blocked_cash"] == 0


def test_marketable_limit_fills_at_once(world):
    world["quotes"].set(world["a"].symbol, 1000.0, at(world, "09:59"))
    placed = order(world, order_type="LIMIT", price=1010, quantity=1).json()
    assert placed["status"] == "FILLED" and placed["average_price"] == 1000.0


def test_stop_loss_sell_triggers_then_works_as_a_limit(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    order(world, quantity=10)
    bad = order(world, side="SELL", order_type="SL", price=990, trigger_price=1005, quantity=10)
    assert bad.status_code == 422  # trigger at or above price is required, and below the last price
    wrong = order(world, side="SELL", order_type="SL", price=1000, trigger_price=1001, quantity=10)
    assert wrong.status_code == 422 and "below the last price" in wrong.json()["detail"]
    sl = order(world, side="SELL", order_type="SL", price=980, trigger_price=985, quantity=10).json()
    assert sl["status"] == "TRIGGER_PENDING"
    world["clock"].set("2026-10-14", "10:30")
    world["quotes"].set(a.symbol, 984.0, at(world, "10:15"))
    filled = client.get(f"/paper/orders/{sl['id']}").json()
    assert filled["status"] == "FILLED" and filled["average_price"] == 984.0
    assert filled["triggered_at"] is not None


def test_stop_loss_market_buy_fills_with_slippage(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    slm = order(world, order_type="SL_M", trigger_price=1020, quantity=5).json()
    assert slm["status"] == "TRIGGER_PENDING"
    world["clock"].set("2026-10-14", "11:00")
    world["quotes"].set(a.symbol, 1015.0, at(world, "10:40"))
    assert client.get(f"/paper/orders/{slm['id']}").json()["status"] == "TRIGGER_PENDING"
    world["quotes"].set(a.symbol, 1021.0, at(world, "10:45"))
    filled = client.get(f"/paper/orders/{slm['id']}").json()
    # 1021 x 1.0005 = 1021.5105 -> 1021.55 (up to the tick).
    assert filled["status"] == "FILLED" and filled["average_price"] == 1021.55


# --- sessions ---------------------------------------------------------------


def test_after_market_order_fills_at_the_next_session_skipping_the_holiday(world):
    a = world["a"]
    world["clock"].set("2026-10-19", "18:00")  # Monday evening; 20 Oct is a holiday
    world["quotes"].set(a.symbol, 1000.0, at(world, "15:29", "2026-10-19"))
    placed = order(world, quantity=1).json()
    assert placed["status"] == "OPEN" and placed["after_market"] is True
    assert placed["session_date"] == "2026-10-21"
    world["clock"].set("2026-10-21", "09:14")
    assert client.get(f"/paper/orders/{placed['id']}").json()["status"] == "OPEN"
    world["clock"].set("2026-10-21", "09:20")
    world["quotes"].set(a.symbol, 1010.0, at(world, "09:16", "2026-10-21"))
    filled = client.get(f"/paper/orders/{placed['id']}").json()
    assert filled["status"] == "FILLED" and filled["average_price"] == 1010.55


def test_open_quote_from_before_the_session_does_not_fill(world):
    a = world["a"]
    world["clock"].set("2026-10-14", "09:16")
    world["quotes"].set(a.symbol, 1000.0, at(world, "15:29", "2026-10-13"))
    placed = order(world, quantity=1).json()
    assert placed["status"] == "OPEN"  # yesterday's price never fills today's market order


def test_day_orders_expire_at_the_close_and_release_cash(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    placed = order(world, order_type="LIMIT", price=900, quantity=10).json()
    world["clock"].set("2026-10-14", "15:31")
    expired = client.get(f"/paper/orders/{placed['id']}").json()
    assert expired["status"] == "EXPIRED" and "15:30" in expired["status_message"]
    assert account()["blocked_cash"] == 0


# --- checks, modify, cancel -------------------------------------------------


def test_funds_are_checked_including_reserved_cash(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    assert order(world, order_type="LIMIT", price=900, quantity=1000).json()["status"] == "OPEN"
    second = order(world, order_type="LIMIT", price=900, quantity=200)
    assert second.status_code == 422 and second.json()["detail"].startswith("Insufficient funds")
    preview = client.post(
        "/paper/orders/preview",
        json={"instrument_id": str(a.id), "side": "BUY", "order_type": "LIMIT", "price": 900, "quantity": 200},
    ).json()
    assert preview["allowed"] is False and preview["problem"].startswith("Insufficient funds")
    assert preview["charges"] == calculate_charges(side="BUY", trade_value=180000, brokerage=0)


def test_shape_rules(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    cases = [
        ({"order_type": "MARKET", "price": 1000}, "take no price"),
        ({"order_type": "LIMIT"}, "price above 0"),
        ({"order_type": "LIMIT", "price": 1000.03}, "tick size"),
        ({"order_type": "SL_M"}, "trigger price above 0"),
        ({"order_type": "SL", "price": 1050, "trigger_price": 1060}, "at or below the price"),
    ]
    for body, text in cases:
        response = order(world, **body)
        assert response.status_code == 422 and text in response.json()["detail"], (body, response.text)
    assert order(world, quantity=0).status_code == 422


def test_missing_price_and_inactive_instrument(world):
    b = world["b"]
    response = order(world, key="b", quantity=1)
    assert response.status_code == 503 and "price could not be loaded" in response.json()["detail"]
    db = world["db"]
    b.is_active = False
    db.commit()
    assert order(world, key="b", order_type="LIMIT", price=100, quantity=1).status_code == 422


def test_modify_and_cancel(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    placed = order(world, order_type="LIMIT", price=950, quantity=10).json()
    changed = client.patch(f"/paper/orders/{placed['id']}", json={"price": 960, "quantity": 20}).json()
    assert changed["price"] == 960 and changed["quantity"] == 20
    assert changed["reserved_amount"] == round(19200 + calculate_charges(side="BUY", trade_value=19200, brokerage=0)["total"], 2)
    assert client.patch(f"/paper/orders/{placed['id']}", json={}).status_code == 422
    cancelled = client.delete(f"/paper/orders/{placed['id']}").json()
    assert cancelled["status"] == "CANCELLED"
    assert client.delete(f"/paper/orders/{placed['id']}").status_code == 409
    assert client.patch(f"/paper/orders/{placed['id']}", json={"price": 970}).status_code == 409
    assert account()["blocked_cash"] == 0
    listed = client.get("/paper/orders", params={"open_only": "true"}).json()
    assert listed == []


def test_reset_starts_again(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    order(world, quantity=10)
    response = client.post("/paper/account/reset", json={"initial_cash": 500000})
    data = response.json()
    assert data["cash"] == data["initial_cash"] == 500000 and data["reset_count"] == 1
    assert client.get("/paper/orders").json() == [] and client.get("/paper/fills").json() == []
    assert client.post("/paper/account/reset", json={"initial_cash": 0}).status_code == 422


def test_watchlist_and_quotes(world):
    a, b = world["a"], world["b"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    data = client.put("/paper/watchlist", json={"instrument_ids": [str(a.id), str(b.id), str(a.id)]}).json()
    assert data["watchlist"] == [str(a.id), str(b.id)]
    assert client.put("/paper/watchlist", json={"instrument_ids": [str(uuid4())]}).status_code == 422
    rows = client.get("/paper/quotes", params=[("instrument_id", str(a.id)), ("instrument_id", str(b.id))]).json()
    assert rows[0]["quote"]["price"] == 1000.0 and rows[0]["quote"]["delayed"] is True
    assert rows[0]["quote"]["previous_close"] == 990.0 and rows[0]["quote"]["change"] == 10.0
    assert rows[1]["quote"] is None and "No price" in rows[1]["problem"]


def test_quotes_are_cached_for_a_minute(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    for _ in range(3):
        client.get("/paper/quotes", params={"instrument_id": str(a.id)})
    assert world["quotes"].calls == 1


def test_charges_table(world):
    table = client.get("/paper/charges").json()
    assert {r["key"] for r in table["rates"]} == {"stt", "exchange", "sebi", "stamp_duty", "gst"}
    assert "DP charges" in table["not_included"]


# --- ownership and integrity --------------------------------------------------


def test_another_users_order_is_not_found(world):
    world["quotes"].set(world["a"].symbol, 1000.0, at(world, "09:59"))
    mine = order(world, order_type="LIMIT", price=900, quantity=1).json()
    as_user(world["other"])
    assert client.get("/paper/orders").json() == []
    assert client.get(f"/paper/orders/{mine['id']}").status_code == 404
    assert client.delete(f"/paper/orders/{mine['id']}").status_code == 404
    assert client.patch(f"/paper/orders/{mine['id']}", json={"price": 950}).status_code == 404
    assert account()["cash"] == 1_000_000


def test_background_matcher_fills_every_account(world):
    a = world["a"]
    world["quotes"].set(a.symbol, 1000.0, at(world, "09:59"))
    mine = order(world, order_type="LIMIT", price=990, quantity=1).json()
    as_user(world["other"])
    theirs = order(world, order_type="LIMIT", price=995, quantity=1).json()
    world["clock"].set("2026-10-14", "10:30")
    world["quotes"].set(a.symbol, 989.0, at(world, "10:10"))
    db = world["db"]
    assert paper.match_all(db) == 2
    db.expire_all()
    as_user(world["user"])
    assert client.get(f"/paper/orders/{mine['id']}").json()["status"] == "FILLED"
    as_user(world["other"])
    assert client.get(f"/paper/orders/{theirs['id']}").json()["status"] == "FILLED"


def test_an_instrument_with_paper_orders_cannot_be_deleted(world):
    world["quotes"].set(world["a"].symbol, 1000.0, at(world, "09:59"))
    order(world, quantity=1)
    response = client.delete(f"/instruments/{world['a'].id}")
    assert response.status_code == 409


def test_session_rules():
    friday_evening = ist("2026-10-16", "18:00")
    assert clock.order_session(friday_evening) == (datetime(2026, 10, 19).date(), True)
    morning = ist("2026-10-14", "08:00")
    assert clock.order_session(morning) == (datetime(2026, 10, 14).date(), True)
    assert clock.is_market_open(ist("2026-10-14", "15:29")) is True
    assert clock.is_market_open(ist("2026-10-14", "15:30")) is False
    assert clock.is_market_open(ist("2026-10-20", "11:00")) is False  # Diwali holiday
    assert ist("2026-10-14", "09:15") - ist("2026-10-14", "09:14") == timedelta(minutes=1)


def test_yahoo_provider_reads_the_latest_minute_bar(monkeypatch):
    import pandas as pd
    import yfinance as yf

    daily = pd.DataFrame(
        {"Close": [990.0, 1000.0]},
        index=pd.DatetimeIndex(["2026-10-13", "2026-10-14"]).tz_localize(IST),
    )
    minute = pd.DataFrame(
        {"Close": [1001.0, 1002.5]},
        index=pd.DatetimeIndex(["2026-10-14 10:00", "2026-10-14 10:01"]).tz_localize(IST),
    )

    class Ticker:
        def __init__(self, symbol):
            assert symbol == "RELIANCE.NS"

        def history(self, period, interval, auto_adjust):
            return minute if interval == "1m" else daily

    monkeypatch.setattr(yf, "Ticker", Ticker)
    quote = quotes.YahooQuoteProvider().fetch("RELIANCE.NS")
    assert quote.price == 1002.5 and quote.previous_close == 990.0
    assert quote.time == ist("2026-10-14", "10:01") and quote.delayed is True

    minute_empty = pd.DataFrame({"Close": []})
    monkeypatch.setattr(Ticker, "history", lambda self, period, interval, auto_adjust: minute_empty if interval == "1m" else daily)
    closed = quotes.YahooQuoteProvider().fetch("RELIANCE.NS")
    assert closed.price == 1000.0 and closed.previous_close == 990.0
    assert closed.time == ist("2026-10-14", "15:30")


def test_messages_use_indian_digit_grouping():
    assert paper.inr(Decimal("1401660.72")) == "Rs 14,01,660.72"
    assert paper.inr(Decimal("944172.8")) == "Rs 9,44,172.80"
    assert paper.inr(Decimal("999")) == "Rs 999.00"
    assert paper.inr(Decimal("-12345678")) == "-Rs 1,23,45,678.00"
