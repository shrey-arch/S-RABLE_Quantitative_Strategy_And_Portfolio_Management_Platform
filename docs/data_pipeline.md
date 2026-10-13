# Data Pipeline

## 1. Purpose

The data pipeline is responsible for bringing market data into the platform in a consistent and usable form.

The quantitative engine will depend on this data for:

- indicator calculations
- strategy signals
- historical backtesting
- validation
- quantitative analysis

At the current stage of the project, the complete historical market-data pipeline is **not yet implemented**.

---

# 2. Current Data Foundation

The current backend contains the `Instrument` entity.

Instrument represents the financial instruments that the platform works with.

The current Instrument implementation contains:

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

The current supported exchanges include:

```text
NSE
BSE
MCX
NSE_FO
```

The current supported instrument types include:

```text
EQUITY
FUTURES
OPTIONS
ETF
INDEX
```

Instrument validation and usage functionality are already implemented.

---

# 3. Instrument vs Market Data

Instrument and market data are two different concepts.

An Instrument answers:

```text
"What financial instrument is this?"
```

Market data answers:

```text
"What happened to this instrument during a particular period?"
```

For example:

```text
Instrument
    ↓
RELIANCE / NSE / EQUITY

Market Data
    ↓
Date
Open
High
Low
Close
Volume
```

The current backend has the first part.

The complete historical market-data system is still pending.

---

# 4. Current Historical Data Status

A complete historical market-data ingestion and storage pipeline is not currently implemented.

The current backend does not yet provide a complete system for:

- obtaining historical market data
- storing historical OHLCV records
- normalizing provider-specific data
- validating historical datasets
- handling duplicate records
- handling missing records
- retrieving historical datasets for backtesting

Therefore, the quantitative engine cannot currently be considered connected to a complete historical data source.

---

# 5. Project Data Scope

The project specification describes a market-data scope including:

- Indian equity markets
- NSE equity markets / top 200
- Nifty products
- Indian government securities
- approximately 10 years of historical data
- daily OHLCV data

The final implementation must follow the approved project scope and the actual availability of the selected data source.

The exact external data provider has not yet been implemented as part of the current backend.

---

# 6. Intended Data Pipeline

The complete data pipeline is expected to follow this structure:

```text
External Market Data
        ↓
Data Ingestion
        ↓
Normalization
        ↓
Instrument Mapping
        ↓
Data Validation
        ↓
Storage
        ↓
Dataset Retrieval
        ↓
Quantitative Engine
```

Each stage has a separate responsibility.

---

# 7. Data Ingestion

The ingestion layer will obtain market data from the selected external data source.

The ingestion process will eventually need to handle:

- source connection
- data retrieval
- supported instruments
- requested date ranges
- requested frequency
- provider errors
- incomplete responses

The exact provider and integration method are not yet implemented.

---

# 8. Data Normalization

Different market-data sources may use different field names and formats.

The normalization layer will convert source-specific data into the platform's internal representation.

Normalization will need to define:

- column names
- symbol format
- instrument identifiers
- date/time format
- OHLCV fields
- numeric types
- frequency representation

The goal is for the rest of the quantitative system to work with one consistent internal data format.

---

# 9. Instrument Mapping

Historical market-data records must be associated with the existing Instrument entity.

The intended relationship is:

```text
Market Data Record
        ↓
Instrument
```

or conceptually:

```text
Instrument ID
       +
Date
       +
OHLCV Data
```

The data pipeline should not create a second independent definition of an instrument.

The existing Instrument entity should remain the authoritative representation of the tradable instrument.

---

# 10. OHLCV Data

The project scope identifies daily OHLCV market data.

The core market-data fields are:

```text
Date
Open
High
Low
Close
Volume
```

The final market-data schema must explicitly define:

- data types
- precision
- date/time representation
- instrument relationship
- uniqueness rules
- nullability
- validation rules

These details are not currently implemented in the backend.

---

# 11. Data Validation

Historical market data must be validated before it is used by the quantitative engine.

The validation layer will eventually check for issues such as:

- missing required values
- invalid numeric values
- invalid OHLC relationships
- duplicate records
- invalid dates
- inconsistent instrument mappings
- incomplete datasets

The exact validation rules must be finalized before implementation.

Invalid data should not silently enter the backtesting dataset.

---

# 12. Duplicate Data

The future data pipeline must explicitly handle duplicate historical records.

A duplicate must be identifiable using the final market-data identity definition.

The final implementation must define whether duplicate records are:

- rejected
- ignored
- replaced
- updated

This behavior is not currently implemented.

---

# 13. Missing Data

The future data pipeline must explicitly define how missing market data is handled.

Possible causes include:

- missing provider records
- non-trading days
- incomplete historical periods
- unavailable instrument data
- provider errors

The final system must distinguish between an expected non-trading day and an actual missing data record.

The exact handling policy is still pending implementation.

---

# 14. Market Calendar

The quantitative engine must eventually understand which dates are valid trading dates.

This becomes important when working with:

- daily data
- rolling indicators
- historical windows
- backtesting periods
- walk-forward analysis

A complete market-calendar implementation is not currently present.

---

# 15. Data Storage

A dedicated historical market-data storage model and migration are not currently implemented.

The future storage layer must provide efficient retrieval by at least:

```text
Instrument
Start Date
End Date
Frequency
```

The stored data must be suitable for repeated use by:

- indicator calculations
- strategy execution
- backtesting
- validation
- analytics

---

# 16. Dataset Retrieval

The quantitative engine will eventually require a standard dataset interface.

The intended request will conceptually contain:

```text
Instrument
Start Date
End Date
Frequency
```

and return validated chronological market data.

Conceptually:

```text
Dataset Request
      ↓
Historical Data Repository
      ↓
Validated Dataset
      ↓
Quantitative Engine
```

This dataset retrieval interface is not yet implemented.

---

# 17. Relationship With Quantitative Engine

The final relationship between the data pipeline and quantitative engine will be:

```text
Historical Data
       ↓
Validation
       ↓
Dataset
       ↓
Indicators
       ↓
Strategy
       ↓
Signals
       ↓
Backtesting / Execution
```

The data pipeline is therefore a prerequisite for the quantitative strategy and backtesting work.

---

# 18. Current Boundary

The following parts currently exist:

```text
Instrument Entity
Instrument Validation
Instrument Usage Interface
```

The following parts are still pending:

```text
External Market Data Provider
        ↓
Historical Data Ingestion
        ↓
Historical Data Schema
        ↓
Historical Data Storage
        ↓
Normalization
        ↓
Data Validation Pipeline
        ↓
Duplicate Handling
        ↓
Missing Data Handling
        ↓
Market Calendar
        ↓
Dataset Retrieval Interface
```

---

# 19. Important Current-State Clarification

The existence of the Instrument entity does **not** mean that historical market data is already available to the system.

The current backend can identify and manage instruments, but it does not yet provide the complete historical OHLCV data pipeline required to run quantitative backtests.

The historical market-data foundation is therefore one of the major remaining implementation areas of the project.
```