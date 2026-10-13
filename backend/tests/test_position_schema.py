from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.positions import (
    CreatePositionRequest,
    UpdatePositionRequest,
)


def valid_create_data():
    return {
        "execution_id": uuid4(),
        "instrument_id": uuid4(),
        "quantity": 100,
        "average_price": 250.00,
        "current_price": 255.00,
        "market_value": 25500.00,
        "realized_pnl": 0.00,
        "unrealized_pnl": 500.00,
        "last_updated_at": datetime.now(timezone.utc),
    }


def test_create_position_schema_rejects_zero_quantity():
    data = valid_create_data()
    data["quantity"] = 0

    with pytest.raises(ValidationError):
        CreatePositionRequest(**data)


def test_create_position_schema_rejects_zero_average_price():
    data = valid_create_data()
    data["average_price"] = 0

    with pytest.raises(ValidationError):
        CreatePositionRequest(**data)


def test_create_position_schema_rejects_zero_current_price():
    data = valid_create_data()
    data["current_price"] = 0

    with pytest.raises(ValidationError):
        CreatePositionRequest(**data)


def test_create_position_schema_rejects_negative_market_value():
    data = valid_create_data()
    data["market_value"] = -1

    with pytest.raises(ValidationError):
        CreatePositionRequest(**data)


def test_update_position_schema_rejects_invalid_quantity():
    with pytest.raises(ValidationError):
        UpdatePositionRequest(quantity=0)


def test_update_position_schema_rejects_invalid_average_price():
    with pytest.raises(ValidationError):
        UpdatePositionRequest(average_price=0)


def test_update_position_schema_rejects_invalid_current_price():
    with pytest.raises(ValidationError):
        UpdatePositionRequest(current_price=0)


def test_update_position_schema_rejects_negative_market_value():
    with pytest.raises(ValidationError):
        UpdatePositionRequest(market_value=-1)
