import pytest
from pydantic import ValidationError

from app.schemas.strategies.config import StrategyConfig


def valid_config():
    return {
        "parameters": {
            "risk_percent": 2,
            "quantity": 10,
            "allow_short": True,
        },
        "indicators": [
            {
                "name": "sma_20",
                "type": "SMA",
                "parameters": {
                    "period": 20,
                },
            },
            {
                "name": "sma_50",
                "type": "SMA",
                "parameters": {
                    "period": 50,
                },
            },
            {
                "name": "rsi_14",
                "type": "RSI",
                "parameters": {
                    "period": 14,
                },
            },
        ],
        "entry_conditions": [
            {
                "left": {
                    "type": "indicator",
                    "name": "rsi_14",
                },
                "operator": "<",
                "right": {
                    "type": "value",
                    "value": 30,
                },
            },
            {
                "left": {
                    "type": "indicator",
                    "name": "sma_20",
                },
                "operator": ">",
                "right": {
                    "type": "indicator",
                    "name": "sma_50",
                },
            },
        ],
        "exit_conditions": [
            {
                "left": {
                    "type": "indicator",
                    "name": "rsi_14",
                },
                "operator": ">",
                "right": {
                    "type": "value",
                    "value": 70,
                },
            }
        ],
    }


def test_valid_strategy_config():
    config = StrategyConfig.model_validate(valid_config())

    assert config.parameters["risk_percent"] == 2
    assert len(config.indicators) == 3
    assert len(config.entry_conditions) == 2
    assert len(config.exit_conditions) == 1


def test_empty_sections_are_valid():
    config = StrategyConfig.model_validate(
        {
            "parameters": {},
            "indicators": [],
            "entry_conditions": [],
            "exit_conditions": [],
        }
    )

    assert config.parameters == {}
    assert config.indicators == []
    assert config.entry_conditions == []
    assert config.exit_conditions == []


@pytest.mark.parametrize(
    "missing_field",
    [
        "parameters",
        "indicators",
        "entry_conditions",
        "exit_conditions",
    ],
)
def test_top_level_sections_are_required(missing_field):
    data = valid_config()
    data.pop(missing_field)

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)


def test_value_operand_is_valid():
    config = valid_config()

    condition = config["entry_conditions"][0]

    assert condition["right"] == {
        "type": "value",
        "value": 30,
    }


def test_indicator_operand_is_valid():
    config = valid_config()

    condition = config["entry_conditions"][1]

    assert condition["right"] == {
        "type": "indicator",
        "name": "sma_50",
    }


@pytest.mark.parametrize(
    "operator",
    ["<", "<=", ">", ">=", "=="],
)
def test_supported_operators_are_valid(operator):
    data = valid_config()
    data["entry_conditions"][0]["operator"] = operator

    config = StrategyConfig.model_validate(data)

    assert config.entry_conditions[0].operator == operator


@pytest.mark.parametrize(
    "operator",
    ["!=", "crosses_above", "crosses_below", "AND", "OR"],
)
def test_unsupported_operators_are_rejected(operator):
    data = valid_config()
    data["entry_conditions"][0]["operator"] = operator

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)

def test_indicator_requires_name():
    data = valid_config()
    data["indicators"][0].pop("name")

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)


def test_indicator_requires_type():
    data = valid_config()
    data["indicators"][0].pop("type")

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)


def test_indicator_requires_parameters():
    data = valid_config()
    data["indicators"][0].pop("parameters")

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)


def test_indicator_parameters_must_be_object():
    data = valid_config()
    data["indicators"][0]["parameters"] = "invalid"

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)


def test_condition_requires_left():
    data = valid_config()
    data["entry_conditions"][0].pop("left")

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)


def test_condition_requires_operator():
    data = valid_config()
    data["entry_conditions"][0].pop("operator")

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)


def test_condition_requires_right():
    data = valid_config()
    data["entry_conditions"][0].pop("right")

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)


def test_indicator_operand_requires_name():
    data = valid_config()
    data["entry_conditions"][0]["left"].pop("name")

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)


def test_value_operand_requires_value():
    data = valid_config()
    data["entry_conditions"][0]["right"].pop("value")

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)


def test_parameters_reject_complex_nested_values():
    data = valid_config()
    data["parameters"]["nested"] = {"unexpected": "object"}

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)

def test_indicator_names_must_be_unique():
    data = valid_config()

    data["indicators"][1]["name"] = data["indicators"][0]["name"]

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)

def test_condition_indicator_reference_must_exist():
    data = valid_config()

    data["entry_conditions"][0]["left"]["name"] = "does_not_exist"

    with pytest.raises(ValidationError):
        StrategyConfig.model_validate(data)