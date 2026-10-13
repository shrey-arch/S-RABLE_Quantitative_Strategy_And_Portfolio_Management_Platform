# Validation Framework

## 1. Purpose

The validation framework defines how a quantitative strategy is evaluated before its results are considered reliable.

The project specification defines a five-stage validation process:

1. Historical Backtesting
2. Walk-Forward Analysis
3. Regime Stress Testing
4. Monte Carlo / Statistical Significance
5. Live Paper Trading

These stages are part of the approved project design.

At the current stage of development, the backend domain foundation is implemented, but the complete quantitative validation framework is **not yet implemented**.

---

# 2. Current Validation Foundation

The current backend already validates individual domain entities.

Examples include:

```text
Order
    ↓
Quantity, price and fill-related validation

Trade
    ↓
Executed quantity, executed price and charges validation

Position
    ↓
Quantity, average price, current price and market-value validation

Execution
    ↓
Execution status transition validation

Notification
    ↓
Read/unread state validation
```

These are domain-level validations.

They should not be confused with quantitative strategy validation.

---

# 3. Domain Validation vs Quantitative Validation

There are currently two different levels of validation.

## Domain Validation

Domain validation checks whether individual backend objects are valid.

Examples:

```text
quantity > 0
price > 0
executed_quantity > 0
brokerage >= 0
valid execution status transition
valid notification read state
```

These validations are already implemented.

## Quantitative Validation

Quantitative validation checks whether a trading strategy behaves consistently and meaningfully across historical and simulated conditions.

This includes:

```text
Backtesting
Walk-Forward Analysis
Regime Testing
Monte Carlo / Statistical Significance
Paper Trading
```

These are not yet fully implemented.

---

# 4. Validation Pipeline

The intended quantitative validation pipeline is:

```text
Strategy
   ↓
Historical Backtest
   ↓
Walk-Forward Analysis
   ↓
Regime Stress Testing
   ↓
Monte Carlo / Statistical Significance
   ↓
Live Paper Trading
```

The purpose of the sequence is to evaluate the strategy under progressively different conditions rather than relying on one historical backtest result.

---

# 5. Stage 1 — Historical Backtesting

## Purpose

Historical backtesting evaluates how a strategy would have behaved using historical market data.

The project scope identifies historical market data covering approximately ten years.

The intended flow is:

```text
Historical Market Data
        ↓
Strategy
        ↓
Indicators
        ↓
Signals
        ↓
Simulated Orders
        ↓
Simulated Trades
        ↓
Positions
        ↓
Performance Results
```

## Current Status

A complete historical backtesting engine is not currently implemented.

The current backend does contain:

```text
ExecutionType.BACKTEST
```

but this only identifies an execution as a backtest-type execution.

It does not itself perform historical simulation.

---

# 6. Backtest Inputs

The eventual backtest process will require information such as:

```text
Strategy
Instrument / Dataset
Start Date
End Date
Timeframe
Initial Capital
Strategy Configuration
```

The existing Execution entity already contains several related concepts, including:

```text
strategy_id
instrument_id
execution_type
timeframe
initial_capital
execution_config
```

These provide a useful domain foundation for the future backtesting engine.

---

# 7. Backtest Outputs

The complete backtesting implementation will need to produce quantitative results.

The exact final metric set has not yet been implemented.

The project will need to define and calculate the required performance and risk measurements before the validation framework is considered complete.

The current backend should therefore not be described as already producing complete backtest analytics.

---

# 8. Stage 2 — Walk-Forward Analysis

## Purpose

Walk-forward analysis evaluates a strategy across sequential historical periods instead of evaluating only one fixed historical period.

The intended concept is:

```text
Historical Data
       ↓
Training / Development Period
       ↓
Validation / Out-of-Sample Period
       ↓
Move Window Forward
       ↓
Repeat
       ↓
Aggregate Results
```

The exact window sizes and methodology are not yet implemented.

---

# 9. Walk-Forward Requirements

The eventual implementation must explicitly define:

- training period
- validation period
- testing period
- window size
- step size
- strategy parameter handling
- out-of-sample evaluation
- result aggregation

These rules must be documented before implementation so that different strategies are evaluated consistently.

---

# 10. Current Walk-Forward Status

Walk-forward analysis is **not currently implemented**.

No existing `ExecutionType` value should be interpreted as meaning that the complete walk-forward engine already exists.

The current Execution model provides the foundation for execution tracking, but the actual walk-forward orchestration remains to be implemented.

---

# 11. Stage 3 — Regime Stress Testing

## Purpose

Regime stress testing evaluates strategy behavior under different market conditions.

The project specification identifies regime testing as one of the five validation stages.

The intended conceptual flow is:

```text
Historical Market Data
        ↓
Market Regime Identification
        ↓
Separate Regime Periods
        ↓
Run Strategy
        ↓
Compare Results Across Regimes
```

---

# 12. Current Regime Testing Foundation

The Execution entity currently supports:

```text
ExecutionType.REGIME_TEST
```

This allows an execution to be classified as a regime-test execution.

However:

```text
REGIME_TEST execution type
        ≠
Complete regime stress-testing engine
```

The actual regime identification, segmentation, strategy evaluation, and result comparison are not currently implemented.

---

# 13. Regime Definitions

The final implementation must explicitly define the market regimes used by the project.

The exact regime methodology is not currently implemented.

The system should not assume that a particular regime classification is already part of the current backend.

---

# 14. Stage 4 — Monte Carlo / Statistical Significance

## Purpose

The fourth validation stage evaluates whether observed strategy results could reasonably be explained by randomness or a particular arrangement of historical observations.

The project specification identifies:

```text
Monte Carlo / Statistical Significance
```

as a required validation stage.

---

# 15. Monte Carlo Requirements

The final implementation must define:

- what data is randomized or resampled
- how samples are generated
- number of simulations
- random seed handling
- performance statistics evaluated
- distribution of simulated results
- comparison between observed and simulated results
- statistical interpretation

These rules are not currently implemented.

---

# 16. Statistical Significance

The final framework must define the statistical methodology used to determine whether a strategy result has sufficient evidence behind it.

The exact statistical tests, thresholds, and reporting format are not currently implemented.

The system should therefore not currently claim that a strategy has passed statistical significance testing.

---

# 17. Stage 5 — Live Paper Trading

## Purpose

The final validation stage is paper trading.

The purpose is to observe strategy behavior without using real capital.

The intended flow is:

```text
Market Data
      ↓
Strategy
      ↓
Signal
      ↓
Paper Order
      ↓
Paper Trade
      ↓
Paper Position
      ↓
Portfolio Results
```

---

# 18. Current Paper Trading Foundation

The Execution entity currently supports:

```text
ExecutionType.PAPER
```

This allows an execution to be classified as a paper execution.

The existing:

```text
Execution
Order
Trade
Position
```

entities also provide the domain foundation required for execution tracking.

However, the complete paper-trading engine is not currently implemented.

---

# 19. Paper Trading Status

The current backend does not yet provide the complete system required to:

- continuously obtain market data
- generate live strategy signals
- create paper orders automatically
- simulate paper fills
- maintain paper positions over time
- calculate ongoing paper performance
- produce the final paper-validation report

These capabilities remain to be implemented.

---

# 20. Validation Result Flow

Once the complete framework exists, the conceptual flow will be:

```text
Strategy
   ↓
Backtest
   ↓
Backtest Results
   ↓
Walk-Forward
   ↓
Walk-Forward Results
   ↓
Regime Testing
   ↓
Regime Results
   ↓
Monte Carlo / Statistical Testing
   ↓
Statistical Results
   ↓
Paper Trading
   ↓
Paper Trading Results
```

The validation framework should preserve the results of each stage rather than only producing one final number.

---

# 21. Validation Independence

Each validation stage should have clearly defined inputs and outputs.

Conceptually:

```text
Stage 1
Backtest
    ↓
Validated Result Dataset

Stage 2
Walk-Forward
    ↓
Validated Result Dataset

Stage 3
Regime Testing
    ↓
Regime Result Dataset

Stage 4
Monte Carlo
    ↓
Statistical Result Dataset

Stage 5
Paper Trading
    ↓
Paper Trading Result Dataset
```

This makes it possible to inspect where a strategy succeeds or fails instead of hiding all validation inside one process.

---

# 22. Current Backend Validation

The current backend has extensive automated tests for the implemented domain functionality.

The latest complete backend regression result is:

```text
354 passed
```

These tests verify current backend behavior such as:

- entity creation
- entity retrieval
- entity updates
- entity deletion
- API behavior
- service behavior
- repository behavior
- domain validation
- lifecycle transitions
- trade execution
- position updates
- notification behavior

These tests confirm the implemented backend behavior.

They do **not** constitute quantitative strategy validation.

---

# 23. Current Validation Boundary

Currently implemented:

```text
Domain Validation
        ↓
Entity-Level Rules
        ↓
Lifecycle Validation
        ↓
Database Constraints
        ↓
Automated Backend Tests
```

Not yet implemented:

```text
Historical Backtesting
        ↓
Walk-Forward Analysis
        ↓
Regime Stress Testing
        ↓
Monte Carlo / Statistical Significance
        ↓
Paper Trading Validation
```

---

# 24. Important Current-State Clarification

The project currently has a tested backend domain foundation, but it does not yet have a completed quantitative validation framework.

The presence of:

```text
BACKTEST
REGIME_TEST
PAPER
```

inside the ExecutionType enum represents supported execution classifications.

It does not mean that the corresponding complete validation engines already exist.

The five-stage quantitative validation framework remains a major implementation area of the project.
```