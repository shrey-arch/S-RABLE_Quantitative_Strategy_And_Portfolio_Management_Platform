from __future__ import annotations

import numpy as np
import pandas as pd


FEATURE_COLUMNS = (
    "log_return",
    "realized_volatility",
    "trend_strength",
)


def generate_regime_features(
    data: pd.DataFrame,
    *,
    volatility_window: int = 20,
    trend_window: int = 20,
) -> pd.DataFrame:
    """Generate causal market-regime features from historical close prices."""
    if not isinstance(data, pd.DataFrame):
        raise ValueError("data must be a pandas DataFrame.")
    if data.empty:
        raise ValueError("data cannot be empty.")
    if not data.index.is_unique or not data.index.is_monotonic_increasing:
        raise ValueError("data index must be unique and chronological.")
    if "close" not in data.columns:
        raise ValueError("data must contain a close column.")

    for name, window in (
        ("volatility_window", volatility_window),
        ("trend_window", trend_window),
    ):
        if (
            isinstance(window, bool)
            or not isinstance(window, int)
            or window < 2
        ):
            raise ValueError(f"{name} must be an integer >= 2.")

    close = pd.to_numeric(data["close"], errors="coerce")
    if close.isna().any() or not np.isfinite(close.to_numpy()).all():
        raise ValueError("close values must be finite numeric values.")
    if (close <= 0).any():
        raise ValueError("close values must be greater than zero.")

    log_returns = np.log(close).diff()
    volatility = log_returns.rolling(
        window=volatility_window,
        min_periods=volatility_window,
    ).std(ddof=1)

    trend_mean = log_returns.rolling(
        window=trend_window,
        min_periods=trend_window,
    ).mean()
    trend_std = log_returns.rolling(
        window=trend_window,
        min_periods=trend_window,
    ).std(ddof=1)
    trend_strength = trend_mean.div(trend_std.where(trend_std > 0))

    features = pd.DataFrame(
        {
            "log_return": log_returns,
            "realized_volatility": volatility,
            "trend_strength": trend_strength,
        },
        index=data.index,
    )
    features.replace([np.inf, -np.inf], np.nan, inplace=True)
    return features.loc[:, FEATURE_COLUMNS]
