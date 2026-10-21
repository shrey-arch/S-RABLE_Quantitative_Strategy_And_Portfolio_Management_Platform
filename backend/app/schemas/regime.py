"""Market-regime API (Phase 12, Feature 2): train a model, read the current regime and its history.

Phase 12's Gaussian mixture describes recent behaviour (unsupervised clusters).
Feature 2's supervised models (Random Forest, XGBoost) classify the NEXT
`horizon_days` trading days in three dimensions, with a test-split accuracy.
"""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

ModelStatus = Literal["TRAINING", "READY", "FAILED"]

STATEMENT = (
    "The regime is the model's classification of the market's recent behaviour "
    "(volatility and trend). It describes the past; it is not a forecast."
)
SUPERVISED_STATEMENT = (
    "Model classification of the next {horizon} trading days, not a guarantee. "
    "Its out-of-sample accuracy is shown on the model card."
)

ModelKind = Literal["GMM", "RF", "XGB", "AUTO"]


class TrainRegimeModelRequest(BaseModel):
    instrument_id: UUID = Field(
        description="The reference instrument: the model is trained on it and describes it."
    )
    start_date: date | None = Field(default=None, description="First day of training data (all stored data if empty).")
    end_date: date | None = Field(default=None, description="Last day of training data (all stored data if empty).")
    volatility_window: int = Field(default=20, ge=5, le=120, description="Days in the volatility feature.")
    trend_window: int = Field(default=20, ge=5, le=120, description="Days in the trend-strength feature.")
    candidate_components: list[int] = Field(
        default_factory=lambda: [2, 3, 4],
        min_length=1,
        max_length=5,
        description="Cluster counts to try; the one with the lowest validation BIC is kept.",
    )
    random_state: int = Field(default=42, ge=0, le=2**31 - 1, description="Seed: the same data and seed give the same model.")
    model_kind: ModelKind = Field(
        default="GMM",
        description=(
            "GMM: unsupervised clusters (Phase 12). RF / XGB: supervised Random Forest / XGBoost. "
            "AUTO: both, each dimension keeps the better on the validation split."
        ),
    )
    horizon_days: int = Field(
        default=20, ge=5, le=60, description="Supervised models: the labels describe this many days ahead."
    )
    vix_instrument_id: UUID | None = Field(
        default=None,
        description="Supervised models: India VIX (features, and the risk-off rule). Optional.",
    )

    @field_validator("candidate_components")
    @classmethod
    def check_components(cls, values):
        if any(not 2 <= v <= 6 for v in values):
            raise ValueError("Each cluster count must be from 2 to 6.")
        if len(set(values)) != len(values):
            raise ValueError("Each cluster count can be given only once.")
        return sorted(values)

    @model_validator(mode="after")
    def check_dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date.")
        return self


class InstrumentRef(BaseModel):
    id: UUID | None
    symbol: str | None
    trading_symbol: str | None


class RegimeLabel(BaseModel):
    regime_id: int = Field(description="The model's cluster number (GMM) or combined-regime number.")
    code: str = Field(
        description="GMM: R1, R2, ... from the calmest to the most volatile. Supervised: e.g. HV-UP-OFF."
    )
    name: str
    volatility_state: Literal["High volatility", "Low volatility"]
    trend_state: Literal["Uptrend", "Downtrend", "Sideways"]
    risk_state: Literal["Risk-on", "Risk-off"] | None = None
    # Gaussian mixture only: the cluster centre in the features' units.
    mean_log_return: float | None = None
    mean_realized_volatility: float | None = None
    mean_trend_strength: float | None = None
    annualized_return: float | None = None
    annualized_volatility: float | None = None
    training_days: int
    training_share: float


class RegimeLabels(BaseModel):
    rule: str
    median_training_volatility: float | None = None
    trend_band: float | None = None
    regimes: list[RegimeLabel]


class Evaluation(BaseModel):
    validation_bic: float
    test_bic: float
    test_sample_count: int
    test_component_counts: dict[str, int]
    test_mean_max_probability: float
    test_mean_entropy: float


class DatasetSplitInfo(BaseModel):
    name: Literal["train", "validation", "test"]
    rows: int
    start: str
    end: str
    label_window_end: str | None = Field(
        default=None, description="Supervised: the last day any of this split's labels looks at."
    )


class PurgeGap(BaseModel):
    between: str
    days: int
    dropped_rows: int
    start: str | None
    end: str | None


class DatasetInfo(BaseModel):
    bars: int
    first_bar: str
    last_bar: str
    dropped_warm_up_rows: int
    ratios: dict[str, float]
    splits: list[DatasetSplitInfo]
    data_fingerprint: str | None
    provider: str | None
    purges: list[PurgeGap] | None = None
    unlabelled_rows: int | None = Field(
        default=None, description="Supervised: the last days, whose next days are not known yet."
    )
    vix_bars: int | None = None


class FeatureInfo(BaseModel):
    name: str
    description: str


class LabelRule(BaseModel):
    key: str
    name: str
    classes: list[str]
    rule: str


class LabelDefinition(BaseModel):
    horizon_days: int
    volatility_threshold: float = Field(description="Annualised; the median of the training days.")
    trend_threshold: float
    drawdown_threshold: float
    uses_vix: bool
    vix_median_window: int
    rules: list[LabelRule]


class Scores(BaseModel):
    accuracy: float
    balanced_accuracy: float


class Baseline(Scores):
    name: Literal["majority", "persistence"]
    label: str
    description: str
    rows: int


class ClassScore(BaseModel):
    label: str
    precision: float
    recall: float
    f1: float
    support: int


class TestScores(Scores):
    rows: int
    target: float
    meets_target: bool = Field(description="accuracy >= target, as computed.")
    beats_baselines: bool
    per_class: list[ClassScore]
    confusion_matrix: list[list[int]] = Field(
        description="Rows: actual class; columns: predicted class (in the order of classes)."
    )
    baselines: list[Baseline]


class GridResult(BaseModel):
    params: dict
    cv_balanced_accuracy: float | None
    cv_folds_scored: int


class Candidate(BaseModel):
    kind: Literal["RF", "XGB"]
    kind_name: str
    params: dict
    cv_balanced_accuracy: float | None
    grid: list[GridResult]
    validation: Scores


class Importance(BaseModel):
    feature: str
    importance: float


class DimensionEvaluation(BaseModel):
    key: Literal["volatility", "trend", "risk"]
    name: str
    classes: list[str]
    chosen_kind: Literal["RF", "XGB"]
    chosen_kind_name: str
    chosen_params: dict
    candidates: list[Candidate]
    test: TestScores
    class_counts: dict[str, dict[str, int]]
    feature_importance: list[Importance]
    importance_method: str


class EvaluationSummary(BaseModel):
    mean_accuracy: float
    dimensions: int
    dimensions_meeting_target: int


class SupervisedEvaluation(BaseModel):
    target_accuracy: float
    horizon_days: int
    selection: str
    cv_folds: int
    dimensions: list[DimensionEvaluation]
    summary: EvaluationSummary


class SupervisedCard(BaseModel):
    label_definition: LabelDefinition
    evaluation: SupervisedEvaluation
    uses_volume: bool
    volume_note: str
    xgboost_version: str | None


class ModelCard(BaseModel):
    model_kind: ModelKind
    model_type: str
    model_version: str
    training_start: str
    training_end: str
    selection: str
    random_state: int
    features: list[FeatureInfo]
    performance_note: str
    labels: RegimeLabels
    dataset: DatasetInfo
    scikit_learn_version: str
    created_at: str
    # Gaussian mixture only.
    n_components: int | None = None
    candidate_components: list[int] | None = None
    feature_parameters: dict[str, int] | None = None
    parameters: dict | None = None
    evaluation: Evaluation | None = None
    # Supervised only.
    supervised: SupervisedCard | None = None


class RegimeModelSummary(BaseModel):
    id: UUID
    number: int
    status: ModelStatus
    is_active: bool = Field(description="The newest ready model, used for the current regime.")
    model_version: str
    model_kind: ModelKind
    instrument: InstrumentRef
    vix_instrument: InstrumentRef | None = None
    settings: dict
    trained_by_you: bool
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class RegimeModelDetail(RegimeModelSummary):
    card: ModelCard | None = Field(description="Filled in when the model is READY.")


class RegimeProbability(BaseModel):
    regime_id: int
    code: str
    name: str
    probability: float


class ClassProbability(BaseModel):
    label: str
    probability: float


class DimensionReading(BaseModel):
    key: Literal["volatility", "trend", "risk"]
    name: str
    label: str
    probability: float
    probabilities: list[ClassProbability]


class CurrentRegime(BaseModel):
    statement: str = STATEMENT
    model: RegimeModelSummary
    instrument: InstrumentRef
    as_of: str = Field(description="The last stored daily bar the regime was classified on.")
    regime: RegimeLabel
    confidence: float = Field(
        description="GMM: the probability of this cluster. Supervised: the three dimensions' probabilities multiplied."
    )
    probabilities: list[RegimeProbability]
    horizon_days: int | None = Field(default=None, description="Supervised: the days the labels describe.")
    dimensions: list[DimensionReading] | None = Field(default=None, description="Supervised only.")


class HistoryPoint(BaseModel):
    timestamp: str
    close: float
    regime_id: int | None = Field(description="None during warm-up (features not complete yet).")
    confidence: float | None
    dimensions: dict[str, str] | None = Field(
        default=None, description="Supervised: each dimension's predicted class for the next days."
    )


class RegimeHistoryPeriod(BaseModel):
    regime_id: int | None
    code: str | None
    name: str
    start: str
    end: str
    bars: int


class RegimeTransition(BaseModel):
    timestamp: str
    from_regime_id: int
    from_code: str
    from_name: str
    to_regime_id: int
    to_code: str
    to_name: str
    confidence: float


class DimensionPeriod(BaseModel):
    label: str | None
    start: str
    end: str
    bars: int


class DimensionPeriods(BaseModel):
    key: Literal["volatility", "trend", "risk"]
    name: str
    classes: list[str]
    periods: list[DimensionPeriod]


class RegimeHistory(BaseModel):
    statement: str = STATEMENT
    model: RegimeModelSummary
    instrument: InstrumentRef
    start: str
    end: str
    training_start: str
    training_end: str
    regimes: list[RegimeLabel]
    points: list[HistoryPoint]
    periods: list[RegimeHistoryPeriod]
    transitions: list[RegimeTransition]
    horizon_days: int | None = None
    dimension_periods: list[DimensionPeriods] | None = Field(
        default=None, description="Supervised: one band row per dimension."
    )
