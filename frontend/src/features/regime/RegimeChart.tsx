import { CHART_PALETTE, withAlpha } from '@/features/instruments/chart-colors';
import { istDate } from '@/features/instruments/market-data';
import { formatDate, formatINR } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import {
  bands,
  classColor,
  codeColor,
  dimensionBands,
  type DimensionPeriods,
  type RegimeHistory,
} from './regime-model';

const W = 720;
const H = 280;
const STRIP = 20;
const PAD = { top: 8, right: 12, bottom: 26, left: 64 };

/** A regime's colour swatch with its code: the code carries the meaning. */
export function RegimeChip(props: { code: string | null | undefined; className?: string }) {
  const theme = useTheme();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs font-semibold ${props.className ?? ''}`}
      style={{
        borderColor: codeColor(theme, props.code),
        background: withAlpha(codeColor(theme, props.code), '22'),
      }}
    >
      {props.code ?? '\u2013'}
    </span>
  );
}

/**
 * The reference instrument's closes with each regime period as a band. Every
 * band carries its code in the strip at the top (when wide enough) and its full
 * name in the tooltip; the legend and the periods table name every code.
 * Days are spaced evenly (trading days), so weekends and holidays leave no gaps.
 */
export function RegimeChart(props: { history: RegimeHistory; label: string }) {
  const theme = useTheme();
  const palette = CHART_PALETTE[theme];
  const { points } = props.history;
  const n = points.length;
  const step = (W - PAD.left - PAD.right) / Math.max(1, n - 1);
  const x = (i: number) => PAD.left + i * step;
  const closes = points.map((p) => p.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const span = high - low || Math.abs(high) || 1;
  const top = PAD.top + STRIP + 6;
  const bottom = H - PAD.bottom;
  const y = (v: number) => bottom - ((v - (low - span * 0.05)) / (span * 1.1)) * (bottom - top);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`)
    .join('');
  const trainingEnd = points.reduce(
    (last, p, i) => (istDate(p.timestamp) <= istDate(props.history.training_end) ? i : last),
    -1,
  );
  const showTrainingEnd = trainingEnd >= 0 && trainingEnd < n - 1;

  return (
    <svg
      role="img"
      aria-label={props.label}
      data-points={n}
      data-bands={props.history.periods.length}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full text-muted-foreground"
    >
      {bands(props.history).map(({ period, from, to }) => {
        const left = Math.max(PAD.left, x(from) - step / 2);
        const right = Math.min(W - PAD.right, x(to) + step / 2);
        const width = Math.max(1, right - left);
        const color = codeColor(theme, period.code);
        const text = period.code ?? 'W';
        return (
          <g
            key={period.start}
            data-band
            data-code={period.code ?? ''}
            data-start={period.start}
            data-end={period.end}
          >
            <title>{`${period.code ? `${period.code} ` : ''}${period.name}: ${formatDate(istDate(period.start))} to ${formatDate(istDate(period.end))} (${period.bars} ${period.bars === 1 ? 'day' : 'days'})`}</title>
            <rect
              x={left}
              y={top}
              width={width}
              height={bottom - top}
              fill={withAlpha(color, '1f')}
            />
            <rect x={left} y={PAD.top} width={width} height={STRIP} fill={withAlpha(color, '66')} />
            {width >= 22 && (
              <text
                x={left + width / 2}
                y={PAD.top + 14}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="currentColor"
                className="text-foreground"
              >
                {text}
              </text>
            )}
          </g>
        );
      })}
      {[low, (low + high) / 2, high].map((v) => (
        <text
          key={v}
          x={PAD.left - 6}
          y={y(v) + 4}
          textAnchor="end"
          fontSize="11"
          fill="currentColor"
        >
          {formatINR(v)}
        </text>
      ))}
      <path d={path} fill="none" stroke={palette.text} strokeWidth={1.5} />
      {showTrainingEnd && (
        <g data-training-end={points[trainingEnd]!.timestamp}>
          <line
            x1={x(trainingEnd)}
            x2={x(trainingEnd)}
            y1={top}
            y2={bottom}
            stroke="currentColor"
            strokeDasharray="4 3"
          />
          <text x={x(trainingEnd) + 4} y={top + 12} fontSize="10" fill="currentColor">
            Training data ends
          </text>
        </g>
      )}
      {[0, Math.floor((n - 1) / 2), n - 1]
        .filter((i, k, all) => all.indexOf(i) === k)
        .map((i, k, all) => (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor={k === 0 ? 'start' : k === all.length - 1 ? 'end' : 'middle'}
            fontSize="11"
            fill="currentColor"
          >
            {formatDate(istDate(points[i]!.timestamp))}
          </text>
        ))}
    </svg>
  );
}

const ROW = 22;
const ROW_GAP = 6;
const LABEL_W = 96;

/**
 * Supervised models: the closes with one band row per dimension under them
 * (volatility, trend, risk sentiment). Each band is the class the model gave the
 * next days on those days; its name is in the tooltip and, when wide enough, in
 * the band. Days are spaced evenly (trading days).
 */
export function DimensionChart(props: {
  history: RegimeHistory;
  dimensions: DimensionPeriods[];
  label: string;
}) {
  const theme = useTheme();
  const palette = CHART_PALETTE[theme];
  const { points } = props.history;
  const n = points.length;
  const priceH = 180;
  const rows = props.dimensions.length;
  const height = PAD.top + priceH + 10 + rows * (ROW + ROW_GAP) + PAD.bottom;
  const left = Math.max(PAD.left, LABEL_W);
  const step = (W - left - PAD.right) / Math.max(1, n - 1);
  const x = (i: number) => left + i * step;
  const closes = points.map((p) => p.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const span = high - low || Math.abs(high) || 1;
  const top = PAD.top;
  const bottom = PAD.top + priceH;
  const y = (v: number) => bottom - ((v - (low - span * 0.05)) / (span * 1.1)) * (bottom - top);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`)
    .join('');
  const rowY = (k: number) => bottom + 10 + k * (ROW + ROW_GAP);

  return (
    <svg
      role="img"
      aria-label={props.label}
      data-points={n}
      viewBox={`0 0 ${W} ${height}`}
      className="h-auto w-full text-muted-foreground"
    >
      {[low, (low + high) / 2, high].map((v) => (
        <text key={v} x={left - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="currentColor">
          {formatINR(v)}
        </text>
      ))}
      <path d={path} fill="none" stroke={palette.text} strokeWidth={1.5} />
      {props.dimensions.map((dimension, k) => (
        <g key={dimension.key} data-dimension={dimension.key}>
          <text
            x={left - 6}
            y={rowY(k) + ROW / 2 + 4}
            textAnchor="end"
            fontSize="11"
            fontWeight="600"
            fill="currentColor"
            className="text-foreground"
          >
            {dimension.name}
          </text>
          {dimensionBands(props.history, dimension.periods).map((band) => {
            const x0 = Math.max(left, x(band.from) - step / 2);
            const x1 = Math.min(W - PAD.right, x(band.to) + step / 2);
            const width = Math.max(1, x1 - x0);
            const color = classColor(theme, band.label);
            const name = band.label ?? 'Warm-up';
            return (
              <g key={band.start} data-band data-label={band.label ?? ''}>
                <title>{`${dimension.name}: ${name}, ${formatDate(istDate(band.start))} to ${formatDate(istDate(band.end))} (${band.bars} ${band.bars === 1 ? 'day' : 'days'})`}</title>
                <rect x={x0} y={rowY(k)} width={width} height={ROW} fill={withAlpha(color, '88')} />
                {width >= 70 && (
                  <text
                    x={x0 + width / 2}
                    y={rowY(k) + ROW / 2 + 4}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="600"
                    fill="currentColor"
                    className="text-foreground"
                  >
                    {name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}
      {[0, Math.floor((n - 1) / 2), n - 1]
        .filter((i, k, all) => all.indexOf(i) === k)
        .map((i, k, all) => (
          <text
            key={i}
            x={x(i)}
            y={height - 8}
            textAnchor={k === 0 ? 'start' : k === all.length - 1 ? 'end' : 'middle'}
            fontSize="11"
            fill="currentColor"
          >
            {formatDate(istDate(points[i]!.timestamp))}
          </text>
        ))}
    </svg>
  );
}

/** A class name with its band colour. */
export function ClassChip({ label }: { label: string | null }) {
  const theme = useTheme();
  const color = classColor(theme, label);
  return (
    <span
      className="inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ borderColor: color, background: withAlpha(color, '22') }}
    >
      {label ?? 'Warm-up'}
    </span>
  );
}
