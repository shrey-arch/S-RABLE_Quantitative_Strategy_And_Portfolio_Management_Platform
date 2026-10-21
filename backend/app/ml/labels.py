"""Names for the clusters of a trained regime model (Phase 12).

A Gaussian mixture only numbers its clusters (0, 1, 2, ...). Each cluster is
named from its centre, in the features' own units:
- volatility state: "High volatility" when the centre's realised volatility is
  above the median realised volatility of the training days, "Low volatility"
  otherwise;
- trend state: "Uptrend" when the centre's trend strength is above
  +TREND_BAND, "Downtrend" below -TREND_BAND, "Sideways" in between.

Clusters that get the same name are told apart with A, B, ... in order of
volatility (A is the calmest). Codes R1, R2, ... number the clusters from the
calmest to the most volatile. The rule is stored with the model.
"""

from __future__ import annotations

import math
import string

import pandas as pd

from app.ml.model import RegimeModel, predict_regimes

TRADING_DAYS = 252
# Trend strength is the mean daily log return over the trend window divided by
# its standard deviation; +-0.1 separates a drift from noise.
TREND_BAND = 0.1

RULE = (
    "Each cluster is named from its centre: high volatility when its daily "
    "volatility is above the median of the training days ({median:.2%} a day), "
    "low otherwise; uptrend when its trend strength is above {band}, downtrend "
    "below -{band}, sideways in between. Clusters with the same name get A, B, ... "
    "(A is the calmest); codes R1, R2, ... go from the calmest to the most volatile."
)


def name_regimes(model: RegimeModel, training_features: pd.DataFrame) -> dict:
    """Labels for every cluster, from the model and the features it was trained on."""
    centres = model.scaler.inverse_transform(model.estimator.means_)
    columns = list(model.feature_columns)
    vol_index = columns.index("realized_volatility")
    trend_index = columns.index("trend_strength")
    return_index = columns.index("log_return")

    median_volatility = float(training_features["realized_volatility"].median())
    assigned = predict_regimes(model, training_features)["regime_id"].to_numpy()

    rows = []
    for regime_id in range(model.n_components):
        volatility = float(centres[regime_id, vol_index])
        trend = float(centres[regime_id, trend_index])
        mean_return = float(centres[regime_id, return_index])
        volatility_state = "High volatility" if volatility > median_volatility else "Low volatility"
        trend_state = (
            "Uptrend" if trend > TREND_BAND else "Downtrend" if trend < -TREND_BAND else "Sideways"
        )
        rows.append(
            {
                "regime_id": regime_id,
                "volatility_state": volatility_state,
                "trend_state": trend_state,
                "name": f"{volatility_state}, {trend_state.lower()}",
                "mean_log_return": mean_return,
                "mean_realized_volatility": volatility,
                "mean_trend_strength": trend,
                "annualized_return": mean_return * TRADING_DAYS,
                "annualized_volatility": volatility * math.sqrt(TRADING_DAYS),
                "training_days": int((assigned == regime_id).sum()),
                "training_share": float((assigned == regime_id).mean()),
            }
        )

    # Codes from the calmest to the most volatile (ties by id, so it is stable).
    for code, row in enumerate(
        sorted(rows, key=lambda r: (r["mean_realized_volatility"], r["regime_id"])), start=1
    ):
        row["code"] = f"R{code}"

    by_name: dict[str, list[dict]] = {}
    for row in rows:
        by_name.setdefault(row["name"], []).append(row)
    for same in by_name.values():
        if len(same) > 1:
            same.sort(key=lambda r: (r["mean_realized_volatility"], r["regime_id"]))
            for letter, row in zip(string.ascii_uppercase, same):
                row["name"] = f"{row['name']} {letter}"

    rows.sort(key=lambda r: r["code"][1:].zfill(3))
    return {
        "rule": RULE.format(median=median_volatility, band=TREND_BAND),
        "median_training_volatility": median_volatility,
        "trend_band": TREND_BAND,
        "regimes": rows,
    }
