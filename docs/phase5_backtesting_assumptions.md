# Phase 5 — Backtesting Engine
## Execution Assumptions and Completion Record

### 1. Purpose

The backtesting engine connects historical market data to strategy signals, orders, simulated fills, portfolio positions, portfolio valuation, and final backtest results.

Pipeline:

Historical Data
→ Strategy
→ Signals
→ Orders
→ Simulated Fills
→ Trades
→ Positions
→ Portfolio Value
→ Backtest Result

---

## 2. 5A — Backtest Engine Architecture

The backtesting subsystem is organized as:

app/backtesting/
- engine.py
- context.py
- broker.py
- portfolio.py
- execution.py
- fills.py
- results.py

The engine coordinates the backtest while the broker, execution, portfolio, fill, context, and result components separate the major responsibilities.

---

## 3. 5B — Backtest Clock

Historical data is processed chronologically.

At timestamp t, the strategy receives only:

data.loc[:timestamp]

Therefore, future observations are not intentionally exposed to the strategy during signal generation.

The engine also validates that the input DataFrame is chronologically sorted.

---

## 4. 5C — Signal Processing

At each historical timestep:

Market Data
→ Strategy Context
→ Strategy
→ Strategy Signal

The strategy receives the historical data available up to the current timestamp.

---

## 5. 5D — Order Generation

Strategy signals are converted into the existing Order domain model.

No separate incompatible backtesting order model is introduced.

Supported signal actions are:

- BUY
- SELL
- HOLD

Allocation-based strategies can generate multiple orders for multiple instruments.

---

# 6. 5E — Simulated Execution Assumptions

## 6.1 Market Orders

Market orders are filled immediately at the simulated market price, subject to configured slippage.

BUY orders increase the execution price when positive slippage is configured.

SELL orders decrease the execution price when positive slippage is configured.

Slippage is configured in basis points.

Formula:

slippage_factor = slippage_bps / 10000

BUY:

fill_price = market_price × (1 + slippage_factor)

SELL:

fill_price = market_price × (1 - slippage_factor)

---

## 6.2 Limit Orders

Limit orders use the supplied historical high and low prices to determine whether the limit price was reached during the timestep.

BUY limit:

The order is not filled when:

market_low > limit_price

Otherwise, it is filled at the limit price.

SELL limit:

The order is not filled when:

market_high < limit_price

Otherwise, it is filled at the limit price.

The current implementation therefore models limit-order triggering from the available historical OHLC range rather than intraday order-book information.

---

## 6.3 Brokerage

Brokerage is represented as a configurable rate.

brokerage = trade_value × brokerage_rate

Brokerage is included in the fill's total charges and is deducted from portfolio cash/proceeds through portfolio accounting.

---

## 6.4 Transaction Costs

The current simulated execution model represents transaction costs through brokerage charges and configured execution slippage.

The resulting charges are carried by SimulatedFill.total_charges and included in portfolio accounting.

---

## 6.5 Position Sizing

For ordinary single-instrument signals, the engine supports a configurable integer quantity.

For allocation-based strategies, target position quantities are calculated from portfolio value and the allocation weight.

Conceptually:

target_value = portfolio_value × |allocation|

target_quantity = floor(target_value / market_price)

Signed allocations determine direction:

positive allocation → long / BUY

negative allocation → short / SELL

zero allocation → exit existing position where applicable.

---

## 6.6 Available Capital

The Portfolio maintains available cash.

BUY transactions are rejected when their total cost exceeds available cash.

SELL transactions increase available cash through trade proceeds after charges.

For allocation rebalancing, SELL orders are executed before BUY orders so that capital released from existing positions can be reused for the new target allocation.

The portfolio's insufficient-cash protection remains active.

---

## 6.7 Long Positions

BUY transactions establish or increase long positions.

Average entry price is updated using weighted-average pricing when additional long quantity is purchased.

SELL transactions reduce long positions and realize P&L.

---

## 6.8 Short Positions

SELL transactions can establish short positions when no long position exists.

Short positions are represented using negative quantities.

BUY transactions can cover short positions and realize the corresponding P&L.

---

## 6.9 Statistical Arbitrage

The Statistical Arbitrage strategy uses allocation signs to represent its two legs.

Example:

instrument_a: +1.0
instrument_b: -1.0

This represents:

LONG instrument_a
SHORT instrument_b

The backtesting engine supports both legs through the existing order, fill, and portfolio flow.

---

## 6.10 Tactical Asset Allocation

Tactical Asset Allocation uses target allocations across multiple instruments.

The engine compares target quantities with current positions.

When allocations change:

1. Existing positions requiring reduction are sold.
2. New/increased target positions are purchased.
3. SELL orders execute before BUY orders to release capital.
4. Unchanged allocations do not generate repeated trades.

---

# 7. 5F — Trade Generation

A simulated fill is applied to the Portfolio.

The backtest records executed trades in BacktestResult.trades.

The backtest uses lightweight trade dictionaries for result reporting rather than persisting ORM Trade records.

Portfolio positions are updated by Portfolio.apply_trade().

---

# 8. 5G — Portfolio Accounting

The Portfolio tracks:

- initial capital
- cash
- open positions
- closed positions
- realized P&L
- total fees
- equity history

Portfolio value is calculated as:

cash + market value of open positions

Unrealized P&L is derived when an existing Position domain object is generated from current market prices.

---

# 9. 5H — Backtest Result

BacktestResult contains:

- start timestamp
- end timestamp
- initial capital
- final capital
- total return
- trades
- equity curve
- maximum drawdown
- performance statistics container

Maximum drawdown is calculated from the recorded equity curve.

Total return is calculated as:

(final capital - initial capital) / initial capital

---

# 10. 5I — Validation

The backtesting engine has tests covering:

- no signals
- BUY execution
- SELL execution
- multiple trades
- insufficient capital
- transaction costs
- slippage
- position closure
- chronological execution
- no-look-ahead behavior
- Statistical Arbitrage two-leg execution
- TAA allocation sizing
- unchanged TAA allocation
- TAA rebalancing

Current backtesting engine test status:

10 passed

Full project regression:

504 passed

---

# 11. Phase 5 Gate

The complete historical backtesting pipeline is operational:

Historical Data
→ Strategy
→ Signal
→ Order
→ Simulated Fill
→ Trade Record
→ Position
→ Portfolio Value
→ Backtest Result

Phase 5 is considered complete.

---

# 12. Implementation Notes

The backtesting implementation is intentionally simulation-oriented.

The current implementation does not model:

- tick-level execution
- order-book depth
- market impact beyond configured slippage
- intraday execution paths
- real exchange matching
- options implied-volatility surfaces

These limitations are consistent with the historical-data/backtesting scope currently implemented.

---