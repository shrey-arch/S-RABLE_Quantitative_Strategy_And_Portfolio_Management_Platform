from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from app.main import app
from app.models import User


client = TestClient(app)


@pytest.fixture
def logged_in():
    app.dependency_overrides[get_current_user] = lambda: User(
        id=uuid4(),
        email="registry-api-test@example.com",
    )
    try:
        yield
    finally:
        app.dependency_overrides.clear()


def test_registry_requires_authentication():
    assert client.get("/strategy-registry").status_code == 401
    assert client.get("/strategy-registry/momentum").status_code == 401


def test_registry_lists_all_five_in_order(logged_in):
    response = client.get("/strategy-registry")

    assert response.status_code == 200
    assert [item["strategy_key"] for item in response.json()] == [
        "momentum",
        "mean_reversion",
        "volatility_arbitrage",
        "statistical_arbitrage",
        "tactical_asset_allocation",
    ]


def test_registry_entry_has_parameters_and_inputs(logged_in):
    response = client.get("/strategy-registry/mean_reversion")

    assert response.status_code == 200
    body = response.json()
    assert body["required_inputs"] == ["close"]
    assert body["parameters"] == [
        {"name": "lookback", "type": "int", "required": False, "default": 20},
        {"name": "entry_threshold", "type": "float", "required": False, "default": 2.0},
        {"name": "exit_threshold", "type": "float", "required": False, "default": 0.0},
    ]


def test_registry_reports_multi_input_strategies(logged_in):
    stat_arb = client.get("/strategy-registry/statistical_arbitrage").json()
    taa = client.get("/strategy-registry/tactical_asset_allocation").json()

    assert stat_arb["required_inputs"] == ["instrument_a", "instrument_b"]
    assert taa["required_inputs"] == []


def test_unknown_registry_strategy_is_404(logged_in):
    assert client.get("/strategy-registry/nope").status_code == 404
    response = client.post(
        "/strategy-registry/nope/validate",
        json={"parameters": {}},
    )
    assert response.status_code == 404


def test_validate_accepts_good_parameters(logged_in):
    response = client.post(
        "/strategy-registry/momentum/validate",
        json={"parameters": {"lookback": 50}},
    )

    assert response.status_code == 200
    assert response.json() == {
        "strategy_key": "momentum",
        "effective_parameters": {"lookback": 50},
    }


@pytest.mark.parametrize(
    "key, parameters, message",
    [
        ("momentum", {"lookback": 0}, "lookback must be greater than 0."),
        ("momentum", {"lookback": 1.5}, "must be an integer"),
        ("momentum", {"speed": 3}, "Unknown parameters"),
        (
            "volatility_arbitrage",
            {"short_window": 30, "long_window": 20},
            "short_window must be less than long_window.",
        ),
    ],
)
def test_validate_rejects_bad_parameters(logged_in, key, parameters, message):
    response = client.post(
        f"/strategy-registry/{key}/validate",
        json={"parameters": parameters},
    )

    assert response.status_code == 422
    assert message in response.json()["detail"]


def test_registry_does_not_shadow_strategy_detail(logged_in):
    # /strategies/{id} still expects a UUID; the registry lives elsewhere.
    assert client.get("/strategies/registry").status_code == 422