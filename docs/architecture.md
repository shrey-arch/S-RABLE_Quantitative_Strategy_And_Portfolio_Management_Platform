# System Architecture

## 1. Project

The project is a Quantitative Strategy Development and Portfolio Management Platform.

The backend is responsible for managing the core entities and the business rules required to support strategy execution, orders, trades, positions, and notifications.

The current backend is the foundation of the larger quantitative platform.

---

## 2. Current Backend Architecture

The backend follows a layered architecture:

```text
Client / Frontend
       ↓
FastAPI API Routes
       ↓
Service Layer
       ↓
Repository Layer
       ↓
SQLAlchemy Models
       ↓
PostgreSQL / Supabase
```

Each layer has a specific responsibility.

---

## 3. API Layer

The API layer is built using FastAPI.

It receives HTTP requests from clients and exposes the currently implemented backend functionality.

Current API domains are:

- Users
- Broker Accounts
- Strategies
- Instruments
- Executions
- Orders
- Trades
- Positions
- Notifications

The API layer is responsible for:

- receiving requests
- validating request data using Pydantic schemas
- calling the appropriate service
- converting domain objects into response schemas
- returning appropriate HTTP responses
- handling not-found cases and other API-level errors

The API layer should not contain the main business rules of the system.

---

## 4. Service Layer

The service layer contains the business and domain logic of the application.

Current responsibilities include:

- creating entities
- retrieving entities
- updating entities
- deleting entities
- ownership-related checks where implemented
- lifecycle transitions
- domain validation
- strategy configuration handling
- trade execution
- position updates caused by trades
- notification read-state validation

Examples of domain behavior currently handled by services include:

```text
Execution:
PENDING → RUNNING → COMPLETED / FAILED / CANCELLED

Order:
PENDING → OPEN
PENDING → CANCELLED
OPEN → COMPLETED / CANCELLED / REJECTED

Trade:
Trade execution can update the related Position

Position:
BUY and SELL trades update quantity and P&L according to
the currently implemented Position rules

Notification:
Read and unread states are validated
```

The service layer keeps these rules outside the API routes and database repositories.

---

## 5. Repository Layer

The repository layer is responsible for database access.

Repositories use SQLAlchemy sessions to communicate with PostgreSQL.

Current repository operations include:

- create
- retrieve
- list
- update
- delete
- domain-specific database queries

The repository layer is intentionally kept separate from business logic.

For example:

```text
API
 ↓
Service decides what should happen
 ↓
Repository performs the database operation
```

---

## 6. Database Layer

The project uses PostgreSQL through Supabase.

SQLAlchemy is used as the ORM.

Alembic is used to manage database schema migrations.

The current Alembic migration head is:

```text
notification_read_state_checks
```

The database currently contains these application tables:

```text
users
broker_accounts
strategies
instruments
executions
orders
trades
positions
notifications
```

The database also contains the `alembic_version` table used by Alembic.

---

## 7. Core Domain Relationship

The main currently implemented trading-domain relationship is:

```text
User
  ↓
Strategy
  ↓
Execution
  ↓
Order
  ↓
Trade
  ↓
Position
```

This represents the main chain of the current backend domain.

A user owns strategies.

A strategy can have executions.

An execution can contain orders.

An order can produce trades.

Trades update positions.

---

## 8. Additional Domain Relationships

The current backend also contains these relationships:

```text
User
 ├── Broker Accounts
 ├── Strategies
 └── Notifications
```

```text
Execution
 ├── Strategy
 ├── Broker Account
 ├── Instrument
 ├── Orders
 ├── Positions
 └── Notifications
```

```text
Order
 ├── Execution
 ├── Instrument
 └── Trades
```

```text
Position
 ├── Execution
 ├── Instrument
 └── Broker Account
```

```text
Notification
 ├── User
 └── Execution
```

---

## 9. Database Integrity

The database contains foreign-key relationships between the core entities.

The database also contains project-specific constraints.

Current important constraints include:

### Broker Account

The combination of:

```text
user_id
broker_name
broker_user_id
```

is unique.

### Execution

Initial capital must be positive.

### Order

The database validates:

```text
quantity > 0
filled_quantity >= 0
price > 0
average_fill_price > 0 when supplied
```

### Trade

The database validates:

```text
executed_quantity > 0
executed_price > 0
brokerage >= 0
total_charges >= 0
```

### Position

The database validates:

```text
quantity >= 0
average_price > 0
current_price > 0 when supplied
market_value >= 0 when supplied
```

### Notification

The database validates the relationship between:

```text
is_read
read_at
```

An unread notification cannot have a read timestamp.

A read notification must have a read timestamp.

---

## 10. Current Backend Domain

The following nine core entities are currently implemented:

```text
1. User
2. BrokerAccount
3. Strategy
4. Instrument
5. Execution
6. Order
7. Trade
8. Position
9. Notification
```

These entities form the current backend domain foundation.

---

## 11. Testing

The backend currently has an automated regression test suite.

The latest complete regression result is:

```text
354 passed
```

The tests cover the implemented backend behavior including:

- API routes
- services
- repositories
- validation rules
- lifecycle transitions
- strategy configuration
- trade execution
- position calculations
- notification behavior
- database-related behavior

---

## 12. Current Quantitative Boundary

The current backend provides the domain foundation required by the larger quantitative platform.

However, the following major components are not yet implemented:

- historical market-data pipeline
- reusable quantitative indicator engine
- five quantitative strategy implementations
- complete backtesting engine
- performance and risk analytics
- walk-forward analysis
- regime stress testing
- Monte Carlo/statistical significance framework
- ML regime detection
- multi-factor scoring
- portfolio orchestration
- complete paper-trading engine
- visual/no-code strategy builder
- Python strategy editor
- final frontend integration

These components are separate from the currently completed nine-entity backend foundation.

---

## 13. Current System Position

The current architecture should therefore be understood as:

```text
                    CURRENT BACKEND

                         User
                          │
             ┌────────────┼────────────┐
             ↓            ↓            ↓
       BrokerAccount   Strategy   Notification
                          │            ↑
                          ↓            │
                      Execution ───────┘
                          │
                    ┌─────┴─────┐
                    ↓           ↓
                  Order      Position
                    │
                    ↓
                  Trade
                    │
                    └──────→ Position
```

This diagram represents the functionality currently implemented in the backend.

The future quantitative engine, historical-data system, validation framework, portfolio intelligence, and frontend will be built around this foundation.
```