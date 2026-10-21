"""Supervised market-regime models (Feature 2): Random Forest and XGBoost.

Three classifiers ("three parallel models") each predict one dimension of the
regime of the NEXT `horizon` trading days of the reference index (Nifty 50),
from features known at today's close:

- volatility: High / Low. Realised volatility of the next `horizon` daily log
  returns above the median of the training days, or not.
- trend: Uptrend / Sideways / Downtrend. Return over the next `horizon` days
  above +TREND_THRESHOLD, below -TREND_THRESHOLD, or in between.
- risk sentiment: Risk-off / Risk-on. Risk-off when, within the next `horizon`
  days, the index closes more than DRAWDOWN_THRESHOLD below today's close, or
  (when India VIX is used) the average VIX is above its trailing 1-year median.

Leakage control:
- every feature on day t uses data up to day t only (causal rolling windows);
- labels look `horizon` days ahead, so the last `horizon` rows before the next
  split are purged: no training label window overlaps validation days, and no
  validation label window overlaps test days;
- thresholds (the volatility median) are fitted on training days only;
- hyperparameters are chosen by purged walk-forward cross-validation on the
  training split, the model kind on the validation split, and the test split is
  used once, for the reported figures.
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass, field
from itertools import product

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sklearn.utils.class_weight import compute_sample_weight

TRADING_DAYS = 252
DEFAULT_HORIZON = 20
TREND_THRESHOLD = 0.02
DRAWDOWN_THRESHOLD = 0.05
VIX_MEDIAN_WINDOW = 252
TARGET_ACCURACY = 0.70
SPLIT = {"train": 0.70, "validation": 0.15, "test": 0.15}
CV_FOLDS = 3
MIN_LABELLED_ROWS = 500
VOLUME_MIN_SHARE = 0.80

KINDS = ("RF", "XGB")
KIND_NAMES = {
    "GMM": "Gaussian mixture (unsupervised)",
    "RF": "Random Forest",
    "XGB": "XGBoost",
    "AUTO": "Random Forest or XGBoost, the better on the validation split",
}

DIMENSIONS = ("volatility", "trend", "risk")
DIMENSION_NAMES = {"volatility": "Volatility", "trend": "Trend", "risk": "Risk sentiment"}
CLASSES = {
    "volatility": ("Low volatility", "High volatility"),
    "trend": ("Downtrend", "Sideways", "Uptrend"),
    "risk": ("Risk-on", "Risk-off"),
}

PRICE_FEATURES = (
    "return_5d",
    "return_20d",
    "return_60d",
    "volatility_10d",
    "volatility_20d",
    "volatility_60d",
    "trend_strength_20d",
    "distance_from_252d_high",
)
VOLUME_FEATURES = ("volume_zscore_60d",)
VIX_FEATURES = ("vix_level", "vix_change_20d", "vix_zscore_252d")

FEATURE_DESCRIPTIONS = {
    "return_5d": "Log return of the close over the last 5 trading days.",
    "return_20d": "Log return of the close over the last 20 trading days.",
    "return_60d": "Log return of the close over the last 60 trading days.",
    "volatility_10d": "Annualised standard deviation of daily log returns, last 10 days.",
    "volatility_20d": "Annualised standard deviation of daily log returns, last 20 days.",
    "volatility_60d": "Annualised standard deviation of daily log returns, last 60 days.",
    "trend_strength_20d": "Mean daily log return over 20 days divided by its standard deviation.",
    "distance_from_252d_high": "Close divided by the highest close of the last 252 days, minus 1.",
    "volume_zscore_60d": "Log volume minus its 60-day mean, in 60-day standard deviations.",
    "vix_level": "India VIX close (aligned to the index's trading days).",
    "vix_change_20d": "India VIX change over the last 20 trading days (relative).",
    "vix_zscore_252d": "India VIX minus its 252-day mean, in 252-day standard deviations.",
}

RF_GRID = tuple(
    {"max_depth": depth, "min_samples_leaf": leaf}
    for depth, leaf in product((4, 8, None), (10, 40))
)
XGB_GRID = tuple(
    {"max_depth": depth, "n_estimators": trees} for depth, trees in product((2, 4), (100, 300))
)
RF_FIXED = {"n_estimators": 300, "max_features": "sqrt", "class_weight": "balanced", "n_jobs": -1}
XGB_FIXED = {
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 5,
    "reg_lambda": 1.0,
    "tree_method": "hist",
    "n_jobs": 2,
    "verbosity": 0,
}

IMPORTANCE_METHOD = {
    "RF": "Mean decrease in impurity (scikit-learn feature_importances_), scaled to sum to 1.",
    "XGB": "Average gain of the splits on each feature (XGBoost feature_importances_), scaled to sum to 1.",
}


def combos() -> list[dict]:
    """Every combined regime (2 x 3 x 2 = 12), numbered in a fixed order."""
    vol_code = {"Low volatility": "LV", "High volatility": "HV"}
    trend_code = {"Uptrend": "UP", "Sideways": "SW", "Downtrend": "DN"}
    risk_code = {"Risk-on": "ON", "Risk-off": "OFF"}
    rows = []
    for vol, trend, risk in product(
        CLASSES["volatility"], ("Uptrend", "Sideways", "Downtrend"), CLASSES["risk"]
    ):
        rows.append(
            {
                "regime_id": len(rows),
                "code": f"{vol_code[vol]}-{trend_code[trend]}-{risk_code[risk]}",
                "name": f"{vol.split()[0]} vol, {trend.lower()}, {risk.lower()}",
                "volatility_state": vol,
                "trend_state": trend,
                "risk_state": risk,
            }
        )
    return rows


COMBO_INDEX = {(c["volatility_state"], c["trend_state"], c["risk_state"]): c["regime_id"] for c in combos()}


# --- features --------------------------------------------------------------------


def volume_usable(data: pd.DataFrame) -> bool:
    """Volume is a feature only when most bars have it (indices often report 0) and it varies."""
    if "volume" not in data.columns or data.empty:
        return False
    volume = pd.to_numeric(data["volume"], errors="coerce").fillna(0)
    # A volume that never changes carries no information.
    return float((volume > 0).mean()) >= VOLUME_MIN_SHARE and volume[volume > 0].nunique() > 1


def feature_columns(*, use_volume: bool, use_vix: bool) -> tuple[str, ...]:
    return PRICE_FEATURES + (VOLUME_FEATURES if use_volume else ()) + (VIX_FEATURES if use_vix else ())


def _check_close(data: pd.DataFrame) -> pd.Series:
    if not isinstance(data, pd.DataFrame) or data.empty or "close" not in data.columns:
        raise ValueError("data must be a non-empty DataFrame with a close column.")
    if not data.index.is_unique or not data.index.is_monotonic_increasing:
        raise ValueError("data index must be unique and chronological.")
    close = pd.to_numeric(data["close"], errors="coerce")
    if close.isna().any() or (close <= 0).any():
        raise ValueError("close values must be finite and above zero.")
    return close


def generate_features(
    data: pd.DataFrame,
    vix: pd.Series | None = None,
    *,
    use_volume: bool = False,
) -> pd.DataFrame:
    """Causal features of every day: each row uses closes (and VIX) up to that day."""
    close = _check_close(data)
    log_close = np.log(close)
    returns = log_close.diff()
    annual = math.sqrt(TRADING_DAYS)
    out = pd.DataFrame(index=data.index)
    for n in (5, 20, 60):
        out[f"return_{n}d"] = log_close - log_close.shift(n)
    for n in (10, 20, 60):
        out[f"volatility_{n}d"] = returns.rolling(n, min_periods=n).std(ddof=1) * annual
    mean20 = returns.rolling(20, min_periods=20).mean()
    std20 = returns.rolling(20, min_periods=20).std(ddof=1)
    out["trend_strength_20d"] = mean20.div(std20.where(std20 > 0))
    out["distance_from_252d_high"] = close / close.rolling(252, min_periods=252).max() - 1
    if use_volume:
        volume = pd.to_numeric(data["volume"], errors="coerce")
        logv = np.log(volume.where(volume > 0))
        mean = logv.rolling(60, min_periods=40).mean()
        std = logv.rolling(60, min_periods=40).std(ddof=1)
        # Volume that did not change over the window is at its mean: z-score 0.
        z = ((logv - mean) / std.where(std > 0)).mask(std.eq(0) & logv.notna(), 0.0)
        # A day without volume keeps the last known z-score (for at most 5 days).
        out["volume_zscore_60d"] = z.ffill(limit=5)
    if vix is not None:
        v = pd.to_numeric(vix.reindex(data.index), errors="coerce")
        v = v.where(v > 0)
        out["vix_level"] = v
        out["vix_change_20d"] = v / v.shift(20) - 1
        mean = v.rolling(252, min_periods=120).mean()
        std = v.rolling(252, min_periods=120).std(ddof=1)
        out["vix_zscore_252d"] = (v - mean) / std.where(std > 0)
    out = out.replace([np.inf, -np.inf], np.nan)
    return out.loc[:, feature_columns(use_volume=use_volume, use_vix=vix is not None)]


# --- labels ----------------------------------------------------------------------


def forward_outcomes(close: pd.Series, vix: pd.Series | None, horizon: int) -> pd.DataFrame:
    """What happens over days t+1 .. t+horizon (NaN for the last `horizon` days)."""
    returns = np.log(close).diff()
    out = pd.DataFrame(index=close.index)
    out["forward_volatility"] = (
        returns.rolling(horizon, min_periods=horizon).std(ddof=1).shift(-horizon)
        * math.sqrt(TRADING_DAYS)
    )
    out["forward_return"] = close.shift(-horizon) / close - 1
    out["forward_min_return"] = close.rolling(horizon, min_periods=horizon).min().shift(-horizon) / close - 1
    if vix is not None:
        v = pd.to_numeric(vix.reindex(close.index), errors="coerce")
        out["forward_vix_mean"] = v.rolling(horizon, min_periods=horizon).mean().shift(-horizon)
        out["vix_median_1y"] = v.rolling(VIX_MEDIAN_WINDOW, min_periods=120).median()
    return out


def make_labels(
    outcomes: pd.DataFrame,
    *,
    volatility_threshold: float,
    trend_threshold: float = TREND_THRESHOLD,
    drawdown_threshold: float = DRAWDOWN_THRESHOLD,
) -> pd.DataFrame:
    """Class names of each dimension (NaN where the future is not known yet)."""
    labels = pd.DataFrame(index=outcomes.index, columns=list(DIMENSIONS), dtype=object)
    vol = outcomes["forward_volatility"]
    labels["volatility"] = np.where(
        vol.isna(), None, np.where(vol > volatility_threshold, "High volatility", "Low volatility")
    )
    ret = outcomes["forward_return"]
    labels["trend"] = np.where(
        ret.isna(),
        None,
        np.where(ret > trend_threshold, "Uptrend", np.where(ret < -trend_threshold, "Downtrend", "Sideways")),
    )
    drop = outcomes["forward_min_return"] < -drawdown_threshold
    known = outcomes["forward_min_return"].notna()
    if "forward_vix_mean" in outcomes.columns:
        elevated = outcomes["forward_vix_mean"] > outcomes["vix_median_1y"]
        known &= outcomes["forward_vix_mean"].notna() & outcomes["vix_median_1y"].notna()
        off = drop | elevated
    else:
        off = drop
    labels["risk"] = np.where(~known, None, np.where(off, "Risk-off", "Risk-on"))
    return labels.replace({None: np.nan})


def label_rules(
    horizon: int,
    *,
    volatility_threshold: float,
    trend_threshold: float,
    drawdown_threshold: float,
    uses_vix: bool,
) -> list[dict]:
    risk = (
        f"Risk-off when, within the next {horizon} trading days, the index closes more than "
        f"{drawdown_threshold:.0%} below today's close"
        + (
            ", or India VIX's average over those days is above its median of the last "
            f"{VIX_MEDIAN_WINDOW} trading days (known today)"
            if uses_vix
            else " (India VIX was not used for this model)"
        )
        + "; risk-on otherwise."
    )
    return [
        {
            "key": "volatility",
            "name": DIMENSION_NAMES["volatility"],
            "classes": list(CLASSES["volatility"]),
            "rule": (
                f"High volatility when the annualised standard deviation of the next {horizon} daily "
                f"log returns is above {volatility_threshold:.2%} (the median of the training days); "
                "low otherwise."
            ),
        },
        {
            "key": "trend",
            "name": DIMENSION_NAMES["trend"],
            "classes": list(CLASSES["trend"]),
            "rule": (
                f"Uptrend when the return over the next {horizon} trading days is above "
                f"+{trend_threshold:.0%}, downtrend below -{trend_threshold:.0%}, sideways in between."
            ),
        },
        {"key": "risk", "name": DIMENSION_NAMES["risk"], "classes": list(CLASSES["risk"]), "rule": risk},
    ]


# --- dataset ---------------------------------------------------------------------


@dataclass
class SupervisedDataset:
    features: pd.DataFrame  # every day, NaN during warm-up
    outcomes: pd.DataFrame  # every day, NaN for the last `horizon` days
    labels: pd.DataFrame  # every day (volatility threshold from the training days)
    positions: pd.Series  # trading-day number of every day
    train: pd.DatetimeIndex
    validation: pd.DatetimeIndex
    test: pd.DatetimeIndex
    horizon: int
    volatility_threshold: float
    use_volume: bool
    use_vix: bool
    warm_up_rows: int
    unlabelled_rows: int
    purges: list[dict] = field(default_factory=list)


def prepare_dataset(
    data: pd.DataFrame,
    vix: pd.Series | None = None,
    *,
    horizon: int = DEFAULT_HORIZON,
    use_volume: bool | None = None,
) -> SupervisedDataset:
    """Features, forward labels and a chronological 70/15/15 split with purge gaps."""
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 5 <= horizon <= 60:
        raise ValueError("horizon must be a whole number of days from 5 to 60.")
    close = _check_close(data)
    if use_volume is None:
        use_volume = volume_usable(data)
    features = generate_features(data, vix, use_volume=use_volume)
    outcomes = forward_outcomes(close, vix, horizon)
    positions = pd.Series(np.arange(len(data)), index=data.index)

    has_features = features.notna().all(axis=1)
    has_outcomes = outcomes.notna().all(axis=1)
    complete = data.index[(has_features & has_outcomes).to_numpy()]
    warm_up = int((~has_features).sum())
    unlabelled = int((has_features & ~has_outcomes).sum())
    if len(complete) < MIN_LABELLED_ROWS:
        raise ValueError(
            f"Training needs at least {MIN_LABELLED_ROWS} days with complete features and a known "
            f"next {horizon} days; this range has {len(complete)}. Choose a longer range or import "
            "more data."
        )

    n = len(complete)
    cut_validation = int(n * SPLIT["train"])
    cut_test = int(n * (SPLIT["train"] + SPLIT["validation"]))
    train_all = complete[:cut_validation]
    validation_all = complete[cut_validation:cut_test]
    test = complete[cut_test:]

    def purge(rows: pd.DatetimeIndex, next_first, between: str) -> tuple[pd.DatetimeIndex, dict]:
        limit = positions[next_first]
        kept = rows[(positions[rows].to_numpy() + horizon) < limit]
        dropped = rows[len(kept):]
        return kept, {
            "between": between,
            "days": horizon,
            "dropped_rows": len(dropped),
            "start": pd.Timestamp(dropped[0]).isoformat() if len(dropped) else None,
            "end": pd.Timestamp(dropped[-1]).isoformat() if len(dropped) else None,
        }

    train, purge_1 = purge(train_all, validation_all[0], "train and validation")
    validation, purge_2 = purge(validation_all, test[0], "validation and test")
    if len(train) < 200 or len(validation) < 30 or len(test) < 30:
        raise ValueError("The range is too short for the training, validation and test splits.")

    volatility_threshold = float(outcomes.loc[train, "forward_volatility"].median())
    labels = make_labels(outcomes, volatility_threshold=volatility_threshold)
    for key in DIMENSIONS:
        missing = [c for c in CLASSES[key] if not (labels.loc[train, key] == c).any()]
        if missing:
            raise ValueError(
                f"The training split has no {', '.join(missing)} days for {DIMENSION_NAMES[key].lower()}; "
                "use a longer range."
            )

    return SupervisedDataset(
        features=features,
        outcomes=outcomes,
        labels=labels,
        positions=positions,
        train=train,
        validation=validation,
        test=test,
        horizon=horizon,
        volatility_threshold=volatility_threshold,
        use_volume=use_volume,
        use_vix=vix is not None,
        warm_up_rows=warm_up,
        unlabelled_rows=unlabelled,
        purges=[purge_1, purge_2],
    )


def walk_forward_folds(dataset: SupervisedDataset, folds: int = CV_FOLDS) -> list[tuple]:
    """Expanding-window folds on the training days: fit on blocks 1..k (purged), score block k+1."""
    blocks = np.array_split(np.arange(len(dataset.train)), folds + 1)
    out = []
    for k in range(1, folds + 1):
        fit_rows = dataset.train[np.concatenate(blocks[:k])]
        score_rows = dataset.train[blocks[k]]
        limit = dataset.positions[score_rows[0]]
        fit_rows = fit_rows[(dataset.positions[fit_rows].to_numpy() + dataset.horizon) < limit]
        out.append((fit_rows, score_rows))
    return out


# --- models ----------------------------------------------------------------------


def _estimator(kind: str, params: dict, random_state: int):
    if kind == "RF":
        return RandomForestClassifier(**RF_FIXED, **params, random_state=random_state)
    if kind == "XGB":
        from xgboost import XGBClassifier

        return XGBClassifier(**XGB_FIXED, **params, random_state=random_state)
    raise ValueError(f"Unknown model kind {kind}.")


def _fit(kind: str, params: dict, x: pd.DataFrame, y: np.ndarray, random_state: int):
    estimator = _estimator(kind, params, random_state)
    if kind == "XGB":
        estimator.fit(x.to_numpy(dtype=float), y, sample_weight=compute_sample_weight("balanced", y))
    else:
        estimator.fit(x.to_numpy(dtype=float), y)
    return estimator


def _encode(labels: pd.Series, classes: tuple[str, ...]) -> np.ndarray:
    lookup = {c: i for i, c in enumerate(classes)}
    return labels.map(lookup).to_numpy(dtype=int)


@dataclass
class DimensionModel:
    key: str
    kind: str
    params: dict
    classes: tuple[str, ...]
    estimator: object


@dataclass
class SupervisedRegimeModel:
    """The three fitted classifiers and what is needed to use them again."""

    model_kind: str  # RF, XGB or AUTO (AUTO: each dimension keeps its better kind)
    horizon: int
    feature_columns: tuple[str, ...]
    use_volume: bool
    use_vix: bool
    volatility_threshold: float
    trend_threshold: float
    drawdown_threshold: float
    random_state: int
    dimensions: dict[str, DimensionModel]


def _proba(model: DimensionModel, x: pd.DataFrame) -> np.ndarray:
    probabilities = model.estimator.predict_proba(x.to_numpy(dtype=float))
    # Columns follow the encoded classes 0..k-1 (every class is in the training days).
    return np.asarray(probabilities, dtype=float)


def _balanced(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    # A short block may lack a class the model predicts; sklearn warns, the score stands.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        return float(balanced_accuracy_score(y_true, y_pred))


def _scores(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": _balanced(y_true, y_pred),
    }


def train_supervised(
    dataset: SupervisedDataset,
    *,
    model_kind: str = "AUTO",
    random_state: int = 42,
    grids: dict[str, tuple[dict, ...]] | None = None,
) -> tuple[SupervisedRegimeModel, dict]:
    """Choose, fit and evaluate one classifier per dimension. Returns the model and its evaluation."""
    if model_kind not in ("RF", "XGB", "AUTO"):
        raise ValueError("model_kind must be RF, XGB or AUTO.")
    kinds = KINDS if model_kind == "AUTO" else (model_kind,)
    grids = grids or {"RF": RF_GRID, "XGB": XGB_GRID}
    columns = list(dataset.features.columns)
    x = dataset.features
    folds = walk_forward_folds(dataset)
    persistence = dataset.labels.shift(dataset.horizon)

    fitted: dict[str, DimensionModel] = {}
    evaluated: list[dict] = []
    for key in DIMENSIONS:
        classes = CLASSES[key]
        y_all = dataset.labels[key]
        y_train = _encode(y_all.loc[dataset.train], classes)
        y_validation = _encode(y_all.loc[dataset.validation], classes)
        candidates = []
        for kind in kinds:
            tried = []
            for params in grids[kind]:
                fold_scores = []
                for fit_rows, score_rows in folds:
                    y_fit = _encode(y_all.loc[fit_rows], classes)
                    if len(np.unique(y_fit)) < len(classes):
                        continue  # a fold without every class cannot train every model
                    estimator = _fit(kind, params, x.loc[fit_rows, columns], y_fit, random_state)
                    predicted = estimator.predict(x.loc[score_rows, columns].to_numpy(dtype=float))
                    fold_scores.append(_balanced(_encode(y_all.loc[score_rows], classes), predicted))
                tried.append(
                    {
                        "params": dict(params),
                        "cv_balanced_accuracy": float(np.mean(fold_scores)) if fold_scores else None,
                        "cv_folds_scored": len(fold_scores),
                    }
                )
            scored = [t for t in tried if t["cv_balanced_accuracy"] is not None]
            best = max(scored, key=lambda t: t["cv_balanced_accuracy"]) if scored else tried[0]
            estimator = _fit(kind, best["params"], x.loc[dataset.train, columns], y_train, random_state)
            predicted = estimator.predict(x.loc[dataset.validation, columns].to_numpy(dtype=float))
            candidates.append(
                {
                    "kind": kind,
                    "kind_name": KIND_NAMES[kind],
                    "params": best["params"],
                    "cv_balanced_accuracy": best["cv_balanced_accuracy"],
                    "grid": tried,
                    "validation": _scores(y_validation, predicted),
                    "_estimator": estimator,
                }
            )
        # The better kind on the validation split (balanced accuracy; ties keep the first).
        chosen = max(candidates, key=lambda c: c["validation"]["balanced_accuracy"])
        model = DimensionModel(
            key=key, kind=chosen["kind"], params=chosen["params"], classes=classes, estimator=chosen["_estimator"]
        )
        fitted[key] = model

        y_test = _encode(y_all.loc[dataset.test], classes)
        predicted = _proba(model, x.loc[dataset.test, columns]).argmax(axis=1)
        precision, recall, f1, support = precision_recall_fscore_support(
            y_test, predicted, labels=list(range(len(classes))), zero_division=0
        )
        train_counts = pd.Series(y_train).value_counts()
        majority = int(train_counts.sort_index().idxmax())
        baseline_rows = []
        majority_pred = np.full_like(y_test, majority)
        baseline_rows.append(
            {
                "name": "majority",
                "label": "Majority class",
                "description": f"Always predicts the most common training class ({classes[majority]}).",
                "rows": len(y_test),
                **_scores(y_test, majority_pred),
            }
        )
        persisted = persistence.loc[dataset.test, key]
        known = persisted.notna().to_numpy()
        persistence_pred = _encode(persisted[known], classes)
        baseline_rows.append(
            {
                "name": "persistence",
                "label": "Persistence",
                "description": (
                    f"Predicts that the next {dataset.horizon} days repeat the last {dataset.horizon} "
                    "days (the same rule applied to the window that ends today)."
                ),
                "rows": int(known.sum()),
                **_scores(y_test[known], persistence_pred),
            }
        )
        test_scores = _scores(y_test, predicted)
        importance = np.asarray(model.estimator.feature_importances_, dtype=float)
        total = float(importance.sum())
        importance = importance / total if total > 0 else importance
        evaluated.append(
            {
                "key": key,
                "name": DIMENSION_NAMES[key],
                "classes": list(classes),
                "chosen_kind": model.kind,
                "chosen_kind_name": KIND_NAMES[model.kind],
                "chosen_params": model.params,
                "candidates": [{k: v for k, v in c.items() if k != "_estimator"} for c in candidates],
                "test": {
                    "rows": len(y_test),
                    **test_scores,
                    "target": TARGET_ACCURACY,
                    "meets_target": test_scores["accuracy"] >= TARGET_ACCURACY,
                    "beats_baselines": all(test_scores["accuracy"] > b["accuracy"] for b in baseline_rows),
                    "per_class": [
                        {
                            "label": classes[i],
                            "precision": float(precision[i]),
                            "recall": float(recall[i]),
                            "f1": float(f1[i]),
                            "support": int(support[i]),
                        }
                        for i in range(len(classes))
                    ],
                    "confusion_matrix": confusion_matrix(
                        y_test, predicted, labels=list(range(len(classes)))
                    ).tolist(),
                    "baselines": baseline_rows,
                },
                "class_counts": {
                    split: {
                        classes[i]: int((_encode(y_all.loc[rows], classes) == i).sum())
                        for i in range(len(classes))
                    }
                    for split, rows in (
                        ("train", dataset.train),
                        ("validation", dataset.validation),
                        ("test", dataset.test),
                    )
                },
                "feature_importance": sorted(
                    (
                        {"feature": name, "importance": float(value)}
                        for name, value in zip(columns, importance)
                    ),
                    key=lambda r: (-r["importance"], r["feature"]),
                ),
                "importance_method": IMPORTANCE_METHOD[model.kind],
            }
        )

    accuracies = [d["test"]["accuracy"] for d in evaluated]
    evaluation = {
        "target_accuracy": TARGET_ACCURACY,
        "horizon_days": dataset.horizon,
        "selection": (
            f"For each dimension and model kind, the settings with the best mean balanced accuracy "
            f"in {CV_FOLDS}-fold purged walk-forward cross-validation on the training days; "
            + (
                "then the kind (Random Forest or XGBoost) with the better balanced accuracy on the "
                "validation split. "
                if model_kind == "AUTO"
                else ""
            )
            + "The test split is used once, for the figures shown."
        ),
        "cv_folds": CV_FOLDS,
        "dimensions": evaluated,
        "summary": {
            "mean_accuracy": float(np.mean(accuracies)),
            "dimensions": len(evaluated),
            "dimensions_meeting_target": sum(d["test"]["meets_target"] for d in evaluated),
        },
    }
    model = SupervisedRegimeModel(
        model_kind=model_kind,
        horizon=dataset.horizon,
        feature_columns=tuple(columns),
        use_volume=dataset.use_volume,
        use_vix=dataset.use_vix,
        volatility_threshold=dataset.volatility_threshold,
        trend_threshold=TREND_THRESHOLD,
        drawdown_threshold=DRAWDOWN_THRESHOLD,
        random_state=random_state,
        dimensions=fitted,
    )
    return model, evaluation


def predict_supervised(model: SupervisedRegimeModel, features: pd.DataFrame) -> pd.DataFrame:
    """Each dimension's predicted class and probabilities, and the combined regime.

    Rows must have every feature. The combined regime's probability is the three
    dimensions' probabilities multiplied (the classifiers are separate models).
    """
    x = features.loc[:, list(model.feature_columns)]
    if x.isna().any(axis=None):
        raise ValueError("features cannot contain missing values.")
    out = pd.DataFrame(index=features.index)
    chosen = {}
    for key in DIMENSIONS:
        dim = model.dimensions[key]
        probabilities = _proba(dim, x)
        index = probabilities.argmax(axis=1)
        out[f"{key}_label"] = [dim.classes[i] for i in index]
        out[f"{key}_probability"] = probabilities.max(axis=1)
        for i, name in enumerate(dim.classes):
            out[f"{key}_p::{name}"] = probabilities[:, i]
        chosen[key] = out[f"{key}_label"]
    out["regime_id"] = [
        COMBO_INDEX[(v, t, r)] for v, t, r in zip(chosen["volatility"], chosen["trend"], chosen["risk"])
    ]
    out["confidence"] = out["volatility_probability"] * out["trend_probability"] * out["risk_probability"]
    for combo in combos():
        out[f"probability_{combo['regime_id']}"] = (
            out[f"volatility_p::{combo['volatility_state']}"]
            * out[f"trend_p::{combo['trend_state']}"]
            * out[f"risk_p::{combo['risk_state']}"]
        )
    return out
