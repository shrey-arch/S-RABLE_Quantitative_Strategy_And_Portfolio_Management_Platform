"""supervised regime models (Feature 2): model kind (GMM / RF / XGB / AUTO),
the label definition and the test-split evaluation, and the India VIX
instrument a model uses

Revision ID: supervised_regime
Revises: paper_deployments
Create Date: 2026-10-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "supervised_regime"
down_revision = "paper_deployments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "regime_models",
        sa.Column("model_kind", sa.String(length=10), nullable=False, server_default="GMM"),
    )
    op.create_check_constraint(
        "ck_regime_model_kind", "regime_models", "model_kind IN ('GMM', 'RF', 'XGB', 'AUTO')"
    )
    op.add_column(
        "regime_models",
        sa.Column("label_definition", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "regime_models",
        sa.Column("evaluation", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "regime_models",
        sa.Column("vix_instrument_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_regime_models_vix_instrument",
        "regime_models",
        "instruments",
        ["vix_instrument_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_regime_models_vix_instrument", "regime_models", type_="foreignkey")
    op.drop_column("regime_models", "vix_instrument_id")
    op.drop_column("regime_models", "evaluation")
    op.drop_column("regime_models", "label_definition")
    op.drop_constraint("ck_regime_model_kind", "regime_models", type_="check")
    op.drop_column("regime_models", "model_kind")
