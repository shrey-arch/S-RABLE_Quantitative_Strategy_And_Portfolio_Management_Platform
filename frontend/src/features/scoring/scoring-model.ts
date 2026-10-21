import type { components } from '@/api/schema';
import { formatNumber, formatPercent, MISSING } from '@/lib/format';

type Schemas = components['schemas'];
export type ScoringDefinitions = Schemas['ScoringDefinitions'];
export type ScoringResult = Schemas['ScoringResult'];
export type ScoredStrategy = Schemas['ScoredStrategy'];
export type FactorScore = Schemas['FactorScore'];
export type Compatibility = Schemas['Compatibility'];
export type RegimeSnapshot = Schemas['RegimeSnapshot'];
export type RegimeFit = Schemas['RegimeFit'];
export type Weights = Record<string, Record<string, number>>;

/**
 * The scoring API as the backend serves it (app/api/scoring). Scores, factor
 * values, weights and compatibility all come from the API; this file only names,
 * orders and formats them, and checks typed weights before they are sent.
 */

export const COMPATIBILITY_LABELS: Record<Compatibility['status'], string> = {
  COMPATIBLE: 'Compatible',
  NOT_COMPATIBLE: 'Not compatible',
  UNKNOWN: 'Unknown',
};

export const DIRECTION_LABELS: Record<FactorScore['direction'], string> = {
  higher_is_better: 'Higher is better',
  lower_is_better: 'Lower is better',
  magnitude: 'Size, not sign',
  suitability: 'Suitability',
};

/** Tabs of the page; the selected one lives in the address (?tab=). */
export const SCORING_TABS = ['ranking', 'compare', 'weights'] as const;
export type ScoringTab = (typeof SCORING_TABS)[number];
export const SCORING_TAB_LABELS: Record<ScoringTab, string> = {
  ranking: 'Ranking',
  compare: 'Compare',
  weights: 'Weights and definitions',
};
export const isScoringTab = (value: string | null): value is ScoringTab =>
  (SCORING_TABS as readonly string[]).includes(value ?? '');

/** A score or suitability in 0..1. */
export const scoreText = (value: number | null | undefined) =>
  value === null || value === undefined ? MISSING : formatNumber(value, 3);

/** Raw values in their own units: percentages for returns and volatilities. */
const PERCENT_RAW = new Set(['relative_momentum', 'volatility_suitability']);
export function rawText(factor: string, value: number): string {
  return PERCENT_RAW.has(factor) ? formatPercent(value) : formatNumber(value, 3);
}

// --- weights -----------------------------------------------------------------------

/** Typed weights, per strategy key and factor, as text. */
export type WeightsDraft = Record<string, Record<string, string>>;

export function draftFromWeights(weights: Weights): WeightsDraft {
  return Object.fromEntries(
    Object.entries(weights).map(([key, factors]) => [
      key,
      Object.fromEntries(Object.entries(factors).map(([f, w]) => [f, String(w)])),
    ]),
  );
}

/**
 * The weights to send: only the strategies whose weights differ from the
 * defaults. The backend checks them again (and is the one that decides).
 */
export function buildWeights(
  draft: WeightsDraft,
  defaults: Weights,
): { ok: true; weights: Weights | null } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const changed: Weights = {};
  for (const [key, factors] of Object.entries(defaults)) {
    const values: Record<string, number> = {};
    for (const factor of Object.keys(factors)) {
      const text = (draft[key]?.[factor] ?? '').trim();
      if (!/^\d+(\.\d+)?$/.test(text)) {
        errors[`${key}.${factor}`] = 'Enter a number of 0 or more.';
        continue;
      }
      values[factor] = Number(text);
    }
    if (Object.keys(values).length === Object.keys(factors).length) {
      if (Object.values(values).every((v) => v === 0))
        errors[key] = 'At least one weight must be above 0.';
      else if (Object.entries(values).some(([f, v]) => v !== factors[f])) changed[key] = values;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, weights: Object.keys(changed).length ? changed : null };
}

// --- comparison --------------------------------------------------------------------

export const MAX_COMPARE = 3;

/** "?compare=a,b,c" -> ids (at most three, no repeats). */
export function compareIds(param: string | null): string[] {
  return [...new Set((param ?? '').split(',').filter(Boolean))].slice(0, MAX_COMPARE);
}

/** Backtest metrics shown side by side (keys of the results page's metrics). */
export const COMPARE_METRICS = [
  'total_return',
  'cagr',
  'sharpe_ratio',
  'max_drawdown',
  'annualized_volatility',
  'round_trip_count',
  'win_rate',
] as const;
