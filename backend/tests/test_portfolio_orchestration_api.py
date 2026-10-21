"""Phase 14: portfolio orchestration on the user's saved strategies.

Target allocation, rebalancing and saved state, checked against the services
that compute them (scoring, allocation, risk limits, rebalancing)."""

from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from app.main import app
from app.ml.factor_definitions import regime_compatibility
from app.models import User
from app.services.portfolio.allocation_service import PortfolioAllocationService
from app.services.portfolio.risk_service import PortfolioRiskLimits, PortfolioRiskService
from app.services.portfolio.user_portfolio import NOT_FOUND, PAIR_REASON
from app.services.scoring.service import NO_BACKTEST, NOT_A_TEMPLATE
from tests.test_scoring_api import world  # noqa: F401  (fixture)
from tests.validation_helpers import add_validation

client = TestClient(app)
CENT = Decimal("0.01")
ALLOCATED = ["Momentum A", "Mean reversion A", "Vol arb B"]


@pytest.fixture(autouse=True)
def validated(world):
    """Phase 14 checks the allocation itself: every strategy has a passing
    validation, so the Feature 5 filter (on by default) leaves none out."""
    for strategy in world["strategies"].values():
        add_validation(world["db"], strategy, world["a"].id)
    world["db"].commit()


def ids(world, *names):
    return [str(world["strategies"][n].id) for n in names]


def scores(world):
    rows = client.post("/scoring", json={}).json()["rows"]
    return {r["strategy_id"]: r for r in rows}


def last_close(world, key):
    return Decimal(str(float(world["prices"][key]["close"].iloc[-1]))).quantize(
        CENT, rounding=ROUND_HALF_UP
    )


def total(values):
    return sum((Decimal(v) for v in values), Decimal("0"))


def test_target_of_saved_strategies_equals_the_services(world):
    chosen = ids(world, *ALLOCATED, "Pairs AB", "Rules", "Never run")
    response = client.post(
        "/portfolio/target", json={"capital": "100000", "strategy_ids": chosen}
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["simulation_only"] is True

    excluded = {e["name"]: e["reason"] for e in data["excluded"]}
    assert excluded == {
        "Pairs AB": PAIR_REASON,
        "Rules": NOT_A_TEMPLATE,
        "Never run": NO_BACKTEST,
    }

    scored = scores(world)
    expected = PortfolioAllocationService.allocate(
        Decimal("100000"),
        {i: scored[i]["composite_score"] for i in ids(world, *ALLOCATED)},
    )
    amounts = {a.strategy: a.amount for a in expected}
    positions = {p["strategy"]: p for p in data["positions"]}
    assert set(positions) == set(amounts)
    symbol = {"a": world["a"].trading_symbol, "b": world["b"].trading_symbol}
    for name, asset in zip(ALLOCATED, ["a", "b", "b"]):
        p = positions[str(world["strategies"][name].id)]
        assert p["name"] == name
        assert p["asset"] == symbol[asset]
        assert p["score"] == scored[p["strategy"]]["composite_score"]
        assert Decimal(p["amount"]) == amounts[p["strategy"]]
    # Highest score first.
    assert [p["score"] for p in data["positions"]] == sorted(
        (p["score"] for p in data["positions"]), reverse=True
    )

    # Weights plus cash add up to exactly 100%; asset weights add the strategies
    # that hold the same asset.
    assert total(data["strategy_weights"].values()) + Decimal(data["cash_weight"]) == 1
    assert total(data["asset_weights"].values()) + Decimal(data["cash_weight"]) == 1
    b_ids = ids(world, "Mean reversion A", "Vol arb B")
    assert Decimal(data["asset_weights"][symbol["b"]]) == total(
        data["strategy_weights"][i] for i in b_ids
    )
    assert total(p["amount"] for p in data["positions"]) + Decimal(
        data["cash_reserve"]
    ) == Decimal("100000")
    assert data["binding_limits"] == []


def test_risk_limits_say_which_ones_bound(world):
    chosen = ids(world, *ALLOCATED)
    limits = {"cash_reserve": "10000", "max_strategy_weight": "0.3", "max_asset_weight": "0.5"}
    data = client.post(
        "/portfolio/target",
        json={"capital": "100000", "strategy_ids": chosen, "limits": limits},
    ).json()
    scored = scores(world)
    proposed = PortfolioAllocationService.allocate(
        Decimal("100000"), {i: scored[i]["composite_score"] for i in chosen}
    )
    symbol = {"a": world["a"].trading_symbol, "b": world["b"].trading_symbol}
    expected = PortfolioRiskService.constrain(
        Decimal("100000"),
        {a.strategy: a.amount for a in proposed},
        PortfolioRiskLimits(
            cash_reserve=Decimal("10000"),
            max_strategy_weight=Decimal("0.3"),
            max_asset_weight=Decimal("0.5"),
        ),
        strategy_assets=dict(zip(chosen, [symbol["a"], symbol["b"], symbol["b"]])),
    )
    assert {p["strategy"]: Decimal(p["amount"]) for p in data["positions"]} == {
        a.strategy: a.amount for a in expected.allocations
    }
    assert data["binding_limits"] == list(expected.binding_limits)
    bound = {b["limit"]: b for b in data["binding_limits"]}
    assert set(bound) == {"cash_reserve", "max_strategy_weight", "max_asset_weight"}
    assert bound["max_asset_weight"]["affected"] == [symbol["b"]]
    assert Decimal(data["asset_weights"][symbol["b"]]) <= Decimal("0.5")
    assert all(Decimal(w) <= Decimal("0.3") for w in data["strategy_weights"].values())
    assert total(data["strategy_weights"].values()) + Decimal(data["cash_weight"]) == 1

    capped = client.post(
        "/portfolio/target",
        json={
            "capital": "100000",
            "strategy_ids": chosen,
            "limits": {"max_invested_capital": "50000"},
        },
    ).json()
    assert [b["limit"] for b in capped["binding_limits"]] == ["max_invested_capital"]
    assert Decimal(capped["invested_capital"]) == Decimal("50000.00")


def test_a_chosen_regime_leaves_out_incompatible_strategies(world):
    chosen = ids(world, *ALLOCATED)
    refused = client.post(
        "/portfolio/target",
        json={"capital": "100000", "strategy_ids": chosen, "regime": "R1"},
    )
    assert refused.status_code == 422
    assert "No regime model" in refused.json()["detail"]

    started = client.post(
        "/regime/models", json={"instrument_id": str(world["a"].id), "random_state": 7}
    ).json()
    model = client.get(f"/regime/models/{started['id']}").json()
    assert model["status"] == "READY"
    keys = {i: scores(world)[i]["strategy_key"] for i in chosen}
    allocated = 0
    for label in model["card"]["labels"]["regimes"]:
        response = client.post(
            "/portfolio/target",
            json={"capital": "100000", "strategy_ids": chosen, "regime": label["code"]},
        )
        out = {
            i
            for i, key in keys.items()
            if regime_compatibility(key, label)["status"] == "NOT_COMPATIBLE"
        }
        if out == set(chosen):
            assert response.status_code == 422
            continue
        data = response.json()
        assert data["regime"] == label["code"]
        assert data["regime_label"]["name"] == label["name"]
        assert {e["strategy_id"] for e in data["excluded"]} == out
        for e in data["excluded"]:
            assert e["reason"].endswith(f"Chosen regime: {label['name']}.")
        assert {p["strategy"] for p in data["positions"]} == set(chosen) - out
        allocated += 1
    assert allocated >= 1

    unknown = client.post(
        "/portfolio/target",
        json={"capital": "100000", "strategy_ids": chosen, "regime": "R99"},
    )
    assert unknown.status_code == 422


def test_create_rebalance_save_and_reload(world):
    created = client.post(
        "/portfolio/accounts",
        json={"name": "Core", "description": "Phase 14", "initial_capital": "100000"},
    )
    assert created.status_code == 201
    pid = created.json()["id"]
    fresh = client.get(f"/portfolio/accounts/{pid}").json()
    assert fresh["name"] == "Core"
    assert fresh["cash"] == "100000.00"
    assert fresh["cash_weight"] == "1"
    assert fresh["holdings"] == []

    a, b = world["a"].trading_symbol, world["b"].trading_symbol
    prices = client.get("/portfolio/prices", params={"asset": [a, b, "NOPE"]}).json()
    assert [p["asset"] for p in prices] == [a, b, "NOPE"]
    assert Decimal(prices[0]["price"]) == last_close(world, "a")
    assert Decimal(prices[1]["price"]) == last_close(world, "b")
    assert prices[0]["as_of"].startswith(str(world["prices"]["a"].index[-1].date()))
    assert prices[2]["price"] is None and prices[2]["reason"]

    price = {a: prices[0]["price"], b: prices[1]["price"]}
    plan = client.post(
        "/portfolio/rebalance",
        json={
            "cash": fresh["cash"],
            "holdings": {},
            "prices": price,
            "strategy_ids": ids(world, *ALLOCATED),
            "minimum_trade_value": "100",
        },
    )
    assert plan.status_code == 200, plan.text
    plan = plan.json()
    targets = plan["target"]["target_values"]
    trades = {t["asset"]: t for t in plan["rebalancing"]["trades"]}
    for row in plan["assets"]:
        asset = row["asset"]
        assert row["target_value"] == targets[asset]
        assert row["current_quantity"] == 0 and row["action"] == "BUY"
        quantity = int((Decimal(targets[asset]) / Decimal(price[asset])).to_integral_value(ROUND_DOWN))
        assert row["trade_quantity"] == trades[asset]["quantity"] == quantity
        assert row["ending_quantity"] == quantity
    ending = plan["ending_state"]
    assert ending["cash"] == plan["rebalancing"]["ending_cash"]
    assert Decimal(ending["total_equity"]) == Decimal("100000.00")

    used = {p["asset"]: p for p in plan["prices"]}
    assert used[a]["source"] == used[b]["source"] == "given"

    # Without a price, a target asset is priced at its latest stored close.
    filled = client.post(
        "/portfolio/rebalance",
        json={
            "cash": fresh["cash"],
            "holdings": {},
            "prices": {a: price[a]},
            "strategy_ids": ids(world, *ALLOCATED),
            "minimum_trade_value": "100",
        },
    ).json()
    used = {p["asset"]: p for p in filled["prices"]}
    assert used[b]["source"] == "latest_close"
    assert used[b]["price"] == price[b]
    assert used[b]["as_of"] == prices[1]["as_of"]
    assert filled["assets"] == plan["assets"]

    # Calculating saved nothing.
    assert client.get(f"/portfolio/accounts/{pid}").json()["holdings"] == []

    # Apply the plan: save the ending state, and it is there after a reload.
    body = {
        "cash": ending["cash"],
        "holdings": {h["asset"]: {"quantity": h["quantity"], "price": h["price"]} for h in ending["holdings"]},
    }
    saved = client.put(f"/portfolio/accounts/{pid}/state", json=body)
    assert saved.status_code == 200
    reloaded = client.get(f"/portfolio/accounts/{pid}").json()
    assert reloaded == saved.json()
    assert reloaded["cash"] == ending["cash"]
    held = {h["asset"]: h for h in reloaded["holdings"]}
    for h in ending["holdings"]:
        assert held[h["asset"]]["quantity"] == h["quantity"]
        assert held[h["asset"]]["average_price"] == h["price"]
    assert total(reloaded["allocation_weights"].values()) + Decimal(reloaded["cash_weight"]) == 1

    # A later buy blends the average cost; a sell keeps it.
    first = held[a]
    bought = first["quantity"] + 10
    after_buy = client.put(
        f"/portfolio/accounts/{pid}/state",
        json={"cash": "0", "holdings": {a: {"quantity": bought, "price": "999.00"}}},
    ).json()
    average = (
        (Decimal(first["average_price"]) * first["quantity"] + Decimal("999.00") * 10) / bought
    ).quantize(CENT, rounding=ROUND_HALF_UP)
    assert after_buy["holdings"][0]["average_price"] == str(average)
    after_sell = client.put(
        f"/portfolio/accounts/{pid}/state",
        json={"cash": "0", "holdings": {a: {"quantity": 5, "price": "1.00"}}},
    ).json()
    assert after_sell["holdings"][0]["average_price"] == str(average)

    listed = {p["id"]: p for p in client.get("/portfolio/accounts").json()}
    assert listed[pid]["total_equity"] == after_sell["total_equity"]
    assert listed[pid]["holdings_count"] == 1


def test_another_users_portfolio_is_not_found(world):
    pid = client.post(
        "/portfolio/accounts", json={"name": "Mine", "initial_capital": "5000"}
    ).json()["id"]
    stranger = User(id=uuid4(), email="stranger@example.com")
    app.dependency_overrides[get_current_user] = lambda: stranger
    try:
        assert client.get(f"/portfolio/accounts/{pid}").status_code == 404
        put = client.put(f"/portfolio/accounts/{pid}/state", json={"cash": "1", "holdings": {}})
        assert put.status_code == 404
        assert all(p["id"] != pid for p in client.get("/portfolio/accounts").json())
    finally:
        app.dependency_overrides[get_current_user] = lambda: world["user"]
    assert client.get(f"/portfolio/accounts/{pid}").json()["cash"] == "5000.00"


@pytest.mark.parametrize(
    "body",
    [
        {"capital": "1000"},
        {"capital": "1000", "strategy_ids": []},
        {
            "capital": "1000",
            "strategy_ids": [str(uuid4())],
            "candidates": [{"strategy": "momentum", "factors": {"trend_strength": 0.5}}],
        },
    ],
)
def test_candidates_come_from_one_source(world, body):
    assert client.post("/portfolio/target", json=body).status_code == 422


def test_only_your_own_allocatable_strategies(world):
    theirs = client.post(
        "/portfolio/target",
        json={"capital": "1000", "strategy_ids": [str(uuid4())]},
    )
    assert theirs.status_code == 422
    assert theirs.json()["detail"] == NOT_FOUND
    nothing = client.post(
        "/portfolio/target",
        json={"capital": "1000", "strategy_ids": ids(world, "Pairs AB", "Rules")},
    )
    assert nothing.status_code == 422
    assert "None of the chosen strategies can be allocated" in nothing.json()["detail"]
