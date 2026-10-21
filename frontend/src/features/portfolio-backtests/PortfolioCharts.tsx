import { AreaSeries, createChart, LineSeries, LineStyle, LineType } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { chartOptions, withAlpha } from '@/features/instruments/chart-colors';
import { downsample } from '@/features/results/results-model';
import { useTheme } from '@/lib/theme';
import { CASH_COLOR, LINE_COLORS, sleeveColor } from './pb-colors';

/**
 * Portfolio backtest charts. They draw the API's numbers as they are (long series
 * are thinned for drawing only); `data-*` attributes expose what was drawn, for tests.
 */

export interface Line {
  key: string;
  label: string;
  points: { time: string; value: number }[];
  dashed?: boolean;
}

const percentFormat = {
  type: 'custom' as const,
  minMove: 0.01,
  formatter: (value: number) => `${value.toFixed(2)}%`,
};
const rupees = { type: 'price' as const, precision: 0, minMove: 1 };

function Swatch(props: { color: string; dashed?: boolean; label: string; block?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={
          props.block ? 'inline-block size-3 rounded-sm' : 'inline-block h-0 w-5 border-t-2'
        }
        style={
          props.block
            ? { backgroundColor: props.color }
            : { borderColor: props.color, borderTopStyle: props.dashed ? 'dashed' : 'solid' }
        }
      />
      {props.label}
    </span>
  );
}

/** Several lines on one chart: rupee values, or drawdowns in percent (`percent`). */
export function LinesChart(props: { lines: Line[]; label: string; percent?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const { lines, percent } = props;
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, chartOptions(theme));
    lines.forEach((line, index) => {
      const series = chart.addSeries(LineSeries, {
        color: LINE_COLORS[theme][index % 4],
        lineWidth: 2,
        lineStyle: line.dashed ? LineStyle.Dashed : LineStyle.Solid,
        title: index === 0 ? line.label : '',
        priceLineVisible: false,
        lastValueVisible: index === 0,
        priceFormat: percent ? percentFormat : rupees,
      });
      series.setData(
        downsample(line.points).map((p) => ({
          time: p.time,
          value: percent ? p.value * 100 : p.value,
        })),
      );
    });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [lines, percent, theme]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {lines.map((line, index) => (
          <Swatch
            key={line.key}
            color={LINE_COLORS[theme][index % 4]!}
            dashed={line.dashed}
            label={line.label}
          />
        ))}
      </div>
      <div
        ref={container}
        role="img"
        aria-label={props.label}
        data-series={lines.map((l) => l.key).join(',')}
        data-total-points={lines[0]?.points.length ?? 0}
        data-last-values={lines.map((l) => l.points[l.points.length - 1]?.value ?? '').join(',')}
        className="h-72 w-full sm:h-80"
      />
    </div>
  );
}

/**
 * The weights set on each rebalance day, stacked to 100% with cash on top; each
 * holds until the next rebalance (the holdings drift with prices in between).
 */
export function WeightsChart(props: {
  rows: { day: string; weights: Record<string, number>; cash: number }[];
  strategies: { id: string; name: string }[];
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const { rows, strategies } = props;
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, chartOptions(theme));
    // Cumulative bands, the widest (everything up to cash) drawn first.
    const layers = [
      ...strategies.map((_s, i) => ({
        ids: strategies.slice(0, i + 1).map((x) => x.id),
        color: sleeveColor(i, theme),
        cash: false,
      })),
      { ids: strategies.map((x) => x.id), color: CASH_COLOR[theme], cash: true },
    ].reverse();
    for (const layer of layers) {
      const series = chart.addSeries(AreaSeries, {
        lineColor: layer.color,
        topColor: withAlpha(layer.color, 'ff'),
        bottomColor: withAlpha(layer.color, 'ff'),
        lineWidth: 1,
        lineType: LineType.WithSteps,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: percentFormat,
        // The bands fill down to the pane's bottom, so the scale is fixed at 0-100%.
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      });
      series.setData(
        rows.map((row) => ({
          time: row.day,
          value:
            100 *
            (layer.ids.reduce((sum, id) => sum + (row.weights[id] ?? 0), 0) +
              (layer.cash ? row.cash : 0)),
        })),
      );
    }
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0 } });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [rows, strategies, theme]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {strategies.map((s, i) => (
          <Swatch key={s.id} block color={sleeveColor(i, theme)} label={s.name} />
        ))}
        <Swatch block color={CASH_COLOR[theme]} label="Cash" />
      </div>
      <div
        ref={container}
        role="img"
        aria-label={props.label}
        data-rebalance-count={rows.length}
        data-strategy-count={strategies.length}
        className="h-64 w-full sm:h-72"
      />
    </div>
  );
}
