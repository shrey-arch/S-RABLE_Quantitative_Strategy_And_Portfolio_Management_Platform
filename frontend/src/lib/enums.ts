import type { components } from '@/api/schema';

/**
 * Backend enum values as runtime lists (for dropdowns and status badges).
 * `satisfies` makes the type-check fail if openapi.json changes and a value is
 * added, removed or renamed - so these lists can never drift from the backend.
 *
 * Only enums used by features cleared in Phase 0 are listed.
 */
type Schemas = components['schemas'];

export const EXECUTION_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly Schemas['ExecutionStatus'][];

/** Execution types the UI offers. PAPER is deferred; LIVE is never offered. */
export const OFFERED_EXECUTION_TYPES = [
  'BACKTEST',
  'REGIME_TEST',
] as const satisfies readonly Schemas['ExecutionType'][];

export const STRATEGY_TYPES = [
  'PYTHON',
  'NO_CODE',
] as const satisfies readonly Schemas['StrategyType'][];

export const BROKER_NAMES = [
  'ZERODHA',
  'UPSTOX',
  'ANGEL_ONE',
  'DHAN',
] as const satisfies readonly Schemas['BrokerName'][];

export const EXCHANGES = [
  'NSE',
  'BSE',
  'MCX',
  'NSE_FO',
] as const satisfies readonly Schemas['Exchange'][];

export const INSTRUMENT_TYPES = [
  'EQUITY',
  'FUTURES',
  'OPTIONS',
  'ETF',
  'INDEX',
] as const satisfies readonly Schemas['InstrumentType'][];

/**
 * These two are plain strings in openapi.json, so the values come from the
 * backend enum source (app/enums/connection_status.py, account_status.py).
 */
export const CONNECTION_STATUSES = ['CONNECTED', 'DISCONNECTED', 'EXPIRED'] as const;
export const ACCOUNT_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;

/** Polling continues only while an execution is in one of these states. */
export const ACTIVE_EXECUTION_STATUSES: readonly string[] = ['PENDING', 'RUNNING'];
