"""add the VALIDATION execution type (Phase 11 validation runs)

Revision ID: execution_type_validation
Revises: execution_run_settings
Create Date: 2026-10-17
"""

from alembic import op


revision = "execution_type_validation"
down_revision = "execution_run_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE execution_type ADD VALUE IF NOT EXISTS 'VALIDATION'")


def downgrade():
    # PostgreSQL cannot remove a value from an enum type; runs of this type would
    # have to be deleted first. Left in place.
    pass
