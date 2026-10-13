from uuid import uuid4
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from app.main import app
from app.models import User


client = TestClient(app)


def test_portfolio_target_requires_authentication():
    response = client.post(
        "/portfolio/target",
        json={
            "capital": "1000.00",
            "candidates": [
                {
                    "strategy": "momentum",
                    "asset": "AAA",
                    "factors": {
                        "trend_strength": 0.9,
                        "relative_momentum": 0.8,
                        "volatility_suitability": 0.7,
                    },
                }
            ],
        },
    )
    assert response.status_code == 401


def test_portfolio_target_returns_allocation(monkeypatch):
    import app.api.portfolio.routes as routes

    user = User(id=uuid4(), email="portfolio-api@example.com")
    app.dependency_overrides[get_current_user] = lambda: user

    mock_target = MagicMock()
    mock_target.capital = 1000
    mock_target.regime = None
    mock_target.invested_capital = 800
    mock_target.cash_reserve = 200
    mock_target.positions = [
        MagicMock(
            strategy="momentum",
            asset="AAA",
            score=0.8,
            amount=800,
        )
    ]
    mock_target.target_values.return_value = {"AAA": 800}

    monkeypatch.setattr(
        routes.PortfolioOrchestrator,
        "build_target",
        lambda *args, **kwargs: mock_target,
    )

    try:
        response = client.post(
            "/portfolio/target",
            json={
                "capital": "1000.00",
                "candidates": [
                    {
                        "strategy": "momentum",
                        "asset": "AAA",
                        "factors": {
                            "trend_strength": 0.9,
                            "relative_momentum": 0.8,
                            "volatility_suitability": 0.7,
                        },
                    }
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["capital"] == "1000"
        assert data["invested_capital"] == "800"
        assert data["cash_reserve"] == "200"
        assert data["target_values"]["AAA"] == "800"
    finally:
        app.dependency_overrides.clear()


def test_portfolio_rebalance_requires_authentication():
    response = client.post(
        "/portfolio/rebalance",
        json={
            "cash": "1000.00",
            "holdings": {},
            "prices": {"AAA": "10.00"},
            "candidates": [
                {
                    "strategy": "momentum",
                    "asset": "AAA",
                    "factors": {
                        "trend_strength": 0.9,
                        "relative_momentum": 0.8,
                        "volatility_suitability": 0.7,
                    },
                }
            ],
        },
    )
    assert response.status_code == 401


def test_portfolio_target_rejects_invalid_capital():
    user = User(id=uuid4(), email="portfolio-invalid@example.com")
    app.dependency_overrides[get_current_user] = lambda: user

    try:
        response = client.post(
            "/portfolio/target",
            json={
                "capital": "-10",
                "candidates": [
                    {
                        "strategy": "momentum",
                        "asset": "AAA",
                        "factors": {"trend_strength": 0.9},
                    }
                ],
            },
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()
