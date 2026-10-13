# Domain Model

## 1. Overview

The current backend contains nine core entities:

1. User
2. BrokerAccount
3. Strategy
4. Instrument
5. Execution
6. Order
7. Trade
8. Position
9. Notification

These entities form the current backend domain foundation.

The domain model represents how users, strategies, executions, orders, trades, positions, and notifications are currently connected.

---

# 2. User

## Purpose

The User entity represents a registered platform user.

## Current Functionality

The current User implementation provides the foundation for user ownership across the backend.

Users are currently related to:

```text
User
 ├── Broker Accounts
 ├── Strategies
 └── Notifications
```

A user can therefore own broker accounts, strategies, and notifications.

---

# 3. BrokerAccount

## Purpose

BrokerAccount represents a broker account associated with a user.

## Current Functionality

The current implementation supports:

- broker account creation
- broker account retrieval
- broker account listing
- broker account update
- broker account deletion
- connect/disconnect state management
- ownership handling
- duplicate-account protection

The database enforces uniqueness for:

```text
user_id
broker_name
broker_user_id
```

This prevents duplicate broker-account identities for the same user.

## Current Relationship

```text
User
  ↓
BrokerAccount
```

## Current Limitation

The current implementation does not perform actual external broker authentication or live brokerage integration.

---

# 4. Strategy

## Purpose

Strategy represents a user-owned trading strategy definition.

## Current Functionality

The current Strategy implementation includes:

- strategy management
- strategy configuration
- strategy execution interface

The current configuration contract contains four sections:

```text
parameters
indicators
entry_conditions
exit_conditions
```

The current strategy interface provides a standardized foundation for future signal generation.

## Current Relationship

```text
User
  ↓
Strategy
```

A strategy belongs to a user.

## Current Limitation

The five final quantitative strategy algorithms are not currently implemented.

---

# 5. Instrument

## Purpose

Instrument represents a tradable financial instrument.

## Current Functionality

The current Instrument implementation includes:

- instrument creation
- instrument retrieval
- instrument update
- instrument deletion
- instrument validation
- instrument usage interface

Current instrument information includes:

```text
symbol
trading_symbol
name
exchange
instrument_type
isin
lot_size
tick_size
is_active
```

## Supported Exchanges

```text
NSE
BSE
MCX
NSE_FO
```

## Supported Instrument Types

```text
EQUITY
FUTURES
OPTIONS
ETF
INDEX
```

## Current Relationships

Instruments can be referenced by:

```text
Execution
Order
Position
```

---

# 6. Execution

## Purpose

Execution represents one execution instance of a strategy.

It provides the container around which orders, positions, and execution-related notifications are associated.

## Current Functionality

The current Execution implementation supports:

- execution creation
- execution retrieval
- execution listing
- execution update
- execution deletion
- lifecycle transitions

## Execution Types

The current execution types are:

```text
BACKTEST
PAPER
LIVE
REGIME_TEST
```

These values identify the intended type of execution.

They do not by themselves mean that complete backtesting, paper trading, live trading, or regime-testing engines currently exist.

## Execution Statuses

```text
PENDING
RUNNING
COMPLETED
FAILED
CANCELLED
```

## Current Lifecycle

```text
PENDING
   ↓
RUNNING
   ├── COMPLETED
   ├── FAILED
   └── CANCELLED
```

Invalid transitions are rejected.

## Current Relationships

```text
Execution
 ├── Strategy
 ├── BrokerAccount
 ├── Instrument
 ├── Orders
 ├── Positions
 └── Notifications
```

---

# 7. Order

## Purpose

Order represents an instruction associated with an execution and instrument.

## Current Functionality

The current Order implementation supports:

- order creation
- order retrieval
- order listing
- order update
- order deletion
- order lifecycle transitions
- numeric validation

## Order Types

```text
MARKET
LIMIT
SL
SLM
```

## Order Sides

```text
BUY
SELL
```

## Order Statuses

```text
PENDING
OPEN
COMPLETED
CANCELLED
REJECTED
```

## Current Lifecycle

```text
PENDING
 ├── OPEN
 └── CANCELLED

OPEN
 ├── COMPLETED
 ├── CANCELLED
 └── REJECTED
```

Terminal states cannot transition to another state.

## Current Numeric Rules

The database enforces:

```text
quantity > 0

filled_quantity >= 0

price > 0

average_fill_price > 0 when supplied
```

## Current Relationships

```text
Execution
  ↓
Order
  ├── Instrument
  └── Trades
```

---

# 8. Trade

## Purpose

Trade represents an executed trade associated with an Order.

## Current Functionality

The current Trade implementation supports:

- trade creation
- trade retrieval
- trade listing
- trade update
- trade deletion
- trade execution interface
- numeric validation
- Position integration

## Current Numeric Rules

The database enforces:

```text
executed_quantity > 0

executed_price > 0

brokerage >= 0

total_charges >= 0
```

## Current Trade Execution Flow

When a trade is executed, the current service performs:

```text
Trade Execution
      ↓
Find Order
      ↓
Find Position
      ↓
Apply Trade Quantity
      ↓
Update Position
```

The Order determines:

- execution
- instrument
- BUY/SELL side

The Trade provides:

- executed quantity
- executed price
- brokerage
- charges

These values are used when updating the Position.

## Current Relationship

```text
Order
  ↓
Trade
```

A Trade belongs to an Order.

---

# 9. Position

## Purpose

Position represents the current holding associated with an execution and instrument.

## Current Functionality

The current Position implementation supports:

- position creation
- position retrieval
- position listing
- position update
- position deletion
- position validation
- position status handling
- trade-driven quantity updates
- weighted-average price calculation
- realized P&L calculation
- unrealized P&L calculation
- market-value calculation
- position closing

## Position Status

```text
OPEN
CLOSED
```

## Current Numeric Rules

The database enforces:

```text
quantity >= 0

average_price > 0

current_price > 0 when supplied

market_value >= 0 when supplied
```

## BUY Behavior

When a BUY trade is applied:

```text
Existing Quantity
        +
Executed Quantity
        =
New Quantity
```

For an existing position, the average acquisition price is recalculated using weighted-average cost.

## SELL Behavior

When a SELL trade is applied:

```text
Existing Quantity
        -
Executed Quantity
        =
New Quantity
```

A SELL larger than the existing quantity is rejected.

For an open position, the average acquisition price remains unchanged after a SELL.

## Realized P&L

For a SELL:

```text
(executed_price - existing_average_price)
× executed_quantity
```

The resulting realized P&L is added to the position's existing realized P&L.

## Unrealized P&L

When current price is available:

```text
(current_price - average_price)
× quantity
```

When current price is unavailable, unrealized P&L is not recalculated.

## Market Value

When current price is available:

```text
current_price × quantity
```

When current price is unavailable, market value remains unavailable.

## Full Position Closure

When a SELL reduces quantity to zero:

```text
quantity = 0
position_status = CLOSED
closed_at = current UTC timestamp
unrealized_pnl = 0
```

Realized P&L is retained.

## Current Relationships

```text
Position
 ├── Execution
 ├── Instrument
 └── BrokerAccount
```

The detailed Position assumptions are documented separately in:

```text
docs/position_phase3_assumptions.md
```

---

# 10. Notification

## Purpose

Notification represents a message associated with a user and optionally an execution.

## Current Functionality

The current Notification implementation supports:

- notification creation
- notification listing
- notification retrieval
- notification update
- notification deletion
- execution-linked notification creation
- read/unread state validation

## Notification Types

```text
INFO
WARNING
ERROR
TRADE
```

## Notification Priorities

```text
LOW
MEDIUM
HIGH
CRITICAL
```

## Read State

The current implementation uses:

```text
Unread:
is_read = false
read_at = null
```

and:

```text
Read:
is_read = true
read_at is present
```

The database contains checks enforcing these relationships.

## Current Relationships

```text
User
  ↓
Notification
  ↓
Execution (optional)
```

An execution can therefore have associated notifications.

---

# 11. Complete Domain Relationship

The main currently implemented domain flow is:

```text
User
  │
  ├──────────────→ BrokerAccount
  │
  ├──────────────→ Strategy
  │                    │
  │                    ↓
  │                Execution
  │                    │
  │          ┌─────────┼─────────┐
  │          ↓         ↓         ↓
  │        Order    Position  Notification
  │          │
  │          ↓
  │        Trade
  │          │
  │          └──────────────→ Position
  │
  └──────────────→ Notification
```

In addition, both Orders and Positions reference Instruments.

---

# 12. Database Relationships

The current foreign-key relationships are:

```text
BrokerAccount.user_id
        → User.id

Strategy.user_id
        → User.id

Execution.strategy_id
        → Strategy.id

Execution.broker_account_id
        → BrokerAccount.id

Execution.instrument_id
        → Instrument.id

Order.execution_id
        → Execution.id

Order.instrument_id
        → Instrument.id

Trade.order_id
        → Order.id

Position.execution_id
        → Execution.id

Position.instrument_id
        → Instrument.id

Position.broker_account_id
        → BrokerAccount.id

Notification.user_id
        → User.id

Notification.execution_id
        → Execution.id
```

---

# 13. Current Domain Boundary

The nine entities above are implemented and tested as the current backend domain foundation.

They provide the core objects required for the larger project.

However, these entities alone do not constitute the complete quantitative platform.

The following major components are still outside the current domain implementation:

- historical market-data pipeline
- quantitative indicator engine
- five quantitative strategy implementations
- complete backtesting engine
- performance analytics
- walk-forward analysis
- regime stress testing
- Monte Carlo/statistical significance
- ML regime detection
- multi-factor scoring
- portfolio orchestration
- complete paper-trading engine
- visual strategy builder
- Python strategy editor
- final frontend integration
```
