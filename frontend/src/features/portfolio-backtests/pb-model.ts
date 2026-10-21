import type { components } from '@/api/schema';
import { formatINR, formatNumber, formatPercent, MISSING } from '@/lib/format';

type Schemas = components['schemas'];
export type PortfolioBacktestSummary = Schemas['PortfolioBacktestSummary'];
export type PortfolioBacktestDetail = Schemas['PortfolioBacktestDetail'];
export type PortfolioBacktestResults = Schemas['PortfolioBacktestResults'];
export type PortfolioBacktestRequest = Schemas['CreatePortfolioBacktestRequest'];
export type RebalanceEntry = Schemas['RebalanceEntry'];
export type SeriesMetrics = Schemas['SeriesMetrics'];
export type Objective = Schemas['Objective'];
export type Relative = Schemas['Relative'];

/**
 * Portfolio backtest against Nifty 50 (app/portfolio_backtest/simulation.py).
 * Every number on these pages comes from the API; this file only names, orders
 * and formats them, and turns the form into the request.
 */

export const SERIES_ORDER = ['portfolio', 'nifty', 'equal_weight', 'sixty_forty'] as const;
export type SeriesKey = (typeof SERIES_ORDER)[number];

export const SERIES_LABELS: Record<SeriesKey, string> = {
  portfolio: 'Portfolio',
  nifty: 'Nifty 50 (buy and hold)',
  equal_weight: 'Equal weight',
  sixty_forty: '60/40 Nifty 50 / debt',
};

/** The series the run has, in display order (60/40 only when it was asked for). */
export const seriesIn = (results: PortfolioBacktestResults): SeriesKey[] =>
  SERIES_ORDER.filter((key) => key in results.series);

/** One series (value or drawdown) as chart points, one per trading day. */
export function seriesPoints(
  results: PortfolioBacktestResults,
  key: SeriesKey,
  which: 'series' | 'drawdowns' = 'series',
): { time: string; value: number }[] {
  const values = results[which][key] ?? [];
  return results.days.map((day, i) => ({ time: day, value: values[i]! }));
}

export const FREQUENCIES = ['WEEKLY', 'MONTHLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<Frequency, string> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
};
export const FREQUENCY_HINTS: Record<Frequency, string> = {
  WEEKLY: 'On the first day, then on the last trading day of each week.',
  MONTHLY: 'On the first day, then on the last trading day of each month.',
};
export const frequencyLabel = (value: string) =>
  FREQUENCY_LABELS[value as Frequency] ?? value.toLowerCase();

type Format = 'percent' | 'ratio' | 'inr' | 'bars';

export const METRIC_ROWS: { key: keyof SeriesMetrics; label: string; format: Format }[] = [
  { key: 'total_return', label: 'Total return', format: 'percent' },
  { key: 'cagr', label: 'CAGR', format: 'percent' },
  { key: 'annualized_volatility', label: 'Volatility (annualised)', format: 'percent' },
  { key: 'sharpe_ratio', label: 'Sharpe ratio', format: 'ratio' },
  { key: 'sortino_ratio', label: 'Sortino ratio', format: 'ratio' },
  { key: 'calmar_ratio', label: 'Calmar ratio', format: 'ratio' },
  { key: 'max_drawdown', label: 'Maximum drawdown', format: 'percent' },
  { key: 'max_drawdown_duration_bars', label: 'Longest drawdown (days)', format: 'bars' },
  { key: 'final_value', label: 'Final value', format: 'inr' },
];

export const RELATIVE_ROWS: { key: keyof Relative; label: string; format: Format; hint: string }[] =
  [
    {
      key: 'alpha',
      label: 'Alpha (annualised)',
      format: 'percent',
      hint: 'Jensen alpha of the daily returns against Nifty 50.',
    },
    { key: 'beta', label: 'Beta', format: 'ratio', hint: 'Sensitivity to Nifty 50 daily returns.' },
    {
      key: 'correlation',
      label: 'Correlation',
      format: 'ratio',
      hint: 'Of the daily returns with Nifty 50.',
    },
    {
      key: 'tracking_error',
      label: 'Tracking error (annualised)',
      format: 'percent',
      hint: 'Volatility of the daily return difference.',
    },
    {
      key: 'information_ratio',
      label: 'Information ratio',
      format: 'ratio',
      hint: 'Annualised return difference / tracking error.',
    },
  ];

export function formatMetric(value: number | null | undefined, format: Format): string {
  if (value === null || value === undefined) return MISSING;
  if (format === 'percent') return formatPercent(value);
  if (format === 'inr') return formatINR(value);
  if (format === 'bars') return formatNumber(value, 0);
  return formatNumber(value, 2);
}

export const OBJECTIVE_LABELS = {
  sharpe_improvement: 'Sharpe ratio improvement',
  drawdown_reduction: 'Maximum drawdown reduction',
} as const;
export type ObjectiveKey = keyof typeof OBJECTIVE_LABELS;
export const OBJECTIVE_KEYS = Object.keys(OBJECTIVE_LABELS) as ObjectiveKey[];

/** The weights set on each rebalance day (strategy id -> share), with cash. */
export function weightRows(results: PortfolioBacktestResults) {
  return results.rebalances.map((entry) => ({
    day: entry.day,
    weights: Object.fromEntries(entry.strategies.map((s) => [s.strategy_id, s.weight])),
    cash: entry.cash_weight,
  }));
}

/** The strategies in the order they were chosen (the stored name map has no order). */
export const strategyOrder = (results: PortfolioBacktestResults) =>
  results.sleeves.map((s) => s.strategy_id);

/** What a binding limit's `affected` ids are called (strategy names where known). */
export const affectedNames = (ids: string[], names: Record<string, string>) =>
  ids.map((id) => names[id] ?? id);

// --- the form -------------------------------------------------------------------

export interface PortfolioDraft {
  name: string;
  strategyIds: string[];
  benchmarkId: string;
  start: string;
  end: string;
  frequency: Frequency;
  capital: string;
  /** Percent of the traded value. */
  brokeragePct: string;
  slippageBps: string;
  cashReservePct: string;
  maxStrategyPct: string;
  maxAssetPct: string;
  regimeFilter: boolean;
  regimeModelId: string;
  sixtyForty: boolean;
  /** Feature 5: keep only strategies with a passing validation of their current version. */
  requireValidated: boolean;
}

export type DraftErrors = Partial<Record<keyof PortfolioDraft | 'form', string>>;

/** "YYYY-MM-DD" ten years before `today` (same day of the month where it exists). */
export function yearsBefore(today: string, years: number): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y - years, m - 1, d));
  if (date.getUTCMonth() !== m - 1) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function initialDraft(today: string): PortfolioDraft {
  return {
    name: 'Core portfolio',
    strategyIds: [],
    benchmarkId: '',
    start: yearsBefore(today, 10),
    end: today,
    frequency: 'WEEKLY',
    capital: '1000000',
    brokeragePct: '0.03',
    slippageBps: '5',
    cashReservePct: '0',
    maxStrategyPct: '100',
    maxAssetPct: '100',
    regimeFilter: true,
    regimeModelId: '',
    sixtyForty: false,
    requireValidated: false,
  };
}

/** The form filled in from an earlier run (Edit and rerun). */
export function draftFrom(run: PortfolioBacktestDetail): PortfolioDraft {
  const pct = (fraction: number) => String(Number((fraction * 100).toPrecision(12)));
  return {
    name: run.name,
    strategyIds: [
      ...run.strategies.map((s) => s.strategy_id),
      ...run.excluded.map((s) => s.strategy_id),
    ],
    benchmarkId: run.benchmark_instrument_id ?? '',
    start: run.start_date,
    end: run.end_date,
    frequency: (FREQUENCIES as readonly string[]).includes(run.frequency)
      ? (run.frequency as Frequency)
      : 'WEEKLY',
    capital: String(run.capital),
    brokeragePct: pct(run.brokerage_rate),
    slippageBps: String(run.slippage_bps),
    cashReservePct: pct(run.limits.cash_reserve ?? 0),
    maxStrategyPct: pct(run.limits.max_strategy_weight ?? 1),
    maxAssetPct: pct(run.limits.max_asset_weight ?? 1),
    regimeFilter: run.regime_filter,
    regimeModelId: run.regime_model?.id ?? '',
    sixtyForty: run.sixty_forty,
    requireValidated: run.require_validated ?? false,
  };
}

const number = (text: string) => (text.trim() === '' ? NaN : Number(text));

/** Checks the form like the backend does (CreatePortfolioBacktestRequest) and builds the body. */
export function buildRequest(
  draft: PortfolioDraft,
  today: string,
): { request: PortfolioBacktestRequest | null; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Give the portfolio backtest a name.';
  else if (name.length > 100) errors.name = 'At most 100 characters.';
  if (draft.strategyIds.length === 0) errors.strategyIds = 'Choose at least one strategy.';
  else if (draft.strategyIds.length > 20) errors.strategyIds = 'Choose at most 20 strategies.';
  if (!draft.benchmarkId) errors.benchmarkId = 'Choose the Nifty 50 index.';
  if (!draft.start || !draft.end) errors.start = 'Choose both dates.';
  else if (draft.end <= draft.start) errors.start = 'The end date must be after the start date.';
  else if (draft.end > today) errors.start = 'The end date cannot be in the future.';

  const capital = number(draft.capital);
  if (!(capital > 0) || capital > 1e12) errors.capital = 'Enter an amount above 0.';
  const brokerage = number(draft.brokeragePct);
  if (!(brokerage >= 0 && brokerage <= 5)) errors.brokeragePct = 'Enter 0 to 5 (%).';
  const slippage = number(draft.slippageBps);
  if (!(slippage >= 0 && slippage <= 1000)) errors.slippageBps = 'Enter 0 to 1000 (bps).';
  const reserve = number(draft.cashReservePct);
  if (!(reserve >= 0 && reserve <= 90)) errors.cashReservePct = 'Enter 0 to 90 (%).';
  const maxStrategy = number(draft.maxStrategyPct);
  if (!(maxStrategy > 0 && maxStrategy <= 100))
    errors.maxStrategyPct = 'Enter more than 0, up to 100 (%).';
  const maxAsset = number(draft.maxAssetPct);
  if (!(maxAsset > 0 && maxAsset <= 100)) errors.maxAssetPct = 'Enter more than 0, up to 100 (%).';
  if (draft.regimeFilter && !draft.regimeModelId)
    errors.regimeModelId = 'Choose a regime model, or turn the regime filter off.';

  if (Object.keys(errors).length) return { request: null, errors };
  return {
    request: {
      name,
      strategy_ids: draft.strategyIds,
      benchmark_instrument_id: draft.benchmarkId,
      start_date: draft.start,
      end_date: draft.end,
      frequency: draft.frequency,
      capital,
      brokerage_rate: brokerage / 100,
      slippage_bps: slippage,
      limits: {
        cash_reserve: reserve / 100,
        max_strategy_weight: maxStrategy / 100,
        max_asset_weight: maxAsset / 100,
      },
      regime_filter: draft.regimeFilter,
      regime_model_id: draft.regimeFilter ? draft.regimeModelId : null,
      sixty_forty: draft.sixtyForty,
      require_validated: draft.requireValidated,
    },
    errors,
  };
}

/** The Nifty 50 index among the instruments: NIFTY50 by symbol, else any index named Nifty. */
export function pickNifty<T extends { id: string; symbol: string; instrument_type: string }>(
  instruments: T[],
): T | undefined {
  const indices = instruments.filter((i) => i.instrument_type === 'INDEX');
  return (
    indices.find((i) => i.symbol.toUpperCase() === 'NIFTY50') ??
    indices.find((i) => /NIFTY/i.test(i.symbol))
  );
}
