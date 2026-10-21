import type { components } from '@/api/schema';
import type { DateRangeValue } from '@/components/ui/date-range-field';
import { istDate } from '@/features/instruments/market-data';
import type { InstrumentLayout, RegistryEntry } from '@/features/strategies/core-strategies';
import type { Strategy } from '@/features/strategies/queries';
import { readConfig, type ParameterValue } from '@/features/strategies/strategy-config';
import {
  paramInputs,
  parseParams,
  savedParams,
  templateOf,
} from '@/features/strategies/strategy-form';
import { strategyKind } from '@/features/strategies/strategy-kind';

/**
 * Pure helpers for the backtest form (POST /backtests) and the status page
 * (GET /executions/{id}). Nothing here talks to the backend.
 */

export type Execution = components['schemas']['ExecutionResponse'];
export type BacktestRequest = components['schemas']['CreateBacktestRequest'];
export type ExecutionStatus = components['schemas']['ExecutionStatus'];

/** Polling stops at these: the backend never changes a run after it reaches one. */
export const TERMINAL_STATUSES: readonly ExecutionStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
export const isTerminal = (status: ExecutionStatus | undefined) =>
  status !== undefined && TERMINAL_STATUSES.includes(status);

/** How often the status page asks for news while a run is PENDING or RUNNING. */
export const POLL_MS = 2500;

/** Backend limits (app/schemas/backtesting/create.py). */
export const LIMITS = {
  capitalMax: 1_000_000_000_000,
  quantityMax: 1_000_000,
  slippageBpsMax: 1000,
  brokeragePctMax: 5,
  instrumentsMax: 20,
} as const;

export const DEFAULT_CAPITAL = '100000';

/** Only stored daily bars can be imported today, so backtests run on 1D. */
export const TIMEFRAME = '1D' as const;

/** Every input of the form, as typed text. */
export interface BacktestDraft {
  strategyId: string;
  /** First = the main instrument (A for pairs); the rest = other_instrument_ids. */
  instrumentIds: string[];
  range: DateRangeValue;
  capital: string;
  quantity: string;
  params: Record<string, string>;
  slippageBps: string;
  /** Brokerage as a percent of trade value ("0.03" = 0.03%); the API takes a fraction. */
  brokeragePct: string;
}

export function emptyDraft(): BacktestDraft {
  return {
    strategyId: '',
    instrumentIds: [''],
    range: { start: '', end: '' },
    capital: DEFAULT_CAPITAL,
    quantity: '1',
    params: {},
    slippageBps: '0',
    brokeragePct: '0',
  };
}

/**
 * No-code strategies are run by the backend's rule engine under this key. It has no
 * per-run parameters (the saved rules are used) and runs on one instrument.
 */
export const RULES_KEY = 'no_code_rules';
export const RULES_ENTRY: RegistryEntry = {
  strategy_key: RULES_KEY,
  parameters: [],
  required_inputs: [],
  instruments: 'single',
};
export const isRules = (entry: RegistryEntry | undefined) => entry?.strategy_key === RULES_KEY;

/**
 * Feature 6: a custom Python strategy, as the run forms see it. It trades one
 * instrument and has no template parameters (its own parameters are free-form
 * and arrive as context.params).
 */
export const PYTHON_KEY = 'python';
export const PYTHON_ENTRY: RegistryEntry = {
  strategy_key: PYTHON_KEY,
  parameters: [],
  required_inputs: [],
  instruments: 'single',
};
export const isPython = (entry: RegistryEntry | undefined) => entry?.strategy_key === PYTHON_KEY;

/** A no-code strategy needs at least one entry condition, or it can never trade. */
export const hasEntryConditions = (strategy: Strategy) =>
  readConfig(strategy.strategy_config).entry.length > 0;

/**
 * Saved strategies a backtest can run, turned on: made from a core template the
 * backend offers, built without code with at least one entry condition, or
 * written in Python (Feature 6: the backend runs it in its isolated sandbox).
 */
export function backtestable(strategies: Strategy[], registry: RegistryEntry[]): Strategy[] {
  const keys = new Set(registry.map((e) => e.strategy_key));
  return strategies.filter((s) => {
    if (!s.is_active) return false;
    const kind = strategyKind(s);
    if (kind === 'no-code') return hasEntryConditions(s);
    if (kind === 'python') return Boolean(s.python_code);
    return kind === 'template' && keys.has(templateOf(s.strategy_config) ?? '');
  });
}

export const entryFor = (strategy: Strategy | undefined, registry: RegistryEntry[]) => {
  if (!strategy) return registry.find((e) => e.strategy_key === templateOf(undefined));
  const kind = strategyKind(strategy);
  if (kind === 'no-code') return RULES_ENTRY;
  if (kind === 'python') return PYTHON_ENTRY;
  return registry.find((e) => e.strategy_key === templateOf(strategy.strategy_config));
};

const topK = (params: Record<string, string>) => {
  const n = Number(params.top_k);
  return Number.isInteger(n) && n > 0 ? n : 2;
};

/** Fewest instruments the strategy accepts. */
export function minInstruments(layout: InstrumentLayout, params: Record<string, string>) {
  if (layout === 'pair') return 2;
  if (layout === 'universe') return Math.min(LIMITS.instrumentsMax, Math.max(2, topK(params)));
  return 1;
}

/** Labels of the instrument slots. */
export function slotLabel(layout: InstrumentLayout, index: number): string {
  if (layout === 'pair') return index === 0 ? 'Instrument A' : 'Instrument B';
  if (layout === 'universe') return `Asset ${index + 1}`;
  return 'Instrument';
}

/** Keeps the chosen instruments, with as many slots as the strategy needs. */
export function fitSlots(ids: string[], layout: InstrumentLayout, params: Record<string, string>) {
  const min = minInstruments(layout, params);
  const max = layout === 'universe' ? LIMITS.instrumentsMax : min;
  const kept = ids.slice(0, max);
  while (kept.length < min) kept.push('');
  return kept;
}

/**
 * The draft after choosing a strategy: its parameters (saved values, else the
 * template defaults; `overrides` win, e.g. a previous run's values) and the
 * instrument slots its layout needs.
 */
export function withStrategy(
  draft: BacktestDraft,
  strategy: Strategy,
  entry: RegistryEntry,
  overrides: Record<string, unknown> = {},
): BacktestDraft {
  const params = paramInputs(entry, { ...savedParams(strategy.strategy_config), ...overrides });
  return {
    ...draft,
    strategyId: strategy.id,
    params,
    instrumentIds: fitSlots(draft.instrumentIds, entry.instruments, params),
  };
}

const text = (value: unknown, fallback: string) =>
  value === null || value === undefined ? fallback : String(value);

/** A number without float noise: 0.03 / 100 -> 0.0003, not 0.00030000000000000003. */
const clean = (n: number) => Number(n.toPrecision(12));

interface RunSettings {
  start_timestamp?: string | null;
  end_timestamp?: string | null;
  quantity?: number;
  other_instrument_ids?: string[];
  slippage_bps?: number;
  brokerage_rate?: number;
  strategy_key?: string;
  /** A no-code strategy's rules as they were when the run was submitted. */
  rules?: unknown;
}

/** What the backend stored about how a run was requested (null for older runs). */
export function runSettings(execution: Execution): RunSettings {
  const rs = execution.run_settings;
  return rs && typeof rs === 'object' ? (rs as RunSettings) : {};
}

/**
 * The form filled in from an earlier run ("Edit and rerun"). Parameters come back
 * as overrides, applied once the strategy and its template are known.
 */
export function draftFromExecution(execution: Execution): {
  draft: BacktestDraft;
  overrides: Record<string, unknown>;
} {
  const rs = runSettings(execution);
  return {
    draft: {
      strategyId: execution.strategy_id,
      instrumentIds: [execution.instrument_id ?? '', ...(rs.other_instrument_ids ?? [])],
      range: {
        start: rs.start_timestamp ? istDate(rs.start_timestamp) : '',
        end: rs.end_timestamp ? istDate(rs.end_timestamp) : '',
      },
      capital: text(execution.initial_capital, DEFAULT_CAPITAL),
      quantity: text(rs.quantity, '1'),
      params: {},
      slippageBps: text(rs.slippage_bps, '0'),
      brokeragePct: rs.brokerage_rate ? String(clean(rs.brokerage_rate * 100)) : '0',
    },
    overrides: execution.execution_config ?? {},
  };
}

/** Whole IST days to the timestamps the backend filters bars with (inclusive). */
export const startOfDay = (day: string) => `${day}T00:00:00+05:30`;
export const endOfDay = (day: string) => `${day}T23:59:59+05:30`;

export type DraftErrors = Record<string, string>;

const NUMBER = /^\d+(\.\d+)?$/;
const WHOLE = /^\d+$/;

function amount(
  raw: string,
  opts: { min: number; max: number; minIncluded: boolean; decimals?: number },
) {
  const value = raw.trim();
  if (!NUMBER.test(value)) return { error: 'Enter a number.' };
  const n = Number(value);
  if (opts.decimals !== undefined && (value.split('.')[1]?.length ?? 0) > opts.decimals)
    return { error: `Use at most ${opts.decimals} decimal places.` };
  if (opts.minIncluded ? n < opts.min : n <= opts.min)
    return {
      error: opts.minIncluded ? `Enter ${opts.min} or more.` : `Enter more than ${opts.min}.`,
    };
  if (n > opts.max) return { error: `Enter at most ${opts.max.toLocaleString('en-IN')}.` };
  return { value: n };
}

/**
 * Checks the draft the way the backend will, and builds the request.
 * Keys of `errors`: strategy, instrument.<n>, range, capital, quantity,
 * param.<name>, slippage, brokerage.
 */
export function buildRequest(
  draft: BacktestDraft,
  entry: RegistryEntry | undefined,
):
  | { ok: true; request: BacktestRequest; values: Record<string, ParameterValue> }
  | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  if (!draft.strategyId || !entry) errors.strategy = 'Choose a strategy.';

  const params = entry ? parseParams(entry, draft.params) : { ok: true as const, values: {} };
  if (!params.ok)
    for (const [name, message] of Object.entries(params.errors)) errors[`param.${name}`] = message;

  const layout = entry?.instruments ?? 'single';
  const seen = new Set<string>();
  draft.instrumentIds.forEach((id, index) => {
    if (!id) errors[`instrument.${index}`] = 'Choose an instrument.';
    else if (seen.has(id)) errors[`instrument.${index}`] = 'Already chosen above. Pick another.';
    seen.add(id);
  });
  const need = minInstruments(layout, draft.params);
  if (layout === 'universe' && draft.instrumentIds.length < need) {
    errors[`instrument.${draft.instrumentIds.length}`] =
      `Add at least ${need} assets (top_k is ${draft.params.top_k ?? 2}).`;
  }

  if (!draft.range.start || !draft.range.end) errors.range = 'Choose a start and an end date.';
  else if (draft.range.end < draft.range.start)
    errors.range = 'The end date is before the start date.';

  const capital = amount(draft.capital, {
    min: 0,
    max: LIMITS.capitalMax,
    minIncluded: false,
    decimals: 2,
  });
  if ('error' in capital) errors.capital = capital.error!;

  const quantity = draft.quantity.trim();
  if (!WHOLE.test(quantity) || Number(quantity) < 1)
    errors.quantity = 'Enter a whole number, 1 or more.';
  else if (Number(quantity) > LIMITS.quantityMax)
    errors.quantity = `Enter at most ${LIMITS.quantityMax.toLocaleString('en-IN')}.`;

  const slippage = amount(draft.slippageBps, {
    min: 0,
    max: LIMITS.slippageBpsMax,
    minIncluded: true,
  });
  if ('error' in slippage) errors.slippage = slippage.error!;
  const brokerage = amount(draft.brokeragePct, {
    min: 0,
    max: LIMITS.brokeragePctMax,
    minIncluded: true,
  });
  if ('error' in brokerage) errors.brokerage = brokerage.error!;

  if (Object.keys(errors).length || !entry || !params.ok) return { ok: false, errors };

  const [instrumentId, ...others] = draft.instrumentIds;
  return {
    ok: true,
    values: params.values,
    request: {
      strategy_id: draft.strategyId,
      strategy_key: entry.strategy_key,
      instrument_id: instrumentId!,
      other_instrument_ids: others,
      timeframe: TIMEFRAME,
      initial_capital: (capital as { value: number }).value,
      start_timestamp: startOfDay(draft.range.start),
      end_timestamp: endOfDay(draft.range.end),
      execution_config: params.values,
      quantity: Number(quantity),
      slippage_bps: (slippage as { value: number }).value,
      brokerage_rate: clean((brokerage as { value: number }).value / 100),
    },
  };
}

/**
 * Bars a strategy needs before it can give its first signal, as the backend
 * strategies are written (app/strategies/*.py). Earlier bars are warm-up: the
 * strategy answers HOLD on them.
 * - momentum, mean reversion, statistical arbitrage: `lookback` bars
 * - volatility arbitrage: `long_window` + 1 (it uses returns, which start on bar 2)
 * - tactical asset allocation: `lookback` + 1 (return over lookback bars)
 */
export function barsBeforeFirstSignal(key: string, params: Record<string, unknown>): number | null {
  const n = (name: string) => {
    const v = params[name];
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
  };
  switch (key) {
    case 'momentum':
    case 'mean_reversion':
    case 'statistical_arbitrage':
      return n('lookback');
    case 'volatility_arbitrage': {
      const w = n('long_window');
      return w === null ? null : w + 1;
    }
    case 'tactical_asset_allocation': {
      const w = n('lookback');
      return w === null ? null : w + 1;
    }
    default:
      return null;
  }
}

/** Warm-up and "too little data" sentences for the dataset preview. */
export function warmupNote(
  needed: number | null,
  bars: number | null,
): { text: string; insufficient: boolean } | null {
  if (needed === null) return null;
  const warm = needed - 1;
  const head = `The first ${warm} ${warm === 1 ? 'bar is' : 'bars are'} warm-up: the strategy needs ${needed} bars before its first signal.`;
  if (bars === null) return { text: head, insufficient: false };
  if (bars < needed) {
    return {
      text: `Not enough data: ${bars} ${bars === 1 ? 'bar' : 'bars'} in this range, but the strategy needs ${needed} before its first signal. The backtest would make no trades. Choose a longer range or smaller windows.`,
      insufficient: true,
    };
  }
  const usable = bars - warm;
  return {
    text: `${head} ${usable} of ${bars} bars can produce signals.`,
    insufficient: false,
  };
}

export type StepState = 'done' | 'current' | 'upcoming' | 'skipped';

export interface TimelineStep {
  label: string;
  at: string | null;
  state: StepState;
  note?: string;
}

const FINISH_LABEL: Record<string, string> = {
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

/**
 * The run's life as the backend recorded it: created, started by the worker,
 * finished (completed / failed / cancelled). Times are the backend's own;
 * "current" marks the step the run is waiting on now.
 */
export function timeline(
  execution: Pick<Execution, 'status' | 'created_at' | 'started_at' | 'completed_at'>,
): TimelineStep[] {
  const { status, created_at, started_at, completed_at } = execution;
  const created: TimelineStep = { label: 'Created', at: created_at, state: 'done' };

  if (status === 'PENDING') {
    return [
      created,
      { label: 'Started', at: null, state: 'current', note: 'Waiting for the backtest worker' },
      { label: 'Finished', at: null, state: 'upcoming' },
    ];
  }
  if (status === 'RUNNING') {
    return [
      created,
      { label: 'Started', at: started_at, state: 'done' },
      { label: 'Finished', at: null, state: 'current', note: 'Running on historical data' },
    ];
  }
  return [
    created,
    started_at
      ? { label: 'Started', at: started_at, state: 'done' }
      : { label: 'Started', at: null, state: 'skipped', note: 'Did not start' },
    { label: FINISH_LABEL[status] ?? status, at: completed_at, state: 'done' },
  ];
}

/** "1 min 05 s" between two backend timestamps. */
export function duration(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return 'under 1 s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, '0')} s`;
}
