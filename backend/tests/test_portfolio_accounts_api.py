from uuid import uuid4
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from app.db import get_db
from app.main import app
from app.models import User
import app.api.portfolio.routes as routes


client = TestClient(app)


def authenticated(user):
    app.dependency_overrides[get_current_user] = lambda: user


def test_create_portfolio_requires_authentication():
    response = client.post(
        "/portfolio/accounts",
        json={"name": "Test Portfolio", "initial_capital": "10000"},
    )
    assert response.status_code == 401


def test_create_portfolio_success(monkeypatch):
    user = User(id=uuid4(), email="portfolio-create@example.com")
    portfolio_id = uuid4()
    db = MagicMock()

    def assign_portfolio_id(portfolio):
        portfolio.id = portfolio_id

    db.add.side_effect = assign_portfolio_id
    monkeypatch.setattr(routes, "get_db", lambda: None)
    app.dependency_overrides[get_db] = lambda: db
    authenticated(user)

    try:
        response = client.post(
            "/portfolio/accounts",
            json={
                "name": "  Long-Term Portfolio  ",
                "description": "Test portfolio",
                "initial_capital": "10000.00",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["id"] == str(portfolio_id)
        assert data["name"] == "Long-Term Portfolio"
        assert data["description"] == "Test portfolio"
        assert data["initial_capital"] == "10000.00"
        assert data["cash"] == "10000.00"
        assert data["simulation_only"] is True
        db.add.assert_called_once()
        db.commit.assert_called_once()
        db.refresh.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_create_portfolio_rejects_nonpositive_capital():
    user = User(id=uuid4(), email="portfolio-invalid-capital@example.com")
    authenticated(user)

    try:
        response = client.post(
            "/portfolio/accounts",
            json={"name": "Test Portfolio", "initial_capital": "0"},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_create_portfolio_rejects_blank_name(monkeypatch):
    user = User(id=uuid4(), email="portfolio-blank-name@example.com")
    db = MagicMock()
    monkeypatch.setattr(routes, "get_db", lambda: None)
    app.dependency_overrides[get_db] = lambda: db
    authenticated(user)

    try:
        response = client.post(
            "/portfolio/accounts",
            json={"name": "   ", "initial_capital": "1000"},
        )
        assert response.status_code == 422
        db.add.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_list_portfolios_requires_authentication():
    response = client.get("/portfolio/accounts")
    assert response.status_code == 401


def test_list_portfolios_returns_user_portfolios(monkeypatch):
    user = User(id=uuid4(), email="portfolio-list@example.com")
    portfolio = MagicMock()
    portfolio.id = uuid4()
    portfolio.name = "Savings"
    portfolio.description = "Savings portfolio"
    portfolio.initial_capital = 5000
    portfolio.cash_balance = 4200

    db = MagicMock()
    db.scalars.return_value.all.return_value = [portfolio]
    monkeypatch.setattr(routes, "get_db", lambda: None)
    app.dependency_overrides[get_db] = lambda: db
    authenticated(user)

    try:
        response = client.get("/portfolio/accounts")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == str(portfolio.id)
        assert data[0]["name"] == "Savings"
        assert data[0]["cash"] == "4200"
        assert data[0]["simulation_only"] is True
        db.scalars.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_get_portfolio_state_requires_authentication():
    response = client.get(f"/portfolio/accounts/{uuid4()}")
    assert response.status_code == 401


def saved_portfolio(portfolio_id, state, averages):
    portfolio = MagicMock()
    portfolio.id = portfolio_id
    portfolio.name = "Main"
    portfolio.description = None
    portfolio.initial_capital = 1000
    return {"portfolio": portfolio, "state": state, "average_prices": averages}


def test_get_portfolio_state_success(monkeypatch):
    user = User(id=uuid4(), email="portfolio-state@example.com")
    portfolio_id = uuid4()
    state = MagicMock()
    state.cash = 750
    state.invested_value = 250
    state.total_equity = 1000
    state.allocation_weights.return_value = {"AAA": 0.25}
    state.holdings = [
        MagicMock(
            asset="AAA",
            quantity=5,
            price=50,
            market_value=250,
        )
    ]

    monkeypatch.setattr(
        routes.PortfolioPersistenceService,
        "snapshot",
        lambda db, pid, uid: saved_portfolio(pid, state, {"AAA": 40}),
    )
    monkeypatch.setattr(routes, "get_db", lambda: None)
    app.dependency_overrides[get_db] = lambda: MagicMock()
    authenticated(user)

    try:
        response = client.get(f"/portfolio/accounts/{portfolio_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(portfolio_id)
        assert data["name"] == "Main"
        assert data["cash"] == "750"
        assert data["invested_value"] == "250"
        assert data["total_equity"] == "1000"
        assert data["cash_weight"] == "0.75"
        assert data["simulation_only"] is True
        assert data["holdings"][0]["asset"] == "AAA"
        assert data["holdings"][0]["average_price"] == "40"
        assert data["holdings"][0]["weight"] == "0.25"
    finally:
        app.dependency_overrides.clear()


def test_get_portfolio_state_missing_returns_404(monkeypatch):
    user = User(id=uuid4(), email="portfolio-missing@example.com")
    monkeypatch.setattr(
        routes.PortfolioPersistenceService,
        "snapshot",
        MagicMock(side_effect=ValueError("Portfolio not found.")),
    )
    monkeypatch.setattr(routes, "get_db", lambda: None)
    app.dependency_overrides[get_db] = lambda: MagicMock()
    authenticated(user)

    try:
        response = client.get(f"/portfolio/accounts/{uuid4()}")
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_update_portfolio_state_success(monkeypatch):
    user = User(id=uuid4(), email="portfolio-update@example.com")
    portfolio_id = uuid4()
    state = MagicMock()
    state.cash = 800
    state.invested_value = 200
    state.total_equity = 1000
    state.allocation_weights.return_value = {"AAA": 0.2}
    state.holdings = [
        MagicMock(
            asset="AAA",
            quantity=2,
            price=100,
            market_value=200,
        )
    ]

    monkeypatch.setattr(
        routes.PortfolioStateService,
        "create",
        lambda cash, holdings: state,
    )
    monkeypatch.setattr(
        routes.PortfolioPersistenceService,
        "save",
        lambda db, pid, uid, new_state: state,
    )
    monkeypatch.setattr(
        routes.PortfolioPersistenceService,
        "snapshot",
        lambda db, pid, uid: saved_portfolio(pid, state, {"AAA": 100}),
    )
    monkeypatch.setattr(routes, "get_db", lambda: None)
    app.dependency_overrides[get_db] = lambda: MagicMock()
    authenticated(user)

    try:
        response = client.put(
            f"/portfolio/accounts/{portfolio_id}/state",
            json={
                "cash": "800",
                "holdings": {"AAA": {"quantity": 2, "price": "100"}},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["cash"] == "800"
        assert data["simulation_only"] is True
        assert data["holdings"][0]["asset"] == "AAA"
    finally:
        app.dependency_overrides.clear()


def test_update_portfolio_state_missing_returns_404(monkeypatch):
    user = User(id=uuid4(), email="portfolio-update-missing@example.com")
    state = MagicMock()
    monkeypatch.setattr(
        routes.PortfolioStateService,
        "create",
        lambda cash, holdings: state,
    )
    monkeypatch.setattr(
        routes.PortfolioPersistenceService,
        "save",
        MagicMock(side_effect=ValueError("Portfolio not found.")),
    )
    monkeypatch.setattr(routes, "get_db", lambda: None)
    app.dependency_overrides[get_db] = lambda: MagicMock()
    authenticated(user)

    try:
        response = client.put(
            f"/portfolio/accounts/{uuid4()}/state",
            json={"cash": "100", "holdings": {}},
        )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_update_portfolio_state_rejects_negative_cash():
    user = User(id=uuid4(), email="portfolio-negative-cash@example.com")
    authenticated(user)

    try:
        response = client.put(
            f"/portfolio/accounts/{uuid4()}/state",
            json={"cash": "-1", "holdings": {}},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()
