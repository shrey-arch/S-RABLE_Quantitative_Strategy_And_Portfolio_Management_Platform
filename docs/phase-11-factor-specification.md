# Phase 11 — Multi-Factor Scoring Specification

## 1. Objective

Build a deterministic, configurable scoring component that ranks strategy suitability for current market conditions.

The scorer evaluates strategies using documented factors derived from existing market data and strategy logic. It must not execute trades, modify existing strategy signals, or interpret unsupervised regime cluster IDs as semantic market labels.

## 2. Scope

Phase 11 includes:

- 11A: Define and document factors.
- 11B: Normalize factor values using fixed, documented bounds.
- 11C: Support configurable per-strategy factor weights.
- 11D: Calculate a composite suitability score.
- 11E: Test normalization, weighting, missing factors, boundaries, and reproducibility.

The implementation must avoid lookahead bias and must be deterministic for identical inputs and configuration.

## 3. Strategy-specific factor definitions

Factors must reflect the current implementations rather than assumed capabilities.

### 3.1 Momentum

Existing strategy behavior: compares close price with a simple moving average.

| Factor | Meaning | Expected normalized range |
|---|---|---|
| trend_strength | Persistence and strength of directional price movement | [-1, 1] |
| relative_momentum | Price displacement relative to its moving average | [-1, 1] |
| volatility_suitability | How suitable current realized volatility is for the strategy | [0, 1] |

### 3.2 Mean reversion

Existing strategy behavior: uses the rolling z-score of close price.

| Factor | Meaning | Expected normalized range |
|---|---|---|
| price_deviation | Direction and magnitude of price deviation from its rolling mean | [-1, 1] |
| trend_suitability | Suitability of current trend conditions for mean reversion | [0, 1] |
| volatility_suitability | Suitability of current realized volatility for the strategy | [0, 1] |

A large deviation is not automatically evidence that a reversal will occur. The score represents suitability, not a guarantee of reversion.

### 3.3 Statistical arbitrage

Existing strategy behavior: computes a spread between two instruments and applies a rolling z-score.

| Factor | Meaning | Expected normalized range |
|---|---|---|
| spread_deviation | Direction and magnitude of the observed spread z-score | [-1, 1] |
| spread_stability | Stability of the observed spread over a documented historical window | [0, 1] |
| volatility_suitability | Suitability of observed volatility for the strategy | [0, 1] |

The existing spread calculation does not establish cointegration or a statistically valid hedge ratio. Phase 11 must not claim either without additional evidence.

### 3.4 Tactical asset allocation

Existing strategy behavior: compares relative momentum across assets and selects the top-ranked assets.

| Factor | Meaning | Expected normalized range |
|---|---|---|
| relative_momentum | Relative performance over the configured lookback | [-1, 1] |
| volatility_suitability | Suitability of each asset's realized volatility | [0, 1] |

Scores must use only data available at the evaluation timestamp.

### 3.5 Volatility arbitrage

Existing strategy behavior: compares short-window and long-window realized volatility derived from price returns.

| Factor | Meaning | Expected normalized range |
|---|---|---|
| volatility_relationship | Normalized relationship between short- and long-window realized volatility | [-1, 1] |
| volatility_stability | Stability of realized volatility over a documented historical window | [0, 1] |

This factor is a realized-volatility proxy. It must not be described as implied-volatility arbitrage because the current implementation does not establish an options implied-volatility signal.

## 4. Normalization contract

- Normalization bounds must be explicit, documented, and configurable where appropriate.
- Directional factors use the normalized range [-1, 1].
- Suitability factors use the normalized range [0, 1].
- Values outside the documented bounds are clipped to the nearest bound.
- Non-finite values must be rejected.
- Normalization must be deterministic and must not estimate bounds from future observations.
- Raw values and normalized values must not be confused.

The exact raw-to-normalized mapping for each factor must be documented before implementation. A normalized score does not itself establish predictive validity.

## 5. Weighting contract

- Weights are configurable per strategy.
- Each configured weight must be finite and nonnegative.
- The total weight for a strategy must be greater than zero.
- Weight keys must correspond to documented factors for that strategy.
- Weight configuration must be deterministic and validated.
- Default weights are engineering defaults, not empirically optimized parameters.

## 6. Composite score contract

- Composite scoring must be deterministic for identical normalized factors and weights.
- Directional factors in [-1, 1] must not be silently treated as suitability factors in [0, 1].
- The aggregation rule and its output range must be documented.
- Missing required factors must raise a clear validation error by default.
- Missing values must not silently become zero.
- Missing factors must not silently cause automatic weight renormalization.
- Any future optional-factor policy must be explicit and separately tested.

The composite score represents relative strategy suitability under the configured scoring model. It is not a probability of profit, expected return, or guarantee of performance.

## 7. Data and causality requirements

- Factor calculations must use only data available at the evaluation timestamp.
- Rolling calculations must define their window and minimum observations.
- Insufficient history must produce a clear, documented outcome rather than fabricated values.
- Input data validation must be consistent with existing project conventions.
- Existing strategy signals and Phase 10 regime detection behavior must remain unchanged.

## 8. Testing requirements

Phase 11 must test:

1. Each factor's documented range.
2. Normalization at lower and upper bounds.
3. Clipping outside bounds.
4. Rejection of NaN and infinite values.
5. Weight validation, including negative, non-finite, and all-zero weights.
6. Composite score behavior under known inputs and weights.
7. Missing required factors.
8. Reproducibility for identical inputs and configuration.
9. Insufficient history and invalid market data.
10. Regression compatibility with existing strategy and ML tests.

## 9. Implementation sequence

1. Finalize this specification.
2. Implement and test normalization independently.
3. Implement and test weight configuration and validation.
4. Implement the composite scoring function.
5. Add factor extraction only where existing code provides a valid source; document any new calculations.
6. Add integration and regression tests.
7. Run the full test suite and dependency checks.

## 10. Acceptance criteria

Phase 11 is complete when the documented factors have implemented, tested definitions; normalization and weighting are validated; composite scoring is deterministic; missing or invalid inputs fail clearly; causality requirements are met; and the full existing test suite passes.

## 11. Initial raw-to-normalized mappings

These mappings define deterministic engineering defaults. They are not empirically
validated trading thresholds. Callers must be able to supply different explicit
bounds when justified by their strategy configuration.

| Factor input | Default raw bounds | Target bounds | Mapping |
|---|---:|---:|---|
| Trend strength | -3 to 3 | -1 to 1 | Linear scaling with clipping |
| Relative momentum (fractional return) | -0.20 to 0.20 | -1 to 1 | Linear scaling with clipping |
| Price or spread z-score | -3 to 3 | -1 to 1 | Linear scaling with clipping |
| Volatility relationship (short/long ratio minus 1) | -1 to 1 | -1 to 1 | Linear scaling with clipping |
| Volatility suitability input | 0 to 1 | 0 to 1 | Identity mapping after validation |
| Trend suitability input | 0 to 1 | 0 to 1 | Identity mapping after validation |
| Spread stability input | 0 to 1 | 0 to 1 | Identity mapping after validation |

### Mapping requirements

- All bounds must be explicit and finite, with strictly increasing endpoints.
- Normalization clips finite values outside the raw bounds.
- NaN and infinity are rejected.
- Identity mappings do not calculate suitability; they normalize an already-computed suitability input.
- Volatility suitability, trend suitability, and spread stability require separately defined calculations before they can be derived from market data.
- The volatility relationship uses a documented raw input of `(short_window_volatility / long_window_volatility) - 1`. A zero or invalid long-window volatility must be handled before normalization.
- Missing factor inputs must not be replaced with fabricated values.
- These defaults must be reviewed and tested before being used in production scoring.
