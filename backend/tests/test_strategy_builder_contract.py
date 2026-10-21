"""Phase 8 contract: price operands, indicator lines, Python code and versions."""

from unittest.mock import MagicMock
from uuid import uuid4

import re

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import delete

from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import StrategyType
from app.main import app
from app.models import Strategy, User
from app.repositories.strategies.strategy_repository import StrategyRepository
from app.schemas.strategies.config import StrategyConfig
from app.schemas.strategies.create import CreateStrategyRequest
from app.schemas.strategies.python_code import check_python_code

client = TestClient(app)

PYTHON_STUB = '''def generate_signal(context):
    return None
'''


def config(entry, indicators=None):
    return {
        "parameters": {},
        "indicators": indicators
        if indicators is not None
        else [
            {"name": "sma_20", "type": "SMA", "parameters": {"window": 20}},
            {"name": "macd", "type": "MACD", "parameters": {}},
        ],
        "entry_conditions": entry,
        "exit_conditions": [],
    }


def cond(left, right, operator="<"):
    return {"left": left, "operator": operator, "right": right}


SMA = {"type": "indicator", "name": "sma_20"}
CLOSE = {"type": "price", "field": "close"}


# --- operands -----------------------------------------------------------------


def test_price_operand_is_accepted():
    parsed = StrategyConfig.model_validate(config([cond(SMA, CLOSE)]))
    assert parsed.model_dump()["entry_conditions"][0]["right"] == CLOSE


@pytest.mark.parametrize("field", ["open", "high", "low", "close", "volume"])
def test_every_price_field_is_accepted(field):
    StrategyConfig.model_validate(config([cond({"type": "price", "field": field}, SMA)]))


def test_unknown_price_field_is_rejected():
    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(config([cond({"type": "price", "field": "vwap"}, SMA)]))


def test_unknown_operand_type_is_rejected():
    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(config([cond({"type": "formula", "text": "x"}, SMA)]))


def test_single_line_indicator_gets_its_output_filled_in():
    dumped = StrategyConfig.model_validate(config([cond(SMA, CLOSE)])).model_dump()
    assert dumped["entry_conditions"][0]["left"] == {
        "type": "indicator",
        "name": "sma_20",
        "output": "value",
    }


def test_multi_line_indicator_needs_an_output():
    with pytest.raises(ValidationError, match="macd has several lines; choose one of: macd, signal, histogram."):
        StrategyConfig.model_validate(
            config([cond({"type": "indicator", "name": "macd"}, {"type": "value", "value": 0})])
        )


def test_multi_line_indicator_output_is_kept():
    ref = {"type": "indicator", "name": "macd", "output": "signal"}
    dumped = StrategyConfig.model_validate(
        config([cond({"type": "indicator", "name": "macd", "output": "macd"}, ref, ">")])
    ).model_dump()
    assert dumped["entry_conditions"][0]["right"] == ref


def test_unknown_output_is_rejected():
    with pytest.raises(ValidationError, match="sma_20 has no line 'upper'. Its lines are: value."):
        StrategyConfig.model_validate(
            config([cond({"type": "indicator", "name": "sma_20", "output": "upper"}, CLOSE)])
        )


def test_unknown_reference_is_still_rejected():
    with pytest.raises(ValidationError, match="Unknown indicator reference: ema_9"):
        StrategyConfig.model_validate(config([cond({"type": "indicator", "name": "ema_9"}, CLOSE)]))


def test_normalised_config_validates_again_unchanged():
    once = StrategyConfig.model_validate(config([cond(SMA, CLOSE)])).model_dump()
    assert StrategyConfig.model_validate(once).model_dump() == once


# --- python code ----------------------------------------------------------------


def test_valid_python_code_is_accepted():
    assert check_python_code(PYTHON_STUB) == PYTHON_STUB


@pytest.mark.parametrize(
    "code,message",
    [
        ("   \n", "Python code is empty."),
        ("def generate_signal(context)\n    pass\n", "Python syntax error on line 1"),
        ("def other(context):\n    pass\n", "must define generate_signal(context) at the top level"),
        ("class A:\n    def generate_signal(context):\n        pass\n", "at the top level"),
        ("async def generate_signal(context):\n    pass\n", "at the top level"),
        ("def generate_signal():\n    pass\n", "exactly one argument: context"),
        ("def generate_signal(context, extra):\n    pass\n", "exactly one argument: context"),
        ("def generate_signal(*args):\n    pass\n", "exactly one argument: context"),
        ("def generate_signal(context, **kw):\n    pass\n", "exactly one argument: context"),
        ("x = 1\x00", "Python syntax error|could not be read"),
    ],
)
def test_bad_python_code_is_rejected(code, message):
    pattern = message if "|" in message else re.escape(message)
    with pytest.raises(ValueError, match=pattern):
        check_python_code(code)


def test_python_code_is_never_executed(tmp_path):
    marker = tmp_path / "ran"
    code = f"open({str(marker)!r}, 'w').write('x')\n\ndef generate_signal(context):\n    return None\n"
    check_python_code(code)
    assert not marker.exists()


def test_too_long_python_code_is_rejected():
    with pytest.raises(ValueError, match="longer than"):
        check_python_code(PYTHON_STUB + "#" * 100_001)


def test_python_code_only_for_python_strategies():
    with pytest.raises(ValidationError, match="Only PYTHON strategies can have python_code."):
        CreateStrategyRequest.model_validate(
            {
                "name": "x",
                "strategy_type": "NO_CODE",
                "strategy_config": config([], []),
                "python_code": PYTHON_STUB,
            }
        )


def test_python_strategy_without_code_is_allowed():
    # Strategies made from a core template run the template's code.
    request = CreateStrategyRequest.model_validate(
        {"name": "x", "strategy_type": "PYTHON", "strategy_config": config([], [])}
    )
    assert request.python_code is None


# --- versions -----------------------------------------------------------------


def make_strategy(**fields):
    strategy = MagicMock(spec=Strategy)
    strategy.version = 1
    strategy.strategy_config = {"parameters": {"a": 1}}
    strategy.python_code = None
    for key, value in fields.items():
        setattr(strategy, key, value)
    return strategy


def test_changed_config_raises_the_version():
    strategy = make_strategy()
    StrategyRepository(MagicMock()).update_for_user(
        strategy=strategy, strategy_config={"parameters": {"a": 2}}
    )
    assert strategy.version == 2


def test_same_config_keeps_the_version():
    strategy = make_strategy()
    StrategyRepository(MagicMock()).update_for_user(
        strategy=strategy, strategy_config={"parameters": {"a": 1}}, name="Renamed"
    )
    assert strategy.version == 1


def test_name_description_and_active_keep_the_version():
    strategy = make_strategy()
    StrategyRepository(MagicMock()).update_for_user(
        strategy=strategy, name="n", description="d", is_active=False
    )
    assert strategy.version == 1


def test_changed_code_raises_the_version_once():
    strategy = make_strategy(python_code=PYTHON_STUB)
    StrategyRepository(MagicMock()).update_for_user(
        strategy=strategy,
        python_code=PYTHON_STUB + "# v2\n",
        strategy_config={"parameters": {"a": 2}},
    )
    assert strategy.version == 2


# --- API against the real database ---------------------------------------------


@pytest.fixture
def real_user():
    db = SessionLocal()
    user = User(
        full_name="Builder Test",
        email=f"builder-{uuid4().hex[:8]}@example.com",
        password_hash="x",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield user
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.execute(delete(Strategy).where(Strategy.user_id == user.id))
        db.execute(delete(User).where(User.id == user.id))
        db.commit()
        db.close()


def test_no_code_strategy_round_trips_without_loss(real_user):
    sent = {
        "parameters": {"quantity": 10, "risk": 1.5, "label": "x", "short": False},
        "indicators": [
            {"name": "sma_20", "type": "SMA", "parameters": {"window": 20}},
            {"name": "macd", "type": "MACD", "parameters": {"fast_period": 12, "slow_period": 26, "signal_period": 9}},
        ],
        "entry_conditions": [
            cond({"type": "indicator", "name": "sma_20", "output": "value"}, CLOSE),
            cond(
                {"type": "indicator", "name": "macd", "output": "macd"},
                {"type": "indicator", "name": "macd", "output": "signal"},
                ">",
            ),
        ],
        "exit_conditions": [cond(CLOSE, {"type": "value", "value": 0}, "<=")],
    }
    created = client.post(
        "/strategies",
        json={"name": "Builder", "strategy_type": "NO_CODE", "strategy_config": sent},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["strategy_config"] == sent
    assert body["python_code"] is None
    assert body["version"] == 1

    fetched = client.get(f"/strategies/{body['id']}").json()
    assert fetched["strategy_config"] == sent

    sent["exit_conditions"][0]["operator"] = "<"
    patched = client.patch(f"/strategies/{body['id']}", json={"strategy_config": sent}).json()
    assert patched["strategy_config"] == sent
    assert patched["version"] == 2


def test_python_strategy_saves_code_and_counts_versions(real_user):
    created = client.post(
        "/strategies",
        json={
            "name": "My Python",
            "strategy_type": "PYTHON",
            "strategy_config": config([], []),
            "python_code": PYTHON_STUB,
        },
    ).json()
    assert created["python_code"] == PYTHON_STUB
    assert created["version"] == 1

    same = client.patch(f"/strategies/{created['id']}", json={"python_code": PYTHON_STUB}).json()
    assert same["version"] == 1

    changed = client.patch(
        f"/strategies/{created['id']}", json={"python_code": PYTHON_STUB + "# v2\n"}
    ).json()
    assert changed["version"] == 2
    assert client.get(f"/strategies/{created['id']}").json()["python_code"].endswith("# v2\n")


def test_bad_python_code_is_refused_with_422(real_user):
    response = client.post(
        "/strategies",
        json={
            "name": "Bad",
            "strategy_type": "PYTHON",
            "strategy_config": config([], []),
            "python_code": "def generate_signal(:\n",
        },
    )
    assert response.status_code == 422
    assert "Python syntax error on line 1" in response.text


def test_code_cannot_be_added_to_a_no_code_strategy(real_user):
    created = client.post(
        "/strategies",
        json={"name": "NC", "strategy_type": "NO_CODE", "strategy_config": config([], [])},
    ).json()
    response = client.patch(f"/strategies/{created['id']}", json={"python_code": PYTHON_STUB})
    assert response.status_code == 422
    assert response.json()["detail"] == "Only PYTHON strategies can have python_code."
