"""Phase 15: a real backtest stores its trading records when it completes."""

from fastapi.testclient import TestClient

from app.main import app
from tests.test_execution_results import run_to_end, world  # noqa: F401  (fixture)

client = TestClient(app)


def test_a_completed_backtest_has_its_records(world):
    execution = run_to_end(world)
    assert execution["status"] == "COMPLETED", execution["error"]
    run = {"execution_id": execution["id"]}
    results = client.get(f"/executions/{execution['id']}/results").json()["records"]
    counts = client.get(f"/executions/{execution['id']}/records").json()
    assert counts["stored"] is True
    assert counts["orders"] == counts["trades"] == len(results["fills"]) > 0
    orders = sorted(client.get("/orders", params=run).json(), key=lambda o: o["order_timestamp"])
    # Stored to the paisa (2 decimals), as the record columns hold.
    assert [(o["order_side"], o["quantity"], o["average_fill_price"]) for o in orders] == [
        (f["side"], f["quantity"], round(f["price"], 2)) for f in results["fills"]
    ]
    trades = client.get("/trades", params=run).json()
    assert {t["order_id"] for t in trades} == {o["id"] for o in orders}
    positions = client.get("/positions", params=run).json()
    assert len(positions) == 1 and positions[0]["instrument_id"] == str(world["instrument"].id)
    assert positions[0]["realized_pnl"] == round(sum(f["realized_pnl"] for f in results["fills"]), 2)
    # Storing again is refused.
    assert client.post(f"/executions/{execution['id']}/records").status_code == 409
