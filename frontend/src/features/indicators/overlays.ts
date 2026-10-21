import { useQueries } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import type { components } from '@/api/schema';
import type { DateRange } from '@/features/instruments/market-data';
import { istDate } from '@/features/instruments/market-data';
import type { IndicatorInfo } from './queries';

export type IndicatorSeries = components['schemas']['IndicatorSeries'];

/** One indicator drawn on a chart: its type and complete parameters. */
export interface OverlaySpec {
  key: string;
  parameters: Record<string, number>;
}

export const MAX_OVERLAYS = 4;

/** "SMA(20)", "MACD(12, 26, 9)". */
export const overlayLabel = (o: OverlaySpec) =>
  `${o.key}(${Object.values(o.parameters).join(', ')})`;

/** Kept in the address as ?ind=SMA:window=20&ind=MACD:fast_period=12,slow_period=26,... */
export const encodeOverlay = (o: OverlaySpec) =>
  `${o.key}:${Object.entries(o.parameters)
    .map(([k, v]) => `${k}=${v}`)
    .join(',')}`;

export function decodeOverlay(text: string, catalogue: IndicatorInfo[]): OverlaySpec | null {
  const [key = '', rest = ''] = text.split(':');
  const spec = catalogue.find((i) => i.key === key);
  if (!spec) return null;
  const given = Object.fromEntries(
    rest
      .split(',')
      .filter(Boolean)
      .map((pair) => pair.split('=') as [string, string]),
  );
  const parameters: Record<string, number> = {};
  for (const p of spec.parameters) {
    const value = Number(given[p.name] ?? p.default);
    if (given[p.name] === undefined && p.default === null) return null;
    if (!Number.isFinite(value)) return null;
    parameters[p.name] = value;
  }
  return { key, parameters };
}

/** One line (or histogram) of an overlay; `value` is null while the indicator warms up. */
export interface OverlayLine {
  name: string;
  kind: 'line' | 'histogram';
  points: { time: string; value: number | null }[];
}

export interface ChartOverlay {
  id: string;
  label: string;
  panel: 'price' | 'separate';
  /** Position in the user's list, so each indicator keeps its colour. */
  colorIndex: number;
  lines: OverlayLine[];
}

/** Backend series to chart lines. Times are the bars' trading days, as for prices. */
export function toChartOverlay(
  spec: OverlaySpec,
  series: IndicatorSeries,
  colorIndex = 0,
): ChartOverlay {
  return {
    id: encodeOverlay(spec),
    colorIndex,
    label: overlayLabel(spec),
    panel: series.panel,
    lines: series.outputs.map((name) => ({
      name,
      kind: name === 'histogram' ? 'histogram' : 'line',
      points: series.points.map((p) => ({
        time: istDate(p.timestamp),
        value: p.values[name] ?? null,
      })),
    })),
  };
}

/**
 * POST /instruments/{id}/indicators/{key} for each overlay, over the same range as the
 * prices. The backend computes the values; the chart only draws them.
 */
export function useIndicatorSeries(
  instrumentId: string,
  overlays: OverlaySpec[],
  range: DateRange,
) {
  return useQueries({
    queries: overlays.map((o) => ({
      queryKey: queryKeys.instruments.indicator(instrumentId, encodeOverlay(o), range),
      queryFn: () =>
        unwrap(
          api.POST('/instruments/{instrument_id}/indicators/{key}', {
            params: { path: { instrument_id: instrumentId, key: o.key } },
            body: {
              parameters: o.parameters,
              ...(range.start ? { start_date: range.start } : {}),
              ...(range.end ? { end_date: range.end } : {}),
            },
          }),
        ),
    })),
  });
}
