import type { components } from '@/api/schema';
import type { Execution } from '@/features/backtests/backtest-model';
import type { RegistryEntry } from '@/features/strategies/core-strategies';
import { formatINR, formatNumber, formatPercent, MISSING } from '@/lib/format';
import type { Theme } from '@/lib/theme';
import { istDate } from '@/features/instruments/market-data';

type Schemas = components['schemas'];
export type ValidationReport = Schemas['ValidationReport'];
export type ValidationSummary = Schemas['ValidationSummary'];
export type ValidationRequest = Schemas['CreateValidationRequest'];
export type Check = Schemas['Check'];
export type Verdict = Schemas['Verdict'];
export type Stages = Schemas['Stages'];
export type StageStatus = Schemas['PaperTradingStage']['status'];
export type PaperStageInfo = Schemas['PaperStageInfo'];
export type WalkForwardWindow = Schemas['WalkForwardWindow'];
export type RegimeRow = Schemas['RegimeRow'];
export type RegimeModelRef = Schemas['RegimeModelRef'];
export type RegimeSource = 'rule_based' | 'model';
export type RegimePeriod = Schemas['RegimePeriod'];
export type Histogram = Schemas['Histogram'];

/**
 * The validation pipeline as the backend runs it (app/validation/pipeline.py).
 * Every pass/fail, threshold and number on these pages comes from the API; this
 * file only names, orders and formats them.
 */

export const STAGE_ORDER = [
  'backtest',
  'walk_forward',
  'regime_stress',
  'monte_carlo',
  'paper_trading',
] as const;
export type StageKey = (typeof STAGE_ORDER)[number];

export const STAGE_LABELS: Record<StageKey, string> = {
  backtest: 'Backtest',
  walk_forward: 'Walk-forward',
  regime_stress: 'Regime stress',
  monte_carlo: 'Monte Carlo',
  paper_trading: 'Paper trading',
};

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  NOT_RUN: 'Not run',
  RUNNING: 'Running',
  PASS: 'Pass',
  FAIL: 'Fail',
  ERROR: 'Error',
  PLANNED: 'Planned',
};

export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export const STAGE_STATUS_TONES: Record<StageStatus, Tone> = {
  NOT_RUN: 'neutral',
  RUNNING: 'info',
  PASS: 'success',
  FAIL: 'danger',
  ERROR: 'warning',
  PLANNED: 'neutral',
};

export const VERDICT_LABELS: Record<Verdict['status'], string> = {
  PENDING: 'In progress',
  PASS: 'Passed',
  FAIL: 'Failed',
  INCOMPLETE: 'Incomplete',
  VALIDATED: 'Validated',
};

export const VERDICT_TONES: Record<Verdict['status'], Tone> = {
  PENDING: 'info',
  PASS: 'success',
  FAIL: 'danger',
  INCOMPLETE: 'warning',
  VALIDATED: 'success',
};

/** Stages 1 to 4 passed: stage 5 can start (the backend checks this again). */
export const priorStagesPassed = (report: Pick<ValidationReport, 'stages'>) =>
  STAGE_ORDER.filter((k) => k !== 'paper_trading').every((k) => report.stages[k].status === 'PASS');

/** Tabs of the report page; the selected one lives in the address (?tab=). */
export const REPORT_TABS = [...STAGE_ORDER, 'configuration'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export const REPORT_TAB_LABELS: Record<ReportTab, string> = {
  ...STAGE_LABELS,
  configuration: 'Configuration',
};
export const isReportTab = (value: string | null): value is ReportTab =>
  (REPORT_TABS as readonly string[]).includes(value ?? '');

const OPERATOR_TEXT: Record<Check['operator'], string> = {
  '>': '>',
  '>=': '\u2265',
  '<': '<',
  '<=': '\u2264',
};

/** A check's value or threshold, formatted for its unit. */
export function unitText(unit: Check['unit'], value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  switch (unit) {
    case 'fraction':
      return formatPercent(value);
    case 'count':
      return formatNumber(value, 0);
    case 'p_value':
      return formatNumber(value, 4);
    default:
      return formatNumber(value, 2);
  }
}

/** "Sharpe ratio > 0.50": the backend's rule in words. */
export function ruleText(check: Pick<Check, 'label' | 'operator' | 'threshold' | 'unit'>): string {
  return `${check.label} ${OPERATOR_TEXT[check.operator]} ${unitText(check.unit, check.threshold)}`;
}

export const percentOrMissing = (value: number | null | undefined) =>
  value === null || value === undefined ? MISSING : formatPercent(value);
export const ratioOrMissing = (value: number | null | undefined) =>
  value === null || value === undefined ? MISSING : formatNumber(value, 2);
export const moneyOrMissing = (value: number | null | undefined) =>
  value === null || value === undefined ? MISSING : formatINR(value);

/** Regime keys in the order the backend lists them, with a colour index for charts. */
export const REGIME_ORDER = [
  'bull_low_volatility',
  'bull_high_volatility',
  'bear_low_volatility',
  'bear_high_volatility',
] as const;

/** Regime colours (the table names every regime; colour only supports it). */
export const REGIME_COLORS: Record<Theme, Record<string, string>> = {
  light: {
    bull_low_volatility: '#16a34a',
    bull_high_volatility: '#65a30d',
    bear_low_volatility: '#d97706',
    bear_high_volatility: '#dc2626',
  },
  dark: {
    bull_low_volatility: '#4ade80',
    bull_high_volatility: '#a3e635',
    bear_low_volatility: '#fbbf24',
    bear_high_volatility: '#f87171',
  },
};

// --- the launcher ------------------------------------------------------------------

export interface ValidationDraft {
  trainBars: string;
  validationBars: string;
  testBars: string;
  /** Empty = the same as the test span. */
  stepBars: string;
  /** Candidate values per parameter, as typed ("10, 20, 30"). Empty = not searched. */
  grid: Record<string, string>;
  /** Feature 3: rule-based regimes, or the market regime model's. */
  regimeSource: RegimeSource;
  /** The regime model's id ('' until the active model is known). */
  regimeModelId: string;
  trendWindow: string;
  volatilityWindow: string;
  simulations: string;
  seed: string;
}

/** The backend's defaults (CreateValidationRequest). */
export function emptyValidationDraft(): ValidationDraft {
  return {
    trainBars: '252',
    validationBars: '63',
    testBars: '63',
    stepBars: '',
    grid: {},
    regimeSource: 'rule_based',
    regimeModelId: '',
    trendWindow: '200',
    volatilityWindow: '20',
    simulations: '1000',
    seed: '42',
  };
}

/** The backend's limits (CreateValidationRequest), so mistakes show before sending. */
export const VALIDATION_LIMITS = {
  trainBars: [1, 5000],
  validationBars: [5, 5000],
  testBars: [5, 5000],
  stepBars: [1, 5000],
  trendWindow: [20, 500],
  volatilityWindow: [5, 250],
  simulations: [100, 10000],
  seed: [0, 2 ** 31 - 1],
  gridValues: 10,
} as const;

export type ValidationSettings = Pick<
  ValidationRequest,
  'walk_forward' | 'regimes' | 'monte_carlo'
>;

const WHOLE = /^\d+$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

function whole(raw: string, [min, max]: readonly [number, number]): number | string {
  const value = raw.trim();
  if (!WHOLE.test(value)) return 'Enter a whole number.';
  const n = Number(value);
  if (n < min || n > max)
    return `Enter ${min.toLocaleString('en-IN')} to ${max.toLocaleString('en-IN')}.`;
  return n;
}

/** "10, 20, 30" -> [10, 20, 30]; whole numbers for whole-number parameters. */
export function parseGridValues(raw: string, integer: boolean): number[] | string {
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length > VALIDATION_LIMITS.gridValues)
    return `Give at most ${VALIDATION_LIMITS.gridValues} values.`;
  const values: number[] = [];
  for (const part of parts) {
    if (integer ? !/^-?\d+$/.test(part) : !NUMBER.test(part))
      return integer ? `"${part}" is not a whole number.` : `"${part}" is not a number.`;
    values.push(Number(part));
  }
  if (new Set(values).size !== values.length) return 'Each value can be given only once.';
  return values;
}

/** Combinations a grid makes (each is tried on every validation span). */
export function gridCombinations(grid: Record<string, number[]>): number {
  const lists = Object.values(grid).filter((v) => v.length > 0);
  return lists.length === 0 ? 1 : lists.reduce((n, values) => n * values.length, 1);
}

export function buildValidationSettings(
  draft: ValidationDraft,
  entry: RegistryEntry | undefined,
  rules: boolean,
): { ok: true; settings: ValidationSettings } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const read = (key: keyof typeof VALIDATION_LIMITS & keyof ValidationDraft) => {
    const result = whole(draft[key] as string, VALIDATION_LIMITS[key] as [number, number]);
    if (typeof result === 'string') errors[`v.${key}`] = result;
    return typeof result === 'number' ? result : 0;
  };
  const trainBars = read('trainBars');
  const validationBars = read('validationBars');
  const testBars = read('testBars');
  const stepBars = draft.stepBars.trim() ? read('stepBars') : null;
  const trendWindow = read('trendWindow');
  const volatilityWindow = read('volatilityWindow');
  const simulations = read('simulations');
  const seed = read('seed');

  const grid: Record<string, number[]> = {};
  if (!rules && entry) {
    for (const param of entry.parameters) {
      const raw = draft.grid[param.name] ?? '';
      if (!raw.trim()) continue;
      const parsed = parseGridValues(raw, param.type === 'int');
      if (typeof parsed === 'string') errors[`v.grid.${param.name}`] = parsed;
      else if (parsed.length) grid[param.name] = parsed;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      walk_forward: {
        train_bars: trainBars,
        validation_bars: validationBars,
        test_bars: testBars,
        step_bars: stepBars,
        parameter_grid: grid,
      },
      regimes:
        draft.regimeSource === 'model'
          ? {
              source: 'model',
              // Empty: the backend uses the active model and records which one.
              model_id: draft.regimeModelId || null,
              trend_window: trendWindow,
              volatility_window: volatilityWindow,
            }
          : {
              source: 'rule_based',
              trend_window: trendWindow,
              volatility_window: volatilityWindow,
            },
      monte_carlo: { simulations, seed },
    },
  };
}

/**
 * How many walk-forward windows fit in `bars` daily bars (shown while filling in
 * the form; the backend decides whether that is enough).
 */
export function windowCount(
  bars: number,
  sizes: { train: number; validation: number; test: number; step: number },
): number {
  const span = sizes.train + sizes.validation + sizes.test;
  if (bars < span || sizes.step <= 0) return 0;
  return Math.floor((bars - span) / sizes.step) + 1;
}

/** The settings of an earlier validation, for "Edit and rerun". */
export function validationDraftFromExecution(execution: Execution): ValidationDraft {
  const rs = (execution.run_settings ?? {}) as Record<string, unknown>;
  const wf = (rs.walk_forward ?? {}) as Record<string, unknown>;
  const regimes = (rs.regimes ?? {}) as Record<string, unknown>;
  const mc = (rs.monte_carlo ?? {}) as Record<string, unknown>;
  const base = emptyValidationDraft();
  const text = (value: unknown, fallback: string) =>
    value === null || value === undefined ? fallback : String(value);
  const grid = (wf.parameter_grid ?? {}) as Record<string, unknown[]>;
  return {
    trainBars: text(wf.train_bars, base.trainBars),
    validationBars: text(wf.validation_bars, base.validationBars),
    testBars: text(wf.test_bars, base.testBars),
    stepBars:
      wf.step_bars !== undefined && wf.step_bars !== wf.test_bars ? text(wf.step_bars, '') : '',
    grid: Object.fromEntries(Object.entries(grid).map(([k, v]) => [k, v.join(', ')])),
    regimeSource: regimes.source === 'model' ? 'model' : 'rule_based',
    regimeModelId: regimes.source === 'model' ? text(regimes.model_id, '') : '',
    trendWindow: text(regimes.trend_window, base.trendWindow),
    volatilityWindow: text(regimes.volatility_window, base.volatilityWindow),
    simulations: text(mc.simulations, base.simulations),
    seed: text(mc.seed, base.seed),
  };
}

/**
 * Whether the run's dates overlap the days a regime model was trained on (its
 * training start to the last day its training labels look at). Days in the
 * overlap are classified in-sample; the backend counts them in the report.
 */
export function trainingOverlap(
  range: { start: string; end: string },
  model: { start: string | null | undefined; end: string | null | undefined },
): 'overlap' | 'none' | 'unknown' {
  if (!model.start || !model.end) return 'unknown';
  const first = istDate(model.start);
  const last = istDate(model.end);
  if (!range.start || !range.end) return 'unknown';
  return range.start <= last && range.end >= first ? 'overlap' : 'none';
}

/** The last day a model saw in training: a supervised model's labels look ahead. */
export const inSampleEnd = (card: {
  training_end: string;
  dataset: { splits: { name: string; label_window_end?: string | null }[] };
}) => card.dataset.splits.find((s) => s.name === 'train')?.label_window_end ?? card.training_end;

// --- charts ------------------------------------------------------------------------

export interface Bar {
  label: string;
  value: number;
}

/** Histogram bins as "from to to" labels with their counts. */
export function histogramBars(
  histogram: Histogram,
  label: (from: number, to: number) => string,
): Bar[] {
  return histogram.counts.map((count, i) => ({
    label: label(histogram.edges[i]!, histogram.edges[i + 1]!),
    value: count,
  }));
}
