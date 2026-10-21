import { CandlestickChart, LineChart } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { OverlayControls } from '@/features/indicators/OverlayControls';
import { toChartOverlay, useIndicatorSeries } from '@/features/indicators/overlays';
import { useOverlaySpecs } from '@/features/indicators/use-overlay-specs';
import { istDate, toBars, useMarketData, type DateRange } from '@/features/instruments/market-data';
import { PriceChart } from '@/features/instruments/PriceChart';
import { formatDate, formatNumber, formatPercent, MISSING } from '@/lib/format';
import { cn } from '@/lib/utils';
import { NotAvailable, Section } from './parts';
import { DrawdownChart, EquityChart, MonthlyReturnsChart } from './ResultsCharts';
import {
  MAX_CHART_POINTS,
  MONTH_NAMES,
  monthLabel,
  monthlyGrid,
  toChartPoints,
  tradeMarkers,
  type ExecutionResults,
} from './results-model';

function MonthlyTable({ results }: { results: ExecutionResults }) {
  const years = monthlyGrid(results.monthly_returns);
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <caption className="sr-only">Monthly returns</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Year</TableHead>
            {MONTH_NAMES.map((m) => (
              <TableHead key={m} className="text-right">
                {m}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {years.map((y) => (
            <TableRow key={y.year}>
              <TableHead scope="row" className="font-medium">
                {y.year}
              </TableHead>
              {y.months.map((value, i) => (
                <TableCell
                  key={i}
                  className={cn(
                    'text-right tabular-nums',
                    typeof value === 'number' && value > 0 && 'text-success',
                    typeof value === 'number' && value < 0 && 'text-destructive',
                  )}
                >
                  {value === undefined ? '' : value === null ? MISSING : formatPercent(value)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The run's prices with its BUY / SELL fills marked, and optional indicators from the backend. */
function PriceWithTrades(props: { results: ExecutionResults; symbol: (id: string) => string }) {
  const { results } = props;
  const ids = results.configuration.instrument_ids;
  const [instrumentId, setInstrumentId] = useState(ids[0] ?? '');
  const [mode, setMode] = useState<'candles' | 'line'>('line');
  const range: DateRange = useMemo(
    () => ({
      start: istDate(results.summary.first_bar_at),
      end: istDate(results.summary.last_bar_at),
    }),
    [results.summary.first_bar_at, results.summary.last_bar_at],
  );
  const data = useMarketData(instrumentId, range);
  const bars = useMemo(() => toBars(data.data ?? []), [data.data]);
  const markers = useMemo(
    () => tradeMarkers(results.records.fills, instrumentId),
    [results.records.fills, instrumentId],
  );
  const overlays = useOverlaySpecs();
  const seriesQueries = useIndicatorSeries(instrumentId, overlays.specs, range);
  const seriesKey = seriesQueries.map((q) => q.dataUpdatedAt).join(',');
  const chartOverlays = useMemo(
    () =>
      overlays.specs.flatMap((spec, i) => {
        const series = seriesQueries[i]?.data;
        return series ? [toChartOverlay(spec, series, i)] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overlays.specs, seriesKey],
  );
  const buys = markers.filter((m) => m.side === 'BUY').length;
  const sells = markers.length - buys;
  const symbol = props.symbol(instrumentId);

  return (
    <Section
      id="price-trades"
      title="Price and trades"
      description={`Stored daily prices (historical) for the run's dates. Arrows mark the simulated fills: up = BUY, down = SELL.`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {ids.length > 1 && (
            <NativeSelect
              aria-label="Instrument"
              value={instrumentId}
              onChange={(e) => setInstrumentId(e.target.value)}
              className="w-40"
            >
              {ids.map((id) => (
                <NativeSelectOption key={id} value={id}>
                  {props.symbol(id)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          <div className="flex gap-1" role="group" aria-label="Chart type">
            <Button
              size="sm"
              variant={mode === 'line' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'line'}
              onClick={() => setMode('line')}
            >
              <LineChart /> Line
            </Button>
            <Button
              size="sm"
              variant={mode === 'candles' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'candles'}
              onClick={() => setMode('candles')}
            >
              <CandlestickChart /> Candles
            </Button>
          </div>
        </div>
      }
    >
      {data.isPending ? (
        <Skeleton className="h-80 w-full sm:h-96" />
      ) : data.isError ? (
        <ErrorState error={data.error} onRetry={() => void data.refetch()} />
      ) : bars.length === 0 ? (
        <EmptyState
          title="No stored prices for these dates"
          description="The prices this run used are no longer stored, so they cannot be drawn."
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground tabular-nums">
            {symbol} &middot; {formatNumber(bars.length, 0)} daily bars &middot;{' '}
            {`${buys} BUY and ${sells} SELL ${markers.length === 1 ? 'fill' : 'fills'}`}
          </p>
          {overlays.catalogue.data && (
            <OverlayControls
              catalogue={overlays.catalogue.data}
              overlays={overlays.specs}
              status={seriesQueries.map((q) => ({
                loading: q.isPending,
                error: q.isError ? q.error.message : undefined,
              }))}
              onAdd={overlays.add}
              onRemove={overlays.remove}
            />
          )}
          <PriceChart
            bars={bars}
            mode={mode}
            overlays={chartOverlays}
            markers={markers}
            label={`${symbol} daily ${mode === 'candles' ? 'candlestick' : 'close price'} chart, ${bars.length} bars from ${formatDate(bars[0]!.time)} to ${formatDate(bars[bars.length - 1]!.time)}, with ${buys} BUY and ${sells} SELL markers${chartOverlays.length ? ` and ${chartOverlays.map((o) => o.label).join(', ')}` : ''}`}
          />
        </div>
      )}
    </Section>
  );
}

/** Charts tab: equity vs benchmark, drawdown, monthly returns, and prices with the fills. */
export function ChartsTab(props: { results: ExecutionResults; symbol: (id: string) => string }) {
  const { results } = props;
  const { summary, benchmark } = results;
  const equity = useMemo(
    () =>
      toChartPoints(
        results.equity_curve,
        (p) => p.timestamp,
        (p) => p.portfolio_value,
      ),
    [results.equity_curve],
  );
  const bench = useMemo(
    () =>
      benchmark
        ? toChartPoints(
            benchmark.equity_curve,
            (p) => p.timestamp,
            (p) => p.portfolio_value,
          )
        : null,
    [benchmark],
  );
  const drawdown = useMemo(
    () =>
      toChartPoints(
        results.equity_curve,
        (p) => p.timestamp,
        (p) => p.drawdown,
      ),
    [results.equity_curve],
  );
  const span = `${formatDate(istDate(summary.first_bar_at))} to ${formatDate(istDate(summary.last_bar_at))}`;
  const thinned =
    equity.length > MAX_CHART_POINTS
      ? ` Long series are thinned to about ${formatNumber(MAX_CHART_POINTS, 0)} points for drawing; every peak and low is kept.`
      : '';
  const benchLabel = benchmark ? `Buy and hold ${props.symbol(benchmark.instrument_id)}` : '';

  return (
    <div className="space-y-6">
      <Section
        id="equity"
        title="Equity curve"
        description={`Portfolio value at each daily bar, ${span}.${thinned}`}
      >
        <EquityChart
          strategy={equity}
          benchmark={bench}
          benchmarkLabel={benchLabel}
          label={`Equity curve, ${equity.length} daily points from ${span}${bench ? `, with ${benchLabel}` : ''}`}
        />
        {!benchmark && (
          <p className="text-sm text-muted-foreground">
            Benchmark not shown:{' '}
            <NotAvailable reason={results.benchmark_unavailable_reason ?? undefined} />
          </p>
        )}
      </Section>

      <Section
        id="drawdown"
        title="Drawdown (underwater)"
        description="How far the portfolio was below its highest value so far, at each bar. 0% = at a new high."
      >
        <DrawdownChart
          points={drawdown}
          label={`Drawdown chart, ${drawdown.length} daily points from ${span}`}
        />
      </Section>

      <Section
        id="monthly"
        title="Monthly returns"
        description="Return of each calendar month (IST), from the value at the end of the month before."
      >
        <MonthlyReturnsChart
          months={results.monthly_returns}
          label={`Monthly returns, ${results.monthly_returns.length} months${
            results.monthly_returns.length
              ? ` from ${monthLabel(results.monthly_returns[0]!.month)} to ${monthLabel(results.monthly_returns[results.monthly_returns.length - 1]!.month)}`
              : ''
          }`}
        />
        <MonthlyTable results={results} />
      </Section>

      <PriceWithTrades results={results} symbol={props.symbol} />
    </div>
  );
}
