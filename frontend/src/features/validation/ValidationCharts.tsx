import { createChart, HistogramSeries, LineSeries } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import {
  CHART_PALETTE,
  chartOptions,
  OVERLAY_COLORS,
  withAlpha,
} from '@/features/instruments/chart-colors';
import { istDate } from '@/features/instruments/market-data';
import { downsample, type ChartPoint } from '@/features/results/results-model';
import { formatDate } from '@/lib/format';
import { useTheme, type Theme } from '@/lib/theme';
import {
  REGIME_COLORS,
  type Histogram,
  type RegimePeriod,
  type WalkForwardWindow,
} from './validation-model';

/**
 * Validation charts. They draw the API's numbers as they are (the pages show the
 * same numbers in tables). `data-*` attributes expose what was drawn, for tests.
 */

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

function Legend(props: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {props.items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-3 rounded-sm"
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Nice round ticks between min and max (0 always included). */
function ticks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (lo === hi) return [0];
  const raw = (hi - lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step / 2; v += step)
    out.push(Number(v.toPrecision(12)));
  return out;
}

/**
 * Bars per category, several series side by side (e.g. in-sample and
 * out-of-sample return of each walk-forward window). Missing values are gaps.
 */
export function GroupedBarChart(props: {
  label: string;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
  format: (value: number) => string;
}) {
  const theme = useTheme();
  const colors = OVERLAY_COLORS[theme];
  const values = props.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const scale = ticks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = scale[0]!;
  const hi = scale[scale.length - 1]!;
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);
  const groupWidth = (W - PAD.left - PAD.right) / Math.max(1, props.categories.length);
  const barWidth = Math.max(1, (groupWidth * 0.8) / props.series.length);
  const labelEvery = Math.ceil(props.categories.length / 12);

  return (
    <figure className="space-y-2">
      <Legend
        items={props.series.map((s, i) => ({ label: s.name, color: colors[i % colors.length]! }))}
      />
      <svg
        role="img"
        aria-label={props.label}
        data-categories={props.categories.length}
        data-series={props.series.map((s) => s.name).join('|')}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full text-muted-foreground"
      >
        {scale.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="currentColor"
              strokeOpacity={t === 0 ? 0.6 : 0.15}
            />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor">
              {props.format(t)}
            </text>
          </g>
        ))}
        {props.categories.map((category, ci) => (
          <g key={category}>
            {props.series.map((s, si) => {
              const v = s.values[ci];
              if (v === null || v === undefined) return null;
              const x = PAD.left + ci * groupWidth + groupWidth * 0.1 + si * barWidth;
              return (
                <rect
                  key={s.name}
                  x={x}
                  y={Math.min(y(v), y(0))}
                  width={barWidth * 0.9}
                  height={Math.max(0.5, Math.abs(y(v) - y(0)))}
                  fill={colors[si % colors.length]}
                >
                  <title>{`${category}, ${s.name}: ${props.format(v)}`}</title>
                </rect>
              );
            })}
            {ci % labelEvery === 0 && (
              <text
                x={PAD.left + ci * groupWidth + groupWidth / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize="11"
                fill="currentColor"
              >
                {category}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}

/** Counts per bin, with optional marked values (e.g. the 5th, 50th and 95th percentiles). */
export function HistogramChart(props: {
  label: string;
  histogram: Histogram;
  format: (value: number) => string;
  markers?: { label: string; value: number }[];
}) {
  const theme = useTheme();
  const { edges, counts } = props.histogram;
  const lo = edges[0]!;
  const hi = edges[edges.length - 1]!;
  const top = Math.max(1, ...counts);
  const x = (v: number) => PAD.left + ((v - lo) / (hi - lo || 1)) * (W - PAD.left - PAD.right);
  const y = (count: number) => PAD.top + (1 - count / top) * (H - PAD.top - PAD.bottom);
  const color = OVERLAY_COLORS[theme][0]!;
  const markerColor = CHART_PALETTE[theme].down;

  return (
    <svg
      role="img"
      aria-label={props.label}
      data-bins={counts.length}
      data-total={counts.reduce((a, b) => a + b, 0)}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full text-muted-foreground"
    >
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={y(0)}
        y2={y(0)}
        stroke="currentColor"
        strokeOpacity={0.6}
      />
      <text x={PAD.left - 6} y={y(top) + 4} textAnchor="end" fontSize="11" fill="currentColor">
        {top}
      </text>
      <text x={PAD.left - 6} y={y(0) + 4} textAnchor="end" fontSize="11" fill="currentColor">
        0
      </text>
      {counts.map((count, i) => (
        <rect
          key={i}
          x={x(edges[i]!) + 0.5}
          y={y(count)}
          width={Math.max(0.5, x(edges[i + 1]!) - x(edges[i]!) - 1)}
          height={y(0) - y(count)}
          fill={withAlpha(color, 'cc')}
        >
          <title>{`${props.format(edges[i]!)} to ${props.format(edges[i + 1]!)}: ${count}`}</title>
        </rect>
      ))}
      {(props.markers ?? []).map((m) => (
        <g key={m.label}>
          <line
            x1={x(m.value)}
            x2={x(m.value)}
            y1={PAD.top}
            y2={y(0)}
            stroke={markerColor}
            strokeDasharray="4 3"
          />
          <text
            x={x(m.value)}
            y={PAD.top + 10}
            textAnchor="middle"
            fontSize="10"
            fill={markerColor}
          >
            {m.label}
          </text>
        </g>
      ))}
      {[lo, (lo + hi) / 2, hi].map((v, i) => (
        <text
          key={i}
          x={x(v)}
          y={H - 8}
          textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
          fontSize="11"
          fill="currentColor"
        >
          {props.format(v)}
        </text>
      ))}
    </svg>
  );
}

/** Each walk-forward window as a row: train (warm-up), validation and test spans. */
export function WindowTimeline(props: { windows: WalkForwardWindow[]; label: string }) {
  const theme = useTheme();
  const colors = OVERLAY_COLORS[theme];
  const t = (s: string) => new Date(s).getTime();
  const first = Math.min(...props.windows.map((w) => t(w.train_start)));
  const last = Math.max(...props.windows.map((w) => t(w.test_end)));
  const row = 18;
  const height = PAD.top + props.windows.length * row + 24;
  const x = (s: string) =>
    PAD.left + ((t(s) - first) / (last - first || 1)) * (W - PAD.left - PAD.right);
  const spans = [
    {
      name: 'Train (warm-up)',
      color: withAlpha(CHART_PALETTE[theme].text, '55'),
      from: 'train_start',
      to: 'validation_start',
    },
    {
      name: 'Validation (in-sample)',
      color: colors[0]!,
      from: 'validation_start',
      to: 'test_start',
    },
    { name: 'Test (out-of-sample)', color: colors[1]!, from: 'test_start', to: 'test_end' },
  ] as const;

  return (
    <figure className="space-y-2">
      <Legend items={spans.map((s) => ({ label: s.name, color: s.color }))} />
      <svg
        role="img"
        aria-label={props.label}
        data-windows={props.windows.length}
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full text-muted-foreground"
      >
        {props.windows.map((w, i) => (
          <g key={w.index}>
            <text
              x={PAD.left - 6}
              y={PAD.top + i * row + 12}
              textAnchor="end"
              fontSize="11"
              fill="currentColor"
            >
              {`W${w.index}`}
            </text>
            {spans.map((span) => (
              <rect
                key={span.name}
                x={x(w[span.from])}
                y={PAD.top + i * row + 3}
                width={Math.max(1, x(w[span.to]) - x(w[span.from]))}
                height={row - 6}
                fill={span.color}
              >
                <title>{`Window ${w.index}, ${span.name}: ${formatDate(istDate(w[span.from]))} to ${formatDate(istDate(w[span.to]))}`}</title>
              </rect>
            ))}
          </g>
        ))}
        <text x={PAD.left} y={height - 6} fontSize="11" fill="currentColor">
          {formatDate(istDate(props.windows[0]!.train_start))}
        </text>
        <text x={W - PAD.right} y={height - 6} textAnchor="end" fontSize="11" fill="currentColor">
          {formatDate(istDate(props.windows[props.windows.length - 1]!.test_end))}
        </text>
      </svg>
    </figure>
  );
}

/** The backtest's equity, with each day shaded by its market regime. */
export function RegimeEquityChart(props: {
  equity: ChartPoint[];
  periods: RegimePeriod[];
  names: Record<string, string>;
  label: string;
  /** Colour of each regime key (default: the rule-based regimes' colours); none = not shaded. */
  colorOf?: (key: string, theme: Theme) => string | undefined;
  /** Legend order (default: the rule-based regimes). */
  keys?: string[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const equity = downsample(props.equity);
  const { colorOf: customColor } = props;
  const colorFor = (key: string, t: Theme) =>
    customColor ? customColor(key, t) : REGIME_COLORS[t][key];
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, chartOptions(theme));
    const shading = chart.addSeries(HistogramSeries, {
      priceScaleId: 'regime',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart
      .priceScale('regime')
      .applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } });
    const colorOf = new Map<string, string>();
    for (const period of props.periods) {
      const color = colorFor(period.regime, theme);
      if (!color) continue;
      const start = istDate(period.start);
      const end = istDate(period.end);
      for (const point of props.equity)
        if (point.time >= start && point.time <= end) colorOf.set(point.time, color);
    }
    shading.setData(
      props.equity
        .filter((p) => colorOf.has(p.time))
        .map((p) => ({ time: p.time, value: 1, color: withAlpha(colorOf.get(p.time)!, '33') })),
    );
    const line = chart.addSeries(LineSeries, {
      color: OVERLAY_COLORS[theme][0],
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });
    line.setData(equity);
    chart.timeScale().fitContent();
    return () => chart.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equity, props.equity, props.periods, theme, customColor]);

  const shown = (props.keys ?? Object.keys(REGIME_COLORS[theme])).filter(
    (key) => colorFor(key, theme) && props.periods.some((p) => p.regime === key),
  );
  return (
    <div className="space-y-2">
      <Legend
        items={shown.map((key) => ({
          label: props.names[key] ?? key,
          color: withAlpha(colorFor(key, theme)!, '66'),
        }))}
      />
      <div
        ref={container}
        role="img"
        aria-label={props.label}
        data-point-count={equity.length}
        data-period-count={props.periods.length}
        className="h-72 w-full sm:h-80"
      />
    </div>
  );
}
