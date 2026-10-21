from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import BaseModelMixin


class RegimeModelRecord(BaseModelMixin, Base):
    """A trained (or training) market-regime model (Phase 12).

    One model is shared by the whole platform: the newest READY model is the
    active one. The fitted model is stored as a joblib artifact written by
    app.ml.persistence; it is only ever loaded from this table, which only the
    backend writes.
    """

    __tablename__ = "regime_models"

    __table_args__ = (
        CheckConstraint(
            "status IN ('TRAINING', 'READY', 'FAILED')",
            name="ck_regime_model_status",
        ),
        CheckConstraint(
            "model_kind IN ('GMM', 'RF', 'XGB', 'AUTO')",
            name="ck_regime_model_kind",
        ),
    )

    # 1, 2, 3, ... in the order the models were trained (shown as "Model 3").
    number: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False)

    model_version: Mapped[str] = mapped_column(String(50), nullable=False)

    # Feature 2: GMM (unsupervised clusters), RF, XGB, or AUTO (each dimension
    # keeps the better of Random Forest and XGBoost on the validation split).
    model_kind: Mapped[str] = mapped_column(
        String(10), nullable=False, default="GMM", server_default="GMM"
    )

    # Supervised models: the India VIX instrument used for features and labels.
    vix_instrument_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("instruments.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Supervised models: what each dimension's classes mean (horizon, thresholds).
    label_definition: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Supervised models: the test-split evaluation (accuracy, baselines, ...).
    evaluation: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # The reference instrument the model was trained on and describes.
    instrument_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("instruments.id", ondelete="SET NULL"),
        nullable=True,
    )

    trained_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # What was asked for (dates, feature windows, candidate cluster counts, seed).
    settings: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Filled in when training finishes: model card, dataset, regime labels.
    model_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    artifact: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    error_message: Mapped[str | None] = mapped_column(String, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
