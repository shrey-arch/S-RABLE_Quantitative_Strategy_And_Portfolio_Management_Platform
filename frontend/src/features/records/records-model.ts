import type { components } from '@/api/schema';
import { formatDateTime } from '@/lib/format';

/**
 * Trading records (Phase 15): the simulated orders, trades and positions stored
 * from the user's backtests. Values are shown as the API returns them; the
 * formulas here only explain how the backend computed them.
 */

type Schemas = components['schemas'];
export type Order = Schemas['OrderResponse'];
export type Trade = Schemas['TradeResponse'];
export type Position = Schemas['PositionResponse'];
export type RecordCounts = Schemas['RecordCounts'];
export type Execution = Schemas['ExecutionResponse'];

export const RECORD_TABS = ['orders', 'trades', 'positions'] as const;
export type RecordTab = (typeof RECORD_TABS)[number];
export const RECORD_TAB_LABELS: Record<RecordTab, string> = {
  orders: 'Orders',
  trades: 'Trades',
  positions: 'Positions',
};
export const isRecordTab = (value: string | null): value is RecordTab =>
  RECORD_TABS.includes(value as RecordTab);

export const ORDER_STATUSES = ['PENDING', 'OPEN', 'COMPLETED', 'CANCELLED', 'REJECTED'] as const;
export const POSITION_STATUSES = ['OPEN', 'CLOSED'] as const;
export const SIDES = ['BUY', 'SELL'] as const;
export const DIRECTIONS = ['LONG', 'SHORT'] as const;

export const MAINTENANCE_LABEL = 'Simulated record maintenance \u2014 no broker orders';

/** Order status changes the backend offers, in lifecycle order. */
export const ORDER_ACTIONS = [
  { action: 'open', label: 'Mark open', to: 'OPEN' },
  { action: 'complete', label: 'Mark completed', to: 'COMPLETED' },
  { action: 'cancel', label: 'Mark cancelled', to: 'CANCELLED' },
  { action: 'reject', label: 'Mark rejected', to: 'REJECTED' },
] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number]['action'];

/** How the backend computed each number (explanations only; nothing is recomputed). */
export const FORMULAS = {
  averagePrice:
    'Weighted average on BUY: (held quantity x average price + bought quantity x price) / new quantity. A sale that opens or adds to a short averages the same way. Stored to 2 decimals.',
  realized:
    "Realised P&L on SELL (closing a long): (sell price - average price) x quantity closed; on BUY closing a short: (average price - buy price) x quantity closed. Before charges. A position shows the sum over the run's fills on its instrument.",
  unrealized:
    "Unrealised P&L = (current price - average price) x quantity, with the quantity negative for a short. Current price = the run's last stored close. 0 once closed.",
  marketValue: 'Market value = quantity x current price (the size of the position, long or short).',
  charges: 'Total charges = brokerage plus the other charges of the fill.',
  orderPrice:
    "A market order is sent at the bar's close (Price) and fills on that bar with slippage (Average fill price).",
} as const;

/** The filters a records list sends, read from the address. Empty values are left out. */
export interface RecordFilters {
  execution_id?: string;
  instrument_id?: string;
  status?: string;
  side?: string;
  direction?: string;
  start_date?: string;
  end_date?: string;
}

export const FILTER_PARAMS = {
  execution: 'execution_id',
  instrument: 'instrument_id',
  status: 'status',
  side: 'side',
  direction: 'direction',
  from: 'start_date',
  to: 'end_date',
} as const;
export type FilterParam = keyof typeof FILTER_PARAMS;

/** Which filters each list takes (the API ignores nothing silently: unsupported ones are not sent). */
export const TAB_FILTERS: Record<RecordTab, FilterParam[]> = {
  orders: ['execution', 'instrument', 'status', 'side', 'from', 'to'],
  trades: ['execution', 'instrument', 'side', 'from', 'to'],
  positions: ['execution', 'instrument', 'status', 'direction', 'from', 'to'],
};

export function filtersFor(tab: RecordTab, params: URLSearchParams): RecordFilters {
  const out: RecordFilters = {};
  for (const key of TAB_FILTERS[tab]) {
    const value = params.get(key);
    if (value) out[FILTER_PARAMS[key]] = value;
  }
  return out;
}

/** A status filter only applies to the tab whose statuses it names. */
export function statusesFor(tab: RecordTab): readonly string[] {
  return tab === 'positions' ? POSITION_STATUSES : tab === 'orders' ? ORDER_STATUSES : [];
}

/** The open record in the drawer, kept in the address as "order:<id>" etc. */
export type RecordRef = { kind: 'order' | 'trade' | 'position'; id: string };
export function parseRecordRef(value: string | null): RecordRef | null {
  const match = /^(order|trade|position):([0-9a-f-]{36})$/.exec(value ?? '');
  return match ? { kind: match[1] as RecordRef['kind'], id: match[2]! } : null;
}
export const recordRef = (ref: RecordRef) => `${ref.kind}:${ref.id}`;

/** "Strategy name - 12 Oct 2026, 10:15 IST" for an execution, from the lists already loaded. */
export function executionLabel(
  execution: Pick<Execution, 'id' | 'strategy_id' | 'created_at'> | undefined,
  strategyName: (id: string) => string | undefined,
): string {
  if (!execution) return 'Backtest';
  const name = strategyName(execution.strategy_id) ?? 'Deleted strategy';
  return `${name} \u00b7 ${formatDateTime(execution.created_at)}`;
}
