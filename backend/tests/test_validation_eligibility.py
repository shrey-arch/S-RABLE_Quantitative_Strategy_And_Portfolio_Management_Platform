"""Feature 5: only strategies that passed validation are eligible for capital.

Each validation status; a new version makes a validation outdated; strategies
that are not eligible are not allocated, with their reason as returned; the
switch (require_validated=false) includes them; portfolio backtests can apply
the same filter and say when it uses hindsight."""

from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.enums import ExecutionStatus
from app.main import app
from app.services.portfolio_backtest import service as pb
from app.services.validation import eligibility as E
from app.validation.pipeline import STAGES
from tests.test_scoring_api import world  # noqa: F401  (fixture)
from tests.test_validation_model_regimes import wait_for_worker
from tests.validation_helpers import PASSED_1_TO_4, add_validation

client = TestClient(app)
ALL_FIVE = {key: "PASS" for key in STAGES}


def strategy(world, name):
    return world["strategies"][name]


def validate(world, name, **kw):
    run = add_validation(world["db"], strategy(world, name), world["a"].id, **kw)
    world["db"].commit()
    return run


def status_of(world, name):
    rows = {r["name"]: r for r in client.get("/strategies").json()}
    return rows[name]["validation"]


def test_each_status_with_its_reason(world):
    assert status_of(world, "Momentum A") == {
        "status": "NOT_VALIDATED",
        "eligible": False,
        "reason": E.NOT_VALIDATED_REASON,
        "validation_id": None,
        "verdict": None,
        "validated_version": None,
        "current_version": 1,
        "completed_at": None,
        "data_end": None,
    }

    pending = validate(world, "Momentum A")
    got = status_of(world, "Momentum A")
    assert got["status"] == "VALIDATED_PAPER_PENDING" and got["eligible"] is True
    assert got["validation_id"] == str(pending.id) and got["verdict"] == "PASS"
    assert got["reason"].startswith("Stages 1 to 4 passed.")
    assert got["data_end"] == "2023-06-30" and got["validated_version"] == 1

    validate(world, "Mean reversion A", stages=ALL_FIVE)
    got = status_of(world, "Mean reversion A")
    assert got["status"] == "VALIDATED" and got["eligible"] is True
    assert got["reason"] == "All five stages passed, including paper trading."

    validate(world, "Vol arb B", stages={**PASSED_1_TO_4, "walk_forward": "FAIL"})
    got = status_of(world, "Vol arb B")
    assert got["status"] == "FAILED" and got["eligible"] is False
    assert got["reason"] == "The latest validation did not pass. Failed: Walk-forward."

    validate(world, "Rotation AB", stages={**ALL_FIVE, "paper_trading": "FAIL"})
    assert status_of(world, "Rotation AB")["reason"] == (
        "The latest validation did not pass. Stages 1 to 4 passed; paper trading (stage 5) failed."
    )


def test_a_new_version_makes_the_validation_outdated(world):
    validate(world, "Momentum A")
    s = strategy(world, "Momentum A")
    # Renaming does not change what the strategy does.
    assert client.patch(f"/strategies/{s.id}", json={"name": "Momentum A2"}).status_code == 200
    assert status_of(world, "Momentum A2")["status"] == "VALIDATED_PAPER_PENDING"
    changed = client.patch(
        f"/strategies/{s.id}",
        json={"strategy_config": {**s.strategy_config, "parameters": {"template": "momentum", "lookback": 30}}},
    )
    assert changed.status_code == 200, changed.text
    got = changed.json()["validation"]
    assert got["status"] == "OUTDATED" and got["eligible"] is False
    assert got["validated_version"] == 1 and got["current_version"] == 2
    assert got["reason"] == (
        "Validated as version 1; the strategy is now version 2 (its rules or parameters changed). "
        "Validate it again."
    )
    # A validation of the new version makes it eligible again.
    world["db"].refresh(s)
    validate(world, "Momentum A", minutes=5)
    assert client.get(f"/strategies/{s.id}").json()["validation"]["status"] == "VALIDATED_PAPER_PENDING"


def test_the_latest_completed_validation_decides(world):
    validate(world, "Momentum A", minutes=0)
    # A later cancelled run does not replace it; a later completed failure does.
    validate(world, "Momentum A", status=ExecutionStatus.CANCELLED, minutes=5)
    assert status_of(world, "Momentum A")["status"] == "VALIDATED_PAPER_PENDING"
    validate(world, "Momentum A", stages={**PASSED_1_TO_4, "backtest": "FAIL"}, minutes=10)
    assert status_of(world, "Momentum A")["status"] == "FAILED"
    # Strategies without a stored version are never assumed current.
    validate(world, "Mean reversion A")
    run = validate(world, "Vol arb B")
    run.run_settings = {**run.run_settings, "strategy_version": None}
    world["db"].commit()
    assert status_of(world, "Vol arb B")["status"] == "OUTDATED"


def test_scoring_rows_carry_the_status(world):
    validate(world, "Momentum A")
    rows = {r["name"]: r for r in client.post("/scoring", json={}).json()["rows"]}
    assert rows["Momentum A"]["validation"]["status"] == "VALIDATED_PAPER_PENDING"
    assert rows["Vol arb B"]["validation"]["status"] == "NOT_VALIDATED"


def ids(world, *names):
    return [str(strategy(world, n).id) for n in names]


def test_target_allocates_only_validated_strategies_unless_switched_off(world):
    validate(world, "Momentum A")
    validate(world, "Mean reversion A", stages={**PASSED_1_TO_4, "monte_carlo": "FAIL"})
    chosen = ids(world, "Momentum A", "Mean reversion A", "Vol arb B")
    on = client.post("/portfolio/target", json={"capital": "100000", "strategy_ids": chosen})
    assert on.status_code == 200, on.text
    data = on.json()
    assert data["require_validated"] is True
    assert [p["name"] for p in data["positions"]] == ["Momentum A"]
    assert data["positions"][0]["validation"]["status"] == "VALIDATED_PAPER_PENDING"
    excluded = {e["name"]: e for e in data["excluded"]}
    assert excluded["Mean reversion A"]["reason"] == "The latest validation did not pass. Failed: Monte Carlo and significance."
    assert excluded["Vol arb B"]["reason"] == E.NOT_VALIDATED_REASON
    assert excluded["Vol arb B"]["validation"]["status"] == "NOT_VALIDATED"
    # The reason is exactly the status GET /strategies returns.
    assert excluded["Mean reversion A"]["reason"] == status_of(world, "Mean reversion A")["reason"]

    off = client.post(
        "/portfolio/target",
        json={"capital": "100000", "strategy_ids": chosen, "require_validated": False},
    ).json()
    assert off["require_validated"] is False
    assert sorted(p["name"] for p in off["positions"]) == ["Mean reversion A", "Momentum A", "Vol arb B"]
    statuses = {p["name"]: p["validation"]["status"] for p in off["positions"]}
    assert statuses == {"Momentum A": "VALIDATED_PAPER_PENDING", "Mean reversion A": "FAILED", "Vol arb B": "NOT_VALIDATED"}
    assert sum(Decimal(p["amount"]) for p in off["positions"]) > Decimal(data["positions"][0]["amount"]) - 1


def test_nothing_validated_is_refused_with_the_reasons(world):
    chosen = ids(world, "Momentum A", "Vol arb B")
    refused = client.post("/portfolio/target", json={"capital": "1000", "strategy_ids": chosen})
    assert refused.status_code == 422
    assert refused.json()["detail"] == (
        "None of the chosen strategies can be allocated. "
        f"Momentum A: {E.NOT_VALIDATED_REASON} Vol arb B: {E.NOT_VALIDATED_REASON}"
    )


def test_rebalance_uses_the_same_filter(world):
    validate(world, "Momentum A")
    body = {
        "cash": "100000",
        "holdings": {},
        "prices": {},
        "strategy_ids": ids(world, "Momentum A", "Vol arb B"),
    }
    plan = client.post("/portfolio/rebalance", json=body).json()
    assert [p["name"] for p in plan["target"]["positions"]] == ["Momentum A"]
    assert plan["target"]["excluded"][0]["reason"] == E.NOT_VALIDATED_REASON
    both = client.post("/portfolio/rebalance", json={**body, "require_validated": False}).json()
    assert len(both["target"]["positions"]) == 2


def test_a_portfolio_backtest_can_keep_only_validated_strategies(world):
    validate(world, "Momentum A", end="2022-12-30T23:59:59+05:30")
    validate(world, "Mean reversion A", end="2023-06-30T23:59:59+05:30")
    db = world["db"]
    chosen = [strategy(world, n).id for n in ("Momentum A", "Mean reversion A", "Vol arb B")]
    usable, excluded = pb.resolve_strategies(db, world["user"].id, chosen, require_validated=True)
    assert [u["name"] for u in usable] == ["Momentum A", "Mean reversion A"]
    assert excluded == [{"strategy_id": str(chosen[2]), "name": "Vol arb B", "reason": E.NOT_VALIDATED_REASON}]
    assert usable[0]["validation"]["status"] == "VALIDATED_PAPER_PENDING"
    # Validated on data from inside the backtest period: hindsight is said.
    notes = pb.hindsight_notes(usable, date(2023, 1, 2))
    assert notes == [
        "Mean reversion A was validated on data up to 2023-06-30, after this backtest starts "
        "(2023-01-02), so choosing it by that validation uses hindsight."
    ]
    # Off (the default for backtests): all three, nothing said.
    usable, excluded = pb.resolve_strategies(db, world["user"].id, chosen)
    assert len(usable) == 3 and excluded == []

    wait_for_worker()
    created = client.post(
        "/portfolio-backtests",
        json={
            "name": "Validated only",
            "strategy_ids": [str(i) for i in chosen],
            "benchmark_instrument_id": str(world["b"].id),
            "start_date": "2023-01-02",
            "end_date": "2023-02-28",
            "regime_filter": False,
            "require_validated": True,
        },
    )
    assert created.status_code == 201, created.text
    detail = created.json()
    assert detail["require_validated"] is True
    assert detail["excluded"][0]["reason"] == E.NOT_VALIDATED_REASON
    assert detail["hindsight"] == notes
    assert detail["strategies"][1]["validation"]["data_end"] == "2023-06-30"
    wait_for_worker()


@pytest.mark.parametrize("verdict", ["PENDING", "INCOMPLETE"])
def test_unfinished_verdicts_are_not_eligible(world, verdict):
    s = strategy(world, "Momentum A")
    run = validate(world, "Momentum A", stages={})
    report = run.execution_metrics["validation"]
    run.execution_metrics = {"validation": {**report, "verdict": {"status": verdict, "reason": "x."}}}
    world["db"].commit()
    got = E.validation_status(world["db"], s)
    assert got["status"] == "FAILED" and got["eligible"] is False
