import type { components } from '@/api/schema';
import type { TradeMarker } from '@/features/instruments/PriceChart';
import { istDate } from '@/features/instruments/market-data';
import { formatINR, formatNumber, formatPercent, MISSING } from '@/lib/format';

type Schemas = components['schemas'];
export type ExecutionResults = Schemas['ExecutionResultsResponse'];
export type ResultsSummary = Schemas['ResultsSummary'];
export type TradeStats = Schemas['TradeStats'];
export type ResultsBasis = Schemas['ResultsBasis'];
export type RoundTrip = Schemas['RoundTrip'];
export type SimulatedOrder = Schemas['SimulatedOrder'];
export type SimulatedFill = Schemas['SimulatedFill'];
export type SimulatedPosition = Schemas['SimulatedPosition'];
export type ProvenanceEntry = Schemas['ProvenanceEntry'];
export type MonthlyReturn = Schemas['MonthlyReturn'];

/**
 * Everything on the results page is computed by the backend
 * (GET /executions/{id}/results). This file only labels, formats and arranges
 * those numbers for display; it never calculates a metric.
 */

export const RESULT_TABS = ['summary', 'charts', 'trades', 'records', 'configuration'] as const;
export type ResultTab = (typeof RESULT_TABS)[number];
export const TAB_LABELS: Record<ResultTab, string> = {
  summary: 'Summary',
  charts: 'Charts',
  trades: 'Trades',
  records: 'Records',
  configuration: 'Configuration',
};
export const isResultTab = (value: string | null): value is ResultTab =>
  (RESULT_TABS as readonly string[]).includes(value ?? '');

export type MetricFormat = 'money' | 'percent' | 'ratio' | 'count' | 'bars';

/** The displayed text of a value, exactly as the page shows it. */
export function metricText(format: MetricFormat, value: number | null | undefined): string {
  if (value === null || value === undefined) return MISSING;
  switch (format) {
    case 'money':
      return formatINR(value);
    case 'percent':
      return formatPercent(value);
    case 'ratio':
      return formatNumber(value, 2);
    case 'count':
      return formatNumber(value, 0);
    case 'bars':
      return `${formatNumber(value, 0)} ${value === 1 ? 'bar' : 'bars'}`;
  }
}

export interface MetricDef {
  /** The API field; also the key of its reason in `null_reasons`. */
  key: string;
  source: 'summary' | 'trade_stats';
  label: string;
  format: MetricFormat;
  /** Green when above zero, red below. */
  colored?: boolean;
  /** What the number is (shown in its tooltip and in "How these are calculated"). */
  definition: string;
  /** What it is measured over and how it is annualised, from the API's `basis`. */
  basis: (basis: ResultsBasis) => string;
}

const perBar = (b: ResultsBasis) => `Returns are measured ${b.return_frequency}.`;
const annualised = (b: ResultsBasis) =>
  `Annualised with ${b.periods_per_year} bars a year (multiplied by the square root of ${b.periods_per_year}).`;
const riskFree = (b: ResultsBasis) =>
  `Risk-free rate ${formatPercent(b.risk_free_rate_annual)} a year, compounded to ${formatNumber(
    b.risk_free_rate_per_period * 100,
    4,
  )}% per bar.`;
const calendar = (b: ResultsBasis) =>
  `Calendar time from the first to the last bar, in ${formatNumber(b.cagr_year_days, 4)}-day years.`;
const wholeRun = () => 'Over the whole run; not annualised.';
const netOfCharges = () => 'Over the whole run; not annualised. P&L is after charges.';

export const SUMMARY_METRICS: MetricDef[] = [
  {
    key: 'initial_capital',
    source: 'summary',
    label: 'Initial capital',
    format: 'money',
    definition: 'Cash the simulation started with.',
    basis: () => 'As set for the run.',
  },
  {
    key: 'final_capital',
    source: 'summary',
    label: 'Final capital',
    format: 'money',
    definition:
      'Portfolio value at the last bar: cash plus open positions at the close of that bar. It is the last point of the equity curve.',
    basis: () => 'At the last bar.',
  },
  {
    key: 'net_profit',
    source: 'summary',
    label: 'Net profit',
    format: 'money',
    colored: true,
    definition: 'Final capital minus initial capital, after all charges.',
    basis: wholeRun,
  },
  {
    key: 'total_return',
    source: 'summary',
    label: 'Total return',
    format: 'percent',
    colored: true,
    definition: 'Final capital divided by initial capital, minus 1.',
    basis: wholeRun,
  },
  {
    key: 'cagr',
    source: 'summary',
    label: 'CAGR',
    format: 'percent',
    colored: true,
    definition:
      'Compound annual growth rate: (final capital / initial capital) to the power 1 / years, minus 1.',
    basis: calendar,
  },
  {
    key: 'annualized_volatility',
    source: 'summary',
    label: 'Annualised volatility',
    format: 'percent',
    definition: 'Sample standard deviation of the bar-to-bar returns of the equity curve.',
    basis: (b) => `${perBar(b)} ${annualised(b)}`,
  },
  {
    key: 'max_drawdown',
    source: 'summary',
    label: 'Max drawdown',
    format: 'percent',
    definition:
      'Largest fall of the equity curve from a running peak to a later low, as a share of that peak.',
    basis: () => 'Measured on every bar of the run; not annualised.',
  },
  {
    key: 'max_drawdown_duration_bars',
    source: 'summary',
    label: 'Max drawdown duration',
    format: 'bars',
    definition:
      'Longest stretch of consecutive bars spent below an earlier peak (in any drawdown). Ends when the equity gets back to the peak.',
    basis: () => 'Counted in bars (trading days, for daily data), not calendar days.',
  },
  {
    key: 'downside_deviation',
    source: 'summary',
    label: 'Downside risk',
    format: 'percent',
    definition:
      'Downside deviation: root mean square of how far the return of each bar fell short of the risk-free rate (bars above it count as zero; every bar is in the average).',
    basis: (b) => `${perBar(b)} ${annualised(b)} ${riskFree(b)}`,
  },
  {
    key: 'sharpe_ratio',
    source: 'summary',
    label: 'Sharpe ratio',
    format: 'ratio',
    colored: true,
    definition:
      'Average excess return per bar (return minus the risk-free rate) divided by the standard deviation of excess returns.',
    basis: (b) => `${perBar(b)} ${annualised(b)} ${riskFree(b)}`,
  },
  {
    key: 'sortino_ratio',
    source: 'summary',
    label: 'Sortino ratio',
    format: 'ratio',
    colored: true,
    definition: 'Average excess return per bar divided by the downside deviation.',
    basis: (b) => `${perBar(b)} ${annualised(b)} ${riskFree(b)}`,
  },
  {
    key: 'calmar_ratio',
    source: 'summary',
    label: 'Calmar ratio',
    format: 'ratio',
    colored: true,
    definition: 'CAGR divided by the maximum drawdown.',
    basis: (b) => `CAGR: ${calendar(b)} Drawdown: over the whole run.`,
  },
];

export const TRADE_METRICS: MetricDef[] = [
  {
    key: 'round_trip_count',
    source: 'trade_stats',
    label: 'Closed trades',
    format: 'count',
    definition:
      'Trades from opening a position to being flat again, long or short. Turning a long into a short closes one trade and opens the next.',
    basis: wholeRun,
  },
  {
    key: 'open_position_count',
    source: 'trade_stats',
    label: 'Still open at the end',
    format: 'count',
    definition: 'Positions held at the last bar. They are valued at the close of that bar.',
    basis: () => 'At the last bar.',
  },
  {
    key: 'fill_count',
    source: 'trade_stats',
    label: 'Fills',
    format: 'count',
    definition: 'Simulated BUY and SELL fills (one per order).',
    basis: wholeRun,
  },
  {
    key: 'winning_trades',
    source: 'trade_stats',
    label: 'Winning trades',
    format: 'count',
    definition: 'Closed trades whose net P&L (after charges) is above zero.',
    basis: netOfCharges,
  },
  {
    key: 'losing_trades',
    source: 'trade_stats',
    label: 'Losing trades',
    format: 'count',
    definition: 'Closed trades whose net P&L (after charges) is below zero.',
    basis: netOfCharges,
  },
  {
    key: 'win_rate',
    source: 'trade_stats',
    label: 'Win rate',
    format: 'percent',
    definition: 'Winning trades divided by closed trades.',
    basis: netOfCharges,
  },
  {
    key: 'average_gain',
    source: 'trade_stats',
    label: 'Average gain',
    format: 'money',
    colored: true,
    definition: 'Average net P&L of the winning closed trades.',
    basis: netOfCharges,
  },
  {
    key: 'average_loss',
    source: 'trade_stats',
    label: 'Average loss',
    format: 'money',
    colored: true,
    definition: 'Average net P&L of the losing closed trades.',
    basis: netOfCharges,
  },
  {
    key: 'profit_factor',
    source: 'trade_stats',
    label: 'Profit factor',
    format: 'ratio',
    definition:
      'Total net P&L of winning trades divided by the total net loss of losing trades (as a positive number).',
    basis: netOfCharges,
  },
  {
    key: 'total_charges',
    source: 'trade_stats',
    label: 'Total charges',
    format: 'money',
    definition: 'Brokerage and other charges paid on all fills.',
    basis: wholeRun,
  },
  {
    key: 'total_brokerage',
    source: 'trade_stats',
    label: 'Of which brokerage',
    format: 'money',
    definition: 'The brokerage part of the total charges.',
    basis: wholeRun,
  },
];

/** The API value of a metric. */
export function metricValue(results: ExecutionResults, metric: MetricDef): number | null {
  const source = (metric.source === 'summary' ? results.summary : results.trade_stats) as unknown;
  const value = (source as Record<string, unknown>)[metric.key];
  return typeof value === 'number' ? value : null;
}

/** A run is still a valid result when the strategy never traded. */
export const madeNoTrades = (results: ExecutionResults) => results.trade_stats.fill_count === 0;

/* ---------------------------------------------------------------- charts */

export interface ChartPoint {
  /** Trading day (IST), "YYYY-MM-DD". */
  time: string;
  value: number;
}

/** Above this many points a series is thinned for drawing (the tables keep every row). */
export const MAX_CHART_POINTS = 5000;

/**
 * Thins a long series for drawing: the first and last point, then the lowest and
 * highest point of each bucket in time order, so peaks and troughs (and the
 * largest drawdown) stay exactly where they are.
 */
export function downsample<T extends { value: number }>(points: T[], max = MAX_CHART_POINTS): T[] {
  if (points.length <= max || max < 4) return points;
  const buckets = Math.floor((max - 2) / 2);
  const inner = points.length - 2;
  const out: T[] = [points[0]!];
  for (let b = 0; b < buckets; b += 1) {
    const from = 1 + Math.floor((b * inner) / buckets);
    const to = 1 + Math.floor(((b + 1) * inner) / buckets);
    if (from >= to) continue;
    let lo = from;
    let hi = from;
    for (let i = from; i < to; i += 1) {
      if (points[i]!.value < points[lo]!.value) lo = i;
      if (points[i]!.value > points[hi]!.value) hi = i;
    }
    if (lo === hi) out.push(points[lo]!);
    else out.push(points[Math.min(lo, hi)]!, points[Math.max(lo, hi)]!);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** API points to chart points by trading day; if two share a day, the later one is kept. */
export function toChartPoints<T>(
  rows: T[],
  timestamp: (row: T) => string,
  value: (row: T) => number,
): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const row of rows) {
    const point = { time: istDate(timestamp(row)), value: value(row) };
    if (out.length && out[out.length - 1]!.time === point.time) out[out.length - 1] = point;
    else out.push(point);
  }
  return out;
}

/** BUY and SELL arrows for one instrument's fills, with the quantity. */
export function tradeMarkers(fills: SimulatedFill[], instrumentId: string): TradeMarker[] {
  return fills
    .filter((f) => f.instrument_id === instrumentId)
    .map((f) => ({
      time: istDate(f.timestamp),
      side: f.side === 'SELL' ? ('SELL' as const) : ('BUY' as const),
      text: `${f.side} ${formatNumber(f.quantity, 0)}`,
    }))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/* ------------------------------------------------------- monthly returns */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = MONTHS;

/** "2025-01" -> "Jan 2025". */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${year}`;
}

export interface MonthlyYear {
  year: string;
  /** Twelve cells; `undefined` = the run did not cover that month, `null` = no value (see reason). */
  months: (number | null | undefined)[];
}

/** The API's month rows laid out as years x months (no numbers are added up). */
export function monthlyGrid(rows: MonthlyReturn[]): MonthlyYear[] {
  const years = new Map<string, MonthlyYear>();
  for (const row of rows) {
    const [year = '', m = '1'] = row.month.split('-');
    let entry = years.get(year);
    if (!entry) {
      entry = { year, months: Array.from({ length: 12 }, () => undefined) };
      years.set(year, entry);
    }
    entry.months[Number(m) - 1] = row.value;
  }
  return [...years.values()].sort((a, b) => a.year.localeCompare(b.year));
}

/* ---------------------------------------------------------- configuration */

/** "v2" or the reason it was not recorded. */
export function versionText(version: number | null | undefined): string {
  return version === null || version === undefined ? MISSING : `v${version}`;
}

/** Shown when the strategy was edited after the run. */
export function versionChanged(results: ExecutionResults): string | null {
  const { strategy_version: atRun, current_strategy_version: now } = results.configuration;
  if (atRun === null || atRun === undefined || now === null || now === undefined) return null;
  if (atRun === now) return null;
  return `The strategy has changed since this run (it is now v${now}). These results are for v${atRun}.`;
}
