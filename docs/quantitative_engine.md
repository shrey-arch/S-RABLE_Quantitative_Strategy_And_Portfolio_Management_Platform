# Quantitative Engine

## 1. Purpose

The quantitative engine is the part of the project that will eventually convert market data and strategy definitions into trading signals, simulated trades, portfolio results, and quantitative performance information.

At the current stage of the project, the complete quantitative engine is **not yet implemented**.

The current backend provides the Strategy foundation and the Execution, Order, Trade, and Position domains that the future quantitative engine can use.

---

# 2. Current Quantitative Foundation

The current Strategy implementation provides three completed areas:

```text
Strategy Management
        ↓
Strategy Configuration
        ↓
Strategy Execution Interface
```

The Strategy configuration currently contains:

```text
parameters
indicators
entry_conditions
exit_conditions
```

These structures provide a standardized representation for strategy definitions.

The current Strategy interface also provides the foundation for standardized strategy signal generation.

---

# 3. Current Strategy Configuration

The current configuration contract requires four sections:

```text
parameters
indicators
entry_conditions
exit_conditions
```

The sections can currently contain empty collections where allowed by the existing configuration contract.

The current configuration system supports a limited rule structure.

Current condition operators include:

```text
<
<=
>
>=
==
```

Operands can currently refer to values or indicators according to the implemented Strategy configuration contract.

The current system does not yet implement a complete mathematical indicator engine or the final five quantitative strategies.

---

# 4. Current Strategy Interface

The current backend contains a standardized Strategy interface.

The current structure is:

```text
Strategy Configuration
        ↓
Strategy Interface
        ↓
Standardized Signals
        ↓
Future Backtesting Engine
```

The Strategy interface provides the boundary between strategy definition and future execution of those strategies.

This means that future quantitative strategies can be implemented against a common interface rather than each strategy creating its own unrelated execution structure.

---

# 5. Quantitative Strategies

The project specification identifies five strategy categories:

1. Momentum
2. Mean Reversion
3. Volatility Arbitrage
4. Statistical Arbitrage
5. Tactical Asset Allocation

The actual implementations of these five quantitative strategies are **not yet present** in the current backend.

The current Strategy entity and configuration system should therefore be considered the foundation for these strategies, not the strategies themselves.

---

# 6. Indicator Engine

A complete reusable quantitative indicator engine is not currently implemented.

The Strategy configuration can currently refer to indicators, but the backend does not yet contain the complete calculation system required to calculate all strategy indicators from historical market data.

The future indicator layer will need to provide standardized calculations that strategies can consume.

The intended relationship is:

```text
Historical Market Data
        ↓
Indicator Calculations
        ↓
Strategy
        ↓
Trading Signal
```

No indicator should be considered implemented merely because the Strategy configuration contains an indicator definition.

---

# 7. Historical Market Data Dependency

The quantitative engine requires validated market data.

The current Instrument entity identifies tradable instruments, but it does not provide the complete historical market-data system.

The quantitative engine therefore currently does not have a complete data source from which it can run historical strategy calculations.

The future dependency will be:

```text
Historical Data Pipeline
        ↓
Validated Market Data
        ↓
Indicator Engine
        ↓
Strategy Engine
```

The historical data pipeline is documented separately in:

```text
docs/data_pipeline.md
```

---

# 8. Trading Signal Generation

The current Strategy interface provides the foundation for standardized signals.

The complete signal-generation process is not yet connected to a historical-data/backtesting engine.

The intended future flow is:

```text
Market Data
     ↓
Indicators
     ↓
Strategy Conditions
     ↓
Signal
     ↓
BUY / SELL / HOLD or equivalent standardized signal
```

The exact final signal contract will be defined when the quantitative execution layer is implemented.

---

# 9. Backtesting Engine

A complete backtesting engine is not currently implemented.

The Execution entity already supports:

```text
ExecutionType.BACKTEST
```

However, this only represents the type of an execution.

It does not currently perform the complete process of:

- loading historical market data
- calculating indicators
- generating strategy signals
- creating simulated orders
- simulating order execution
- creating simulated trades
- updating positions
- calculating portfolio value
- calculating performance metrics

Therefore:

```text
BACKTEST execution type
≠
Complete backtesting engine
```

---

# 10. Future Backtesting Flow

The future quantitative engine is expected to connect the existing domain entities approximately as follows:

```text
Historical Market Data
          ↓
      Strategy
          ↓
     Indicators
          ↓
       Signal
          ↓
        Order
          ↓
   Simulated Execution
          ↓
        Trade
          ↓
       Position
          ↓
   Portfolio Results
          ↓
 Performance Analytics
```

The existing domain entities provide the backend foundation for this flow.

The complete flow itself is not yet implemented.

---

# 11. Order Simulation

The current Order entity already supports:

```text
MARKET
LIMIT
SL
SLM
```

and:

```text
BUY
SELL
```

along with its lifecycle:

```text
PENDING
    ↓
OPEN
    ↓
COMPLETED / CANCELLED / REJECTED
```

These are currently implemented domain capabilities.

The quantitative engine has not yet connected these Order capabilities to a historical market simulation process.

A future backtesting engine will need to determine how historical prices interact with each supported order type.

---

# 12. Trade Simulation

The current Trade entity represents executed trades and is integrated with Position updates.

The current Trade execution flow is:

```text
Order
  ↓
Trade
  ↓
Position Update
```

However, the quantitative engine does not yet automatically generate these trades from historical market data.

A future backtesting engine will need to create simulated trades based on the strategy signals and the defined execution assumptions.

---

# 13. Position Accounting

The current Position implementation already contains important domain behavior.

Trade-driven Position updates currently support:

### BUY

```text
Existing Quantity
        +
Executed Quantity
        =
New Quantity
```

Weighted-average acquisition price is recalculated for an existing position.

### SELL

```text
Existing Quantity
        -
Executed Quantity
        =
New Quantity
```

A SELL greater than the existing quantity is rejected.

Realized P&L is calculated for SELL transactions.

### Full Close

When quantity reaches zero:

```text
quantity = 0
status = CLOSED
unrealized_pnl = 0
closed_at = current UTC timestamp
```

These Position capabilities already exist and can later be reused by the quantitative engine.

---

# 14. Performance Analytics

A complete quantitative performance analytics layer is not yet implemented.

The future system will need to calculate the performance information required to evaluate a strategy and portfolio.

This includes defining the exact metrics, calculation methodology, and reporting format before implementation.

The current Position and Trade entities provide some of the accounting data required for these calculations, but they do not constitute a complete performance analytics system.

---

# 15. Walk-Forward Analysis

Walk-forward analysis is not yet implemented.

The future implementation will evaluate strategy behavior over sequential historical periods.

The final methodology must explicitly define:

- training period
- validation period
- testing period
- window movement
- parameter/configuration handling
- out-of-sample evaluation
- result aggregation

---

# 16. Regime Stress Testing

A complete regime stress-testing engine is not currently implemented.

The ExecutionType enum contains:

```text
REGIME_TEST
```

but this is only an execution classification.

A complete regime-testing system still needs:

```text
Market Data
      ↓
Market Regime Identification
      ↓
Strategy Evaluation
      ↓
Regime-Specific Results
```

The exact regime definitions and testing methodology must be established before implementation.

---

# 17. Monte Carlo and Statistical Significance

A complete Monte Carlo/statistical-significance framework is not currently implemented.

The future implementation must define:

- what is resampled or randomized
- number of simulations
- randomization methodology
- random seed handling
- statistical measurements
- confidence intervals or distributions
- interpretation of results

The methodology should be documented before implementation.

---

# 18. ML Regime Detection

Machine-learning-based regime detection is not currently implemented.

The project specification identifies classical machine learning as the intended direction.

The future structure is expected to resemble:

```text
Historical Market Data
        ↓
Feature Generation
        ↓
Training Data
        ↓
ML Model
        ↓
Regime Prediction
        ↓
Strategy / Portfolio Layer
```

The actual model, features, training process, validation process, and output contract are still pending.

---

# 19. Multi-Factor Scoring

A complete multi-factor scoring engine is not currently implemented.

The future system will need to combine selected quantitative factors into standardized scores.

The score can then be consumed by the portfolio-management layer.

The exact factors, normalization method, weighting method, and scoring formula must be defined before implementation.

---

# 20. Portfolio Orchestration

A complete portfolio orchestration engine is not currently implemented.

The Position entity represents individual positions.

It does not itself provide complete portfolio management.

Portfolio orchestration will eventually need to coordinate information such as:

```text
Strategy Signals
        +
Market Regime
        +
Factor Scores
        +
Available Capital
        +
Portfolio Constraints
        ↓
Portfolio Decision
        ↓
Orders
```

The final allocation and rebalancing methodology is still pending.

---

# 21. Paper Trading

The Execution entity currently supports:

```text
ExecutionType.PAPER
```

However, a complete paper-trading engine is not currently implemented.

The future paper-trading flow is expected to connect:

```text
Market Data
      ↓
Strategy
      ↓
Signal
      ↓
Order
      ↓
Paper Execution
      ↓
Trade
      ↓
Position
      ↓
Portfolio
```

The existing Execution, Order, Trade, and Position entities provide the domain foundation for this work.

---

# 22. Current Quantitative Engine Boundary

At the current project stage, the following quantitative foundation exists:

```text
Strategy Management
        ↓
Strategy Configuration
        ↓
Strategy Interface
        ↓
Standardized Signal Foundation
```

The following components are still pending:

```text
Historical Market Data
        ↓
Indicator Engine
        ↓
Five Quantitative Strategies
        ↓
Complete Signal Engine
        ↓
Backtesting Engine
        ↓
Performance Analytics
        ↓
Walk-Forward Analysis
        ↓
Regime Stress Testing
        ↓
Monte Carlo / Statistical Significance
        ↓
ML Regime Detection
        ↓
Multi-Factor Scoring
        ↓
Portfolio Orchestration
        ↓
Paper Trading
```

---

# 23. Important Current-State Clarification

The current backend should not be described as having a completed quantitative trading engine.

What currently exists is the backend domain foundation plus the Strategy configuration and interface foundation.

The quantitative engine is the major remaining implementation area of the project.

The existing Execution, Order, Trade, and Position entities are ready to provide domain support for future quantitative execution, but the algorithms and simulation systems that connect them to real historical market data have not yet been implemented.
```