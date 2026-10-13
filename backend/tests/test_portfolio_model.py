from decimal import Decimal

from sqlalchemy import CheckConstraint

from app.db import Base
from app.models import Execution, Portfolio, User
from app.models.portfolio import portfolio_executions


def test_portfolio_tables_are_registered():
    assert "portfolios" in Base.metadata.tables
    assert "portfolio_executions" in Base.metadata.tables


def test_portfolio_has_expected_columns():
    assert {
        "id",
        "user_id",
        "name",
        "description",
        "initial_capital",
        "created_at",
        "updated_at",
    }.issubset(Portfolio.__table__.columns.keys())


def test_portfolio_initial_capital_must_be_positive():
    constraints = [
        constraint
        for constraint in Portfolio.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    ]

    assert any(
        constraint.name == "ck_portfolio_initial_capital_positive"
        for constraint in constraints
    )


def test_portfolio_execution_association_has_composite_primary_key():
    primary_key_columns = {
        column.name
        for column in portfolio_executions.primary_key.columns
    }

    assert primary_key_columns == {"portfolio_id", "execution_id"}


def test_portfolio_execution_association_has_cascade_foreign_keys():
    foreign_keys = {
        (foreign_key.parent.name, foreign_key.ondelete)
        for foreign_key in portfolio_executions.foreign_keys
    }

    assert foreign_keys == {
        ("portfolio_id", "CASCADE"),
        ("execution_id", "CASCADE"),
    }


def test_portfolio_relationships_are_configured():
    assert Portfolio.user.property.back_populates == "portfolios"
    assert Portfolio.executions.property.back_populates == "portfolios"
    assert User.portfolios.property.back_populates == "user"
    assert Execution.portfolios.property.back_populates == "executions"


def test_portfolio_capital_uses_decimal_precision():
    column = Portfolio.__table__.columns["initial_capital"]

    assert column.type.precision == 18
    assert column.type.scale == 2
    assert isinstance(Decimal("100000.00"), Decimal)
