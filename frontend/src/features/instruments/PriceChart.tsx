import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { ChartOverlay } from '@/features/indicators/overlays';
import { useTheme } from '@/lib/theme';
import {
  CHART_PALETTE,
  chartOptions,
  OVERLAY_COLORS,
  PANE_HEIGHT,
  withAlpha,
} from './chart-colors';
import type { Bar } from './market-data';

/** A buy or sell drawn on the price: an arrow under (BUY) or over (SELL) the bar. */
export interface TradeMarker {
  /** The bar's trading day, "YYYY-MM-DD". */
  time: string;
  side: 'BUY' | 'SELL';
  text: string;
}

/**
 * Daily candlestick (or close-price line) chart with volume in a pane underneath.
 * Overlays are backend-computed indicator series: "price" ones are drawn over the
 * prices, "separate" ones each get their own pane. Draws exactly the bars and points
 * it is given; `data-bar-count` exposes the count for tests.
 */
export function PriceChart(props: {
  bars: Bar[];
  mode: 'candles' | 'line';
  label: string;
  overlays?: ChartOverlay[];
  markers?: TradeMarker[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const overlays = props.overlays ?? [];
  const separate = overlays.filter((o) => o.panel === 'separate').length;

  useEffect(() => {
    if (!container.current) return;
    const colors = CHART_PALETTE[theme];
    const chart: IChartApi = createChart(container.current, chartOptions(theme));

    let price: ISeriesApi<SeriesType>;
    if (props.mode === 'candles') {
      const candles = chart.addSeries(CandlestickSeries, {
        upColor: colors.up,
        downColor: colors.down,
        wickUpColor: colors.up,
        wickDownColor: colors.down,
        borderVisible: false,
      });
      candles.setData(
        props.bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
      );
      price = candles;
    } else {
      const line = chart.addSeries(LineSeries, { color: colors.up, lineWidth: 2 });
      line.setData(props.bars.map(({ time, close }) => ({ time, value: close })));
      price = line;
    }

    if (props.markers?.length) {
      createSeriesMarkers(
        price,
        props.markers.map((m) => ({
          time: m.time,
          position: m.side === 'BUY' ? 'belowBar' : 'aboveBar',
          shape: m.side === 'BUY' ? 'arrowUp' : 'arrowDown',
          color: m.side === 'BUY' ? colors.up : colors.down,
          text: m.text,
        })),
      );
    }

    // Volume gets its own pane below the price, so the price axis never runs into
    // the volume bars (or below zero).
    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false },
      1,
    );
    volume.setData(
      props.bars.map(({ time, volume: value, open, close }) => ({
        time,
        value,
        color: withAlpha(close >= open ? colors.up : colors.down, '66'),
      })),
    );

    let nextPane = 2;
    overlays.forEach((overlay, i) => {
      const palette = OVERLAY_COLORS[theme];
      const color = palette[(overlay.colorIndex ?? i) % palette.length]!;
      const pane = overlay.panel === 'price' ? 0 : nextPane++;
      overlay.lines.forEach((line, j) => {
        // Points without a value (warm-up) are kept as gaps at the same time.
        const data = line.points.map((p) =>
          p.value === null ? { time: p.time } : { time: p.time, value: p.value },
        );
        if (line.kind === 'histogram') {
          const series = chart.addSeries(
            HistogramSeries,
            { color: withAlpha(color, '80'), priceLineVisible: false, lastValueVisible: false },
            pane,
          );
          series.setData(data);
        } else {
          const series = chart.addSeries(
            LineSeries,
            {
              color: j === 0 ? color : withAlpha(color, 'aa'),
              lineWidth: j === 0 ? 2 : 1,
              lineStyle: j === 0 ? 0 : 2,
              priceLineVisible: false,
              lastValueVisible: false,
              title: overlay.panel === 'separate' && j === 0 ? overlay.label : '',
            },
            pane,
          );
          series.setData(data);
        }
      });
    });

    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    panes[1]?.setStretchFactor(1);
    for (const pane of panes.slice(2)) pane.setStretchFactor(1.5);
    chart.timeScale().fitContent();

    return () => chart.remove();
    // `overlays` is memoised by the page; its identity changes when the data does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bars, props.mode, props.overlays, props.markers, theme]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={props.label}
      data-bar-count={props.bars.length}
      data-overlay-count={overlays.length}
      data-marker-count={props.markers?.length ?? 0}
      className="h-80 w-full [--chart-base:20rem] sm:h-96 sm:[--chart-base:24rem]"
      style={
        separate ? { height: `calc(var(--chart-base) + ${separate * PANE_HEIGHT}px)` } : undefined
      }
    />
  );
}
