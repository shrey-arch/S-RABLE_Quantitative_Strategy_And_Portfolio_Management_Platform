from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from app.ml.features import generate_regime_features
from app.ml.model import RegimeModel, predict_regimes
from app.ml.persistence import load_regime_model


@dataclass(frozen=True)
class RegimeDetectionResult:
    timestamp: Any
    regime_id: int
    confidence: float
    probabilities: dict[int, float]
    model_version: str


class RegimeDetectionService:
    """Detect the latest regime with a previously trained model."""

    def __init__(
        self,
        model: RegimeModel,
        *,
        model_version: str,
        volatility_window: int = 20,
        trend_window: int = 20,
    ) -> None:
        if not isinstance(model, RegimeModel):
            raise ValueError("model must be a RegimeModel.")
        if not isinstance(model_version, str) or not model_version.strip():
            raise ValueError("model_version must be a non-empty string.")

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

        self._model = model
        self._model_version = model_version
        self._volatility_window = volatility_window
        self._trend_window = trend_window

    @classmethod
    def from_artifact(
        cls,
        path: str | Path,
        *,
        expected_model_version: str | None = None,
    ) -> RegimeDetectionService:
        model, metadata = load_regime_model(
            path,
            expected_model_version=expected_model_version,
        )
        parameters = metadata["feature_parameters"]
        return cls(
            model,
            model_version=metadata["model_version"],
            volatility_window=parameters["volatility_window"],
            trend_window=parameters["trend_window"],
        )

    def predict(self, market_data: pd.DataFrame) -> RegimeDetectionResult:
        features = generate_regime_features(
            market_data,
            volatility_window=self._volatility_window,
            trend_window=self._trend_window,
        )
        valid_features = features.dropna(axis=0, how="any")

        if valid_features.empty:
            raise ValueError(
                "Insufficient market data to generate a complete feature row."
            )

        latest = valid_features.iloc[[-1]]
        prediction = predict_regimes(self._model, latest).iloc[-1]

        probabilities = {
            component: float(prediction[f"probability_{component}"])
            for component in range(self._model.n_components)
        }

        return RegimeDetectionResult(
            timestamp=latest.index[-1],
            regime_id=int(prediction["regime_id"]),
            confidence=float(prediction["confidence"]),
            probabilities=probabilities,
            model_version=self._model_version,
        )
