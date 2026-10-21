import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';
import { CHART_PALETTE, chartOptions, OVERLAY_COLORS } from '@/features/instruments/chart-colors';
import { useTheme } from '@/lib/theme';
import { candlesOf, tailUpdates, type Candle } from './live-chart-data';
import {
  chartTime,
  TIMEFRAME_MINUTES,
  type FormingBar,
  type LiveBar,
  type LiveFill,
} from './live-model';

const IST_HM = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const istLabel = (time: Time) => IST_HM.format(new Date(Number(time) * 1000));

function ist(chart: IChartApi) {
  // The data stays in UTC; only the labels are written in IST (09:15 to 15:30).
  chart.applyOptions({
    localization: { locale: 'en-IN', timeFormatter: istLabel },
    timeScale: { timeVisible: true, secondsVisible: false, tickMarkFormatter: istLabel },
  });
}

/**
 * The session's candles as they arrive, the current bar forming on the right,
 * and an arrow at each fill (on the bar whose close it filled at). New bars are
 * added with series.update(); `data-*` attributes expose what is drawn for tests.
 */
export function LiveChart(props: {
  bars: LiveBar[];
  forming: FormingBar | null;
  fills: LiveFill[];
  timeframe: string;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const drawn = useRef<Candle[]>([]);
  const theme = useTheme();
  const candles = useMemo(() => candlesOf(props.bars, props.forming), [props.bars, props.forming]);

  useEffect(() => {
    if (!container.current) return;
    const colors = CHART_PALETTE[theme];
    const chart = createChart(container.current, chartOptions(theme));
    chartRef.current = chart;
    ist(chart);
    series.current = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      borderVisible: false,
    });
    markers.current = createSeriesMarkers(series.current, []);
    drawn.current = [];
    return () => {
      chart.remove();
      chartRef.current = null;
      series.current = null;
      markers.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    const updates = tailUpdates(drawn.current, candles);
    if (updates === null) {
      s.setData(candles);
      chartRef.current?.timeScale().fitContent();
    } else {
      for (const c of updates) s.update(c);
    }
    drawn.current = candles;
  }, [candles, theme]);

  const step = (TIMEFRAME_MINUTES[props.timeframe] ?? 1) * 60;
  useEffect(() => {
    const colors = CHART_PALETTE[theme];
    markers.current?.setMarkers(
      props.fills.map((f) => ({
        // A fill happens at its bar's close: the marker sits on that bar.
        time: (chartTime(f.filled_at) - step) as UTCTimestamp,
        position: f.side === 'BUY' ? 'belowBar' : 'aboveBar',
        shape: f.side === 'BUY' ? 'arrowUp' : 'arrowDown',
        color: f.side === 'BUY' ? colors.up : colors.down,
        text: `${f.side} ${f.quantity} @ ${f.price}`,
      })),
    );
  }, [props.fills, step, theme]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={props.label}
      data-bar-count={props.bars.length}
      data-forming={props.forming ? `${props.forming.minutes}/${props.forming.of}` : ''}
      data-marker-count={props.fills.length}
      data-last-close={candles.at(-1)?.close ?? ''}
      className="h-80 w-full sm:h-96"
    />
  );
}

/** The backend's equity after each bar (EQUITY events), against the capital. */
export function EquityLine(props: {
  points: { time: string; value: number }[];
  capital: number;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, chartOptions(theme));
    ist(chart);
    const line = chart.addSeries(LineSeries, {
      color: OVERLAY_COLORS[theme][0],
      lineWidth: 2,
      priceLineVisible: false,
    });
    const seen = new Set<number>();
    const data = props.points
      .map((p) => ({ time: chartTime(p.time) as UTCTimestamp, value: p.value }))
      .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)));
    line.setData(data);
    line.createPriceLine({
      price: props.capital,
      color: CHART_PALETTE[theme].text,
      lineStyle: 2,
      lineWidth: 1,
      axisLabelVisible: true,
      title: 'Capital',
    });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [props.points, props.capital, theme]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={props.label}
      data-points={props.points.length}
      data-last={props.points.at(-1)?.value ?? ''}
      className="h-48 w-full"
    />
  );
}
