import type { components } from '@/api/schema';
import type { Theme } from '@/lib/theme';

type Schemas = components['schemas'];
export type RegimeModelSummary = Schemas['RegimeModelSummary'];
export type RegimeModelDetail = Schemas['RegimeModelDetail'];
export type ModelCard = Schemas['ModelCard'];
export type RegimeLabel = Schemas['RegimeLabel'];
export type CurrentRegime = Schemas['CurrentRegime'];
export type RegimeHistory = Schemas['RegimeHistory'];
export type RegimePeriod = Schemas['RegimeHistoryPeriod'];
export type RegimeTransition = Schemas['RegimeTransition'];
export type HistoryPoint = Schemas['HistoryPoint'];
export type TrainRequest = Schemas['TrainRegimeModelRequest'];
export type ModelKind = TrainRequest['model_kind'];
export type SupervisedCard = Schemas['SupervisedCard'];
export type DimensionEvaluation = Schemas['DimensionEvaluation'];
export type DimensionReading = Schemas['DimensionReading'];
export type DimensionPeriods = Schemas['DimensionPeriods'];

/**
 * The market-regime model as the backend serves it (app/api/regime). Every
 * label, confidence and date on these pages comes from the API; this file only
 * names, orders and formats them.
 */

export const MODEL_STATUS_LABELS: Record<RegimeModelSummary['status'], string> = {
  TRAINING: 'Training',
  READY: 'Ready',
  FAILED: 'Failed',
};

/** Tabs of the page; the selected one lives in the address (?tab=). */
export const REGIME_TABS = ['overview', 'model', 'training'] as const;
export type RegimeTab = (typeof REGIME_TABS)[number];
export const REGIME_TAB_LABELS: Record<RegimeTab, string> = {
  overview: 'Current and history',
  model: 'Model card',
  training: 'Training',
};
export const isRegimeTab = (value: string | null): value is RegimeTab =>
  (REGIME_TABS as readonly string[]).includes(value ?? '');

/**
 * Band colours by code (R1 = calmest ... R6 = most volatile). Colour only
 * supports the text: every band, legend entry and table row also shows the code
 * and the name.
 */
export const CODE_COLORS: Record<Theme, string[]> = {
  light: ['#16a34a', '#0891b2', '#7c3aed', '#d97706', '#dc2626', '#db2777'],
  dark: ['#4ade80', '#22d3ee', '#a78bfa', '#fbbf24', '#f87171', '#f472b6'],
};
export const WARM_UP_COLOR: Record<Theme, string> = { light: '#9ca3af', dark: '#6b7280' };

/** A supervised model's combined code: HV-UP-OFF (volatility, trend, risk). */
const COMBINED = /^(HV|LV)-(UP|SW|DN)-(ON|OFF)$/;
const TREND_INDEX: Record<string, number> = { UP: 0, SW: 1, DN: 4 };

export function codeColor(theme: Theme, code: string | null | undefined): string {
  const combined = code ? COMBINED.exec(code) : null;
  // Combined regimes are coloured by their trend; the code text carries the rest.
  const index = combined
    ? TREND_INDEX[combined[2]!]!
    : code && /^R\d+$/.test(code)
      ? Number(code.slice(1)) - 1
      : -1;
  return CODE_COLORS[theme][index] ?? WARM_UP_COLOR[theme];
}

// --- model kinds and dimensions (Feature 2) -------------------------------------------

export const MODEL_KINDS = ['AUTO', 'RF', 'XGB', 'GMM'] as const satisfies readonly ModelKind[];

export const KIND_LABELS: Record<ModelKind, string> = {
  AUTO: 'Random Forest or XGBoost (the better on validation)',
  RF: 'Random Forest',
  XGB: 'XGBoost',
  GMM: 'Gaussian mixture (unsupervised clusters)',
};

export const KIND_SHORT: Record<ModelKind, string> = {
  AUTO: 'RF or XGBoost',
  RF: 'Random Forest',
  XGB: 'XGBoost',
  GMM: 'Gaussian mixture',
};

export const KIND_HELP: Record<ModelKind, string> = {
  AUTO: 'Supervised. Each dimension trains both and keeps the one with the better balanced accuracy on the validation split.',
  RF: 'Supervised. One Random Forest per dimension, with balanced class weights.',
  XGB: 'Supervised. One XGBoost model per dimension, with balanced sample weights.',
  GMM: 'Unsupervised (Phase 12). Groups recent behaviour into clusters; it has no accuracy figure.',
};

export const isSupervisedKind = (kind: ModelKind | undefined | null) =>
  Boolean(kind) && kind !== 'GMM';

export const DIMENSION_KEYS = ['volatility', 'trend', 'risk'] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

/**
 * What each dimension means before a model is trained (the backend's rules in
 * app/ml/supervised.py). A trained model's card shows its own rule text and
 * thresholds from the API.
 */
export function dimensionMeanings(horizon: number): { name: string; text: string }[] {
  return [
    {
      name: 'Volatility',
      text: `High or low: is the realised volatility of the next ${horizon} days above the median of the training days?`,
    },
    {
      name: 'Trend',
      text: `Uptrend, sideways or downtrend: is the index's return over the next ${horizon} days above +2%, below -2%, or in between?`,
    },
    {
      name: 'Risk sentiment',
      text: `Risk-off when, within the next ${horizon} days, the index falls more than 5% below today's close, or (with India VIX) VIX's average is above its 1-year median; risk-on otherwise.`,
    },
  ];
}

/**
 * Class colours of the band rows: calm, rising and risk-on lean green; volatile,
 * falling and risk-off lean red; sideways is blue. Every band and legend entry also
 * shows the class name.
 */
export function classColor(theme: Theme, label: string | null | undefined): string {
  const [green, cyan, , amber, red] = CODE_COLORS[theme];
  switch (label) {
    case 'Low volatility':
    case 'Uptrend':
    case 'Risk-on':
      return green!;
    case 'Sideways':
      return cyan!;
    case 'High volatility':
      return amber!;
    case 'Downtrend':
    case 'Risk-off':
      return red!;
    default:
      return WARM_UP_COLOR[theme];
  }
}

/** The classification label: supervised models classify the next days. */
export const classificationText = (horizon?: number | null) =>
  horizon
    ? `Model classification of the next ${horizon} days, not a guarantee`
    : 'Model classification, not a forecast';

/** "Model 3 (gmm-regime-v1)" */
export const modelName = (m: Pick<RegimeModelSummary, 'number' | 'model_version'>) =>
  `Model ${m.number} (${m.model_version})`;

// --- training ----------------------------------------------------------------------

export interface TrainDraft {
  kind: ModelKind;
  instrumentId: string;
  /** Supervised: the label horizon in trading days. */
  horizon: string;
  /** Supervised: India VIX (optional). */
  vixId: string;
  start: string;
  end: string;
  volatilityWindow: string;
  trendWindow: string;
  /** Cluster counts to try. */
  components: number[];
  seed: string;
}

/** The backend's defaults (TrainRegimeModelRequest). */
export function emptyTrainDraft(instrumentId = ''): TrainDraft {
  return {
    kind: 'AUTO',
    instrumentId,
    horizon: '20',
    vixId: '',
    start: '',
    end: '',
    volatilityWindow: '20',
    trendWindow: '20',
    components: [2, 3, 4],
    seed: '42',
  };
}

/** The backend's limits, so mistakes show before sending. */
export const TRAIN_LIMITS = {
  window: [5, 120],
  components: [2, 3, 4, 5, 6],
  seed: [0, 2 ** 31 - 1],
  minCompleteDays: 100,
  horizon: [5, 60],
  /** Supervised: labelled days needed, and the features' warm-up. */
  minLabelledDays: 500,
  warmUpDays: 252,
} as const;

function whole(raw: string, min: number, max: number): number | string {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return 'Enter a whole number.';
  const n = Number(value);
  if (n < min || n > max)
    return `Enter ${min.toLocaleString('en-IN')} to ${max.toLocaleString('en-IN')}.`;
  return n;
}

export function buildTrainRequest(
  draft: TrainDraft,
): { ok: true; request: TrainRequest } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!draft.instrumentId) errors.instrumentId = 'Choose the reference instrument.';
  if (draft.start && draft.end && draft.end < draft.start)
    errors.range = 'The end date is before the start date.';
  if (isSupervisedKind(draft.kind)) {
    const horizon = whole(draft.horizon, TRAIN_LIMITS.horizon[0], TRAIN_LIMITS.horizon[1]);
    const seed = whole(draft.seed, TRAIN_LIMITS.seed[0], TRAIN_LIMITS.seed[1]);
    if (typeof horizon === 'string') errors.horizon = horizon;
    if (typeof seed === 'string') errors.seed = seed;
    if (draft.vixId && draft.vixId === draft.instrumentId)
      errors.vixId = 'India VIX must be a different instrument from the reference.';
    if (Object.keys(errors).length) return { ok: false, errors };
    return {
      ok: true,
      request: {
        model_kind: draft.kind,
        instrument_id: draft.instrumentId,
        start_date: draft.start || null,
        end_date: draft.end || null,
        horizon_days: horizon as number,
        vix_instrument_id: draft.vixId || null,
        random_state: seed as number,
        // Gaussian-mixture settings: the backend's defaults, not used by this kind.
        volatility_window: 20,
        trend_window: 20,
      },
    };
  }
  const [low, high] = TRAIN_LIMITS.window;
  const volatility = whole(draft.volatilityWindow, low, high);
  const trend = whole(draft.trendWindow, low, high);
  const seed = whole(draft.seed, TRAIN_LIMITS.seed[0], TRAIN_LIMITS.seed[1]);
  if (typeof volatility === 'string') errors.volatilityWindow = volatility;
  if (typeof trend === 'string') errors.trendWindow = trend;
  if (typeof seed === 'string') errors.seed = seed;
  if (draft.components.length === 0) errors.components = 'Choose at least one cluster count.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    request: {
      model_kind: 'GMM',
      instrument_id: draft.instrumentId,
      start_date: draft.start || null,
      end_date: draft.end || null,
      volatility_window: volatility as number,
      trend_window: trend as number,
      candidate_components: [...draft.components].sort((a, b) => a - b),
      random_state: seed as number,
      // Supervised setting: the backend's default, not used by this kind.
      horizon_days: 20,
    },
  };
}

/**
 * Days left with complete features: the first `window` bars are warm-up. A
 * supervised model also loses the last `horizon` days (their next days are not
 * known yet).
 */
export function completeDays(
  bars: number,
  draft: Pick<TrainDraft, 'volatilityWindow' | 'trendWindow' | 'kind' | 'horizon'>,
) {
  if (isSupervisedKind(draft.kind)) {
    const horizon = /^\d+$/.test(draft.horizon.trim()) ? Number(draft.horizon) : 0;
    return Math.max(0, bars - TRAIN_LIMITS.warmUpDays - horizon);
  }
  const windows = [draft.volatilityWindow, draft.trendWindow].map((v) =>
    /^\d+$/.test(v.trim()) ? Number(v) : 0,
  );
  return Math.max(0, bars - Math.max(...windows));
}

// --- history chart -----------------------------------------------------------------

export interface Band {
  period: RegimePeriod;
  /** Index of the first and last point of the period. */
  from: number;
  to: number;
}

/** Each period's place among the points (periods are consecutive runs of points). */
export function bands(history: Pick<RegimeHistory, 'points' | 'periods'>): Band[] {
  const index = new Map(history.points.map((p, i) => [p.timestamp, i]));
  return history.periods.map((period) => ({
    period,
    from: index.get(period.start) ?? 0,
    to: index.get(period.end) ?? 0,
  }));
}

/** Each dimension's band periods placed among the points. */
export function dimensionBands(
  history: Pick<RegimeHistory, 'points'>,
  periods: DimensionPeriods['periods'],
): { label: string | null; from: number; to: number; bars: number; start: string; end: string }[] {
  const index = new Map(history.points.map((p, i) => [p.timestamp, i]));
  return periods.map((p) => ({
    label: p.label,
    from: index.get(p.start) ?? 0,
    to: index.get(p.end) ?? 0,
    bars: p.bars,
    start: p.start,
    end: p.end,
  }));
}
