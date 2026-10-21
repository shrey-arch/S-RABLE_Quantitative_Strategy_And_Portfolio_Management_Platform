import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import type { components } from '@/api/schema';

export type IndicatorInfo = components['schemas']['IndicatorInfo'];
export type IndicatorParameter = components['schemas']['IndicatorParameterInfo'];

/** What a strategy configuration stores for one indicator. */
export interface IndicatorConfigValue {
  name: string;
  type: string;
  parameters: Record<string, number>;
}

/** GET /indicators: the indicator types a strategy configuration may use. */
export function useIndicators() {
  return useQuery({
    queryKey: queryKeys.indicators.list(),
    queryFn: () => unwrap(api.GET('/indicators')),
    staleTime: Infinity, // fixed by the backend code; changes only with a new backend
  });
}

/**
 * POST /indicators/{key}/validate: the same check that saving a strategy runs.
 * Resolves with the parameters as the backend will store them (defaults filled in);
 * a 422 rejects with the backend's reason.
 */
export function validateIndicator(key: string, parameters: Record<string, number>) {
  return unwrap(
    api.POST('/indicators/{key}/validate', {
      params: { path: { key } },
      body: { parameters },
    }),
  );
}

const CORE_NAMES: Record<string, string> = {
  momentum: 'Momentum',
  mean_reversion: 'Mean Reversion',
  volatility_arbitrage: 'Volatility Arbitrage',
  statistical_arbitrage: 'Statistical Arbitrage',
  tactical_asset_allocation: 'Tactical Asset Allocation',
};
export const coreStrategyName = (key: string) => CORE_NAMES[key] ?? key;

/** "greater than 0" / "at least 0" / "no limit", from the backend's limits. */
export function limitText(p: IndicatorParameter): string {
  if (p.minimum === null || p.minimum === undefined) return 'no limit';
  return p.exclusive_minimum ? `greater than ${p.minimum}` : `at least ${p.minimum}`;
}

export const panelLabel = (panel: IndicatorInfo['panel']) =>
  panel === 'price' ? 'On the price chart' : 'In its own panel';
