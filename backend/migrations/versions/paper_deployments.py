"""paper trading P2/P3: strategy deployments, their daily log, account equity
snapshots, and the journal (note, tags) and deployment link on paper orders

Revision ID: paper_deployments
Revises: paper_trading
Create Date: 2026-10-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "paper_deployments"
down_revision = "paper_trading"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)
UUID = postgresql.UUID(as_uuid=True)


def _base():
    return [
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade():
    op.create_table(
        "paper_deployments",
        *_base(),
        sa.Column("account_id", UUID, sa.ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("strategy_id", UUID, sa.ForeignKey("strategies.id", ondelete="SET NULL")),
        sa.Column("validation_id", UUID, sa.ForeignKey("executions.id", ondelete="SET NULL")),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("strategy_key", sa.String(60), nullable=False),
        sa.Column("strategy_version", sa.Integer()),
        sa.Column("parameters", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("rules", postgresql.JSONB()),
        sa.Column("layout", sa.String(10), nullable=False),
        sa.Column("instrument_ids", postgresql.JSONB(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("capital", MONEY, nullable=False),
        sa.Column("loss_limit", sa.Float()),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date()),
        sa.Column("status", sa.String(10), nullable=False, server_default="ACTIVE"),
        sa.Column("status_reason", sa.String(300)),
        sa.Column("last_processed_date", sa.Date()),
        sa.Column("state", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("peak_equity", MONEY),
        sa.Column("breaches", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'PAUSED', 'STOPPED', 'COMPLETED', 'FAILED')",
            name="ck_paper_deployments_status",
        ),
        sa.CheckConstraint("capital > 0", name="ck_paper_deployments_capital"),
        sa.CheckConstraint("quantity > 0", name="ck_paper_deployments_quantity"),
    )
    op.create_index("ix_paper_deployments_account_id", "paper_deployments", ["account_id"])
    op.create_table(
        "paper_deployment_days",
        *_base(),
        sa.Column("deployment_id", UUID, sa.ForeignKey("paper_deployments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("closes", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("signal", sa.String(10)),
        sa.Column("allocations", postgresql.JSONB()),
        sa.Column("targets", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("orders", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("cash", MONEY),
        sa.Column("positions_value", MONEY),
        sa.Column("equity", MONEY),
        sa.Column("drawdown", sa.Float()),
        sa.Column("note", sa.String(500)),
        sa.UniqueConstraint("deployment_id", "day", name="uq_paper_deployment_days_day"),
    )
    op.create_index("ix_paper_deployment_days_deployment_id", "paper_deployment_days", ["deployment_id"])
    op.create_table(
        "paper_equity_snapshots",
        *_base(),
        sa.Column("account_id", UUID, sa.ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("cash", MONEY, nullable=False),
        sa.Column("holdings_value", MONEY, nullable=False),
        sa.Column("equity", MONEY, nullable=False),
        sa.Column("note", sa.String(300)),
        sa.UniqueConstraint("account_id", "day", name="uq_paper_equity_snapshots_day"),
    )
    op.create_index("ix_paper_equity_snapshots_account_id", "paper_equity_snapshots", ["account_id"])
    op.add_column(
        "paper_orders",
        sa.Column("deployment_id", UUID, sa.ForeignKey("paper_deployments.id", ondelete="SET NULL")),
    )
    op.create_index("ix_paper_orders_deployment_id", "paper_orders", ["deployment_id"])
    op.add_column("paper_orders", sa.Column("note", sa.String(1000)))
    op.add_column("paper_orders", sa.Column("tags", postgresql.JSONB(), nullable=False, server_default="[]"))
    op.create_check_constraint(
        "ck_paper_orders_source", "paper_orders", "source IN ('MANUAL', 'STRATEGY')"
    )


def downgrade():
    op.drop_constraint("ck_paper_orders_source", "paper_orders", type_="check")
    op.drop_column("paper_orders", "tags")
    op.drop_column("paper_orders", "note")
    op.drop_index("ix_paper_orders_deployment_id", "paper_orders")
    op.drop_column("paper_orders", "deployment_id")
    op.drop_table("paper_equity_snapshots")
    op.drop_table("paper_deployment_days")
    op.drop_table("paper_deployments")
