import {
  BaselineSeries,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import {
  CHART_PALETTE,
  chartOptions,
  OVERLAY_COLORS,
  withAlpha,
} from '@/features/instruments/chart-colors';
import { useTheme, type Theme } from '@/lib/theme';
import { downsample, type ChartPoint } from './results-model';

/**
 * Results charts. They draw the backend's numbers as they are; long series are
 * thinned for drawing only (downsample keeps every peak and trough).
 * `data-*` attributes expose what was drawn, for tests.
 */

const percentFormat = {
  type: 'custom' as const,
  minMove: 0.01,
  formatter: (value: number) => `${value.toFixed(2)}%`,
};

/** Axis labels in whole rupees (the tables and tiles show paise). */
const rupees = { type: 'price' as const, precision: 0, minMove: 1 };

/** Creates the chart on mount and again when the data or theme changes. */
function useChart(draw: (chart: IChartApi, theme: Theme) => void, deps: unknown[]) {
  const container = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, chartOptions(theme));
    draw(chart, theme);
    chart.timeScale().fitContent();
    return () => chart.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, theme]);
  return { container, theme };
}

function Swatch(props: { color: string; dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-0 w-5 border-t-2"
        style={{ borderColor: props.color, borderTopStyle: props.dashed ? 'dashed' : 'solid' }}
      />
      {props.label}
    </span>
  );
}

/** Portfolio value over time, with the buy-and-hold benchmark when the API returned one. */
export function EquityChart(props: {
  strategy: ChartPoint[];
  benchmark: ChartPoint[] | null;
  benchmarkLabel: string;
  label: string;
  /** Legend and series name of the main line (default "Strategy"). */
  seriesLabel?: string;
}) {
  const seriesLabel = props.seriesLabel ?? 'Strategy';
  const strategy = downsample(props.strategy);
  const benchmark = props.benchmark ? downsample(props.benchmark) : null;
  const { container, theme } = useChart(
    (chart, theme) => {
      const colors = OVERLAY_COLORS[theme];
      const line = chart.addSeries(LineSeries, {
        color: colors[0],
        lineWidth: 2,
        title: seriesLabel,
        priceLineVisible: false,
        priceFormat: rupees,
      });
      line.setData(strategy);
      if (benchmark) {
        const bench = chart.addSeries(LineSeries, {
          color: colors[1],
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          title: 'Buy and hold',
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: rupees,
        });
        bench.setData(benchmark);
      }
    },
    [props.strategy, props.benchmark, seriesLabel],
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Swatch color={OVERLAY_COLORS[theme][0]!} label={seriesLabel} />
        {benchmark && (
          <Swatch color={OVERLAY_COLORS[theme][1]!} dashed label={props.benchmarkLabel} />
        )}
      </div>
      <div
        ref={container}
        role="img"
        aria-label={props.label}
        data-point-count={strategy.length}
        data-total-points={props.strategy.length}
        data-last-value={props.strategy[props.strategy.length - 1]?.value}
        data-benchmark-count={benchmark?.length ?? 0}
        className="h-72 w-full sm:h-80"
      />
    </div>
  );
}

/** Underwater chart: drawdown from the running peak, in percent (0 at a new high). */
export function DrawdownChart(props: { points: ChartPoint[]; label: string }) {
  const points = downsample(props.points);
  const { container } = useChart(
    (chart, theme) => {
      const colors = CHART_PALETTE[theme];
      const series = chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: 0 },
        topLineColor: colors.up,
        topFillColor1: withAlpha(colors.up, '00'),
        topFillColor2: withAlpha(colors.up, '00'),
        bottomLineColor: colors.down,
        bottomFillColor1: withAlpha(colors.down, '22'),
        bottomFillColor2: withAlpha(colors.down, '66'),
        lineWidth: 2,
        priceFormat: percentFormat,
        priceLineVisible: false,
      });
      series.setData(points.map((p) => ({ time: p.time, value: p.value * 100 })));
    },
    [props.points],
  );
  return (
    <div
      ref={container}
      role="img"
      aria-label={props.label}
      data-point-count={points.length}
      data-total-points={props.points.length}
      data-min-value={props.points.reduce((min, p) => Math.min(min, p.value), 0)}
      className="h-56 w-full sm:h-64"
    />
  );
}

/** One bar per month: green up, red down. Months without a value are left empty. */
export function MonthlyReturnsChart(props: {
  months: { month: string; value: number | null }[];
  label: string;
}) {
  const { container } = useChart(
    (chart, theme) => {
      const colors = CHART_PALETTE[theme];
      const series = chart.addSeries(HistogramSeries, {
        priceFormat: percentFormat,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(
        props.months.map((m) =>
          m.value === null
            ? { time: `${m.month}-01` }
            : {
                time: `${m.month}-01`,
                value: m.value * 100,
                color: m.value >= 0 ? colors.up : colors.down,
              },
        ),
      );
    },
    [props.months],
  );
  return (
    <div
      ref={container}
      role="img"
      aria-label={props.label}
      data-point-count={props.months.length}
      className="h-56 w-full sm:h-64"
    />
  );
}
