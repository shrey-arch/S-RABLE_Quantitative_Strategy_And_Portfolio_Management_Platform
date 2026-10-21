import { CandlestickChart, CircleSlash, LineChart, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DateRangeField, rangeError } from '@/components/ui/date-range-field';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatDateTime, formatNumber, MISSING } from '@/lib/format';
import { CoveragePanel, QualityPanel } from './CoveragePanels';
import { ImportDataCard } from './ImportDataCard';
import { InstrumentFormDialog } from './InstrumentFormDialog';
import { exchangeLabel, instrumentTypeLabel } from './labels';
import {
  istDate,
  providerLabel,
  toBars,
  todayIst,
  useCoverage,
  useMarketData,
  type Bar,
  type DateRange,
} from './market-data';
import { OverlayControls } from '@/features/indicators/OverlayControls';
import { toChartOverlay, useIndicatorSeries } from '@/features/indicators/overlays';
import { useOverlaySpecs } from '@/features/indicators/use-overlay-specs';
import { PriceChart } from './PriceChart';
import { useDeleteInstrument, useInstrument, type Instrument } from './queries';

function BackLink() {
  return (
    <Link to="/app/instruments" className="text-sm text-muted-foreground hover:text-foreground">
      &larr; Instruments
    </Link>
  );
}

const isNotAvailable = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

function NotAvailable() {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
        <CircleSlash className="size-6" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Instrument not available</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This instrument does not exist or was deleted.
      </p>
      <Button asChild className="mt-6">
        <Link to="/app/instruments">Back to instruments</Link>
      </Button>
    </div>
  );
}

/** The selected range lives in the address (?from=YYYY-MM-DD&to=YYYY-MM-DD). */
function useRange() {
  const [params, setParams] = useSearchParams();
  const value = { start: params.get('from') ?? '', end: params.get('to') ?? '' };
  const set = (next: { start: string; end: string }) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [key, v] of [
          ['from', next.start],
          ['to', next.end],
        ] as const) {
          if (v) p.set(key, v);
          else p.delete(key);
        }
        return p;
      },
      { replace: true },
    );
  return { value, set };
}

function DataTableView({ bars }: { bars: Bar[] }) {
  return (
    <div className="max-h-96 overflow-auto rounded-lg border">
      <Table>
        <caption className="sr-only">Daily bars</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Open</TableHead>
            <TableHead className="text-right">High</TableHead>
            <TableHead className="text-right">Low</TableHead>
            <TableHead className="text-right">Close</TableHead>
            <TableHead className="text-right">Volume</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bars.map((b) => (
            <TableRow key={b.time}>
              <TableCell className="tabular-nums">{formatDate(b.time)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(b.open)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(b.high)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(b.low)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(b.close)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(b.volume, 0)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function HistoricalData({ instrument }: { instrument: Instrument }) {
  const range = useRange();
  const overlays = useOverlaySpecs();
  const today = todayIst();
  const error = rangeError(range.value, today);
  // An invalid range is not sent; the last valid one stays on screen.
  const applied: DateRange = error
    ? {}
    : { start: range.value.start || undefined, end: range.value.end || undefined };
  const data = useMarketData(instrument.id, applied);
  const coverage = useCoverage(instrument.id, applied);
  const allCoverage = useCoverage(instrument.id, {});
  const bars = useMemo(() => toBars(data.data ?? []), [data.data]);
  const seriesQueries = useIndicatorSeries(instrument.id, overlays.specs, applied);
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
  const [mode, setMode] = useState<'candles' | 'line'>('candles');
  const [showTable, setShowTable] = useState(false);
  const provider = providerLabel(
    coverage.data?.provider ?? allCoverage.data?.provider ?? 'yahoo_finance',
  );
  const lastStored = allCoverage.data?.last_timestamp
    ? istDate(allCoverage.data.last_timestamp)
    : undefined;

  return (
    <section aria-labelledby="data-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="data-heading" className="text-lg font-semibold">
            Historical data
          </h2>
          <p className="text-sm text-muted-foreground">
            Historical &middot; daily &middot; source: {provider}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DateRangeField value={range.value} onChange={range.set} max={today} error={error} />
          <Button
            variant="ghost"
            onClick={() => range.set({ start: '', end: '' })}
            disabled={!range.value.start && !range.value.end}
          >
            All data
          </Button>
          <div className="space-y-1">
            <p className="text-sm font-medium">Frequency</p>
            <p className="flex h-9 items-center text-sm text-muted-foreground">Daily (1D)</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-3 sm:p-4">
        {data.isPending ? (
          <Skeleton className="h-80 w-full sm:h-96" />
        ) : data.isError ? (
          <ErrorState error={data.error} onRetry={() => void data.refetch()} />
        ) : bars.length === 0 ? (
          <EmptyState
            title="No data for this range"
            description={
              allCoverage.data?.row_count
                ? 'There are no stored bars between these dates. Choose another range, or import data for it below.'
                : 'Nothing is stored for this instrument yet. Import historical data below.'
            }
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground tabular-nums">
                {formatDate(bars[0]!.time)} to {formatDate(bars[bars.length - 1]!.time)} &middot;{' '}
                {formatNumber(bars.length, 0)} daily bars
              </span>
              <div className="flex gap-1" role="group" aria-label="Chart type">
                <Button
                  size="sm"
                  variant={mode === 'candles' ? 'secondary' : 'ghost'}
                  aria-pressed={mode === 'candles'}
                  onClick={() => setMode('candles')}
                >
                  <CandlestickChart /> Candles
                </Button>
                <Button
                  size="sm"
                  variant={mode === 'line' ? 'secondary' : 'ghost'}
                  aria-pressed={mode === 'line'}
                  onClick={() => setMode('line')}
                >
                  <LineChart /> Line
                </Button>
              </div>
            </div>
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
              label={`${instrument.symbol} daily ${mode === 'candles' ? 'candlestick' : 'close price'} chart with volume, ${bars.length} bars from ${formatDate(bars[0]!.time)} to ${formatDate(bars[bars.length - 1]!.time)}${chartOverlays.length ? `, with ${chartOverlays.map((o) => o.label).join(', ')}` : ''}`}
            />
            <Button variant="outline" size="sm" onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Hide data table' : `Show data table (${bars.length} rows)`}
            </Button>
            {showTable && <DataTableView bars={bars} />}
          </div>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {coverage.isPending ? (
          <LoadingState rows={6} />
        ) : coverage.isError ? (
          <ErrorState error={coverage.error} onRetry={() => void coverage.refetch()} />
        ) : (
          <>
            <CoveragePanel coverage={coverage.data} />
            <QualityPanel coverage={coverage.data} />
          </>
        )}
      </div>

      {/* Mounted once the stored range is known, so the start date can default to the last
          stored day. Not re-keyed afterwards: the import result stays visible. */}
      {!allCoverage.isPending && (
        <ImportDataCard instrument={instrument} lastStoredDay={lastStored} />
      )}
    </section>
  );
}

/** /app/instruments/:id - one instrument, its stored daily data, coverage and quality. */
export default function InstrumentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useInstrument(id);
  const remove = useDeleteInstrument();

  if (query.isError && isNotAvailable(query.error)) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <BackLink />
        <NotAvailable />
      </div>
    );
  }
  if (!query.isSuccess) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
        <BackLink />
        <h1 className="text-2xl font-semibold tracking-tight">Instrument</h1>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <LoadingState rows={6} />
        )}
      </div>
    );
  }

  const instrument = query.data;
  const onDelete = async () => {
    try {
      await remove.mutateAsync(instrument);
      navigate('/app/instruments', { replace: true });
    } catch (error) {
      // 409: it has stored data or trades; the backend says to deactivate instead.
      toast.error((error as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{instrument.symbol}</h1>
          <p className="text-muted-foreground">{instrument.name}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge kind="active" value={instrument.is_active} />
            <span>{exchangeLabel(instrument.exchange)}</span>
            <span aria-hidden>&middot;</span>
            <span>{instrumentTypeLabel(instrument.instrument_type)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <InstrumentFormDialog
            target={{ kind: 'edit', instrument }}
            trigger={
              <Button variant="outline">
                <Pencil /> Edit
              </Button>
            }
          />
          <ConfirmDialog
            trigger={
              <Button variant="outline">
                <Trash2 /> Delete
              </Button>
            }
            title={`Delete ${instrument.symbol}?`}
            description="Only an instrument with no stored price data or trades can be deleted. Otherwise, deactivate it instead."
            confirmLabel="Delete instrument"
            onConfirm={onDelete}
          />
        </div>
      </div>

      <dl className="grid gap-4 rounded-xl border bg-card p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Trading symbol', instrument.trading_symbol],
          ['ISIN', instrument.isin || MISSING],
          ['Lot size', formatNumber(instrument.lot_size, 0)],
          ['Tick size', formatNumber(instrument.tick_size, 2)],
          ['Added', formatDateTime(instrument.created_at)],
          ['Last changed', formatDateTime(instrument.updated_at)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <HistoricalData instrument={instrument} />
    </div>
  );
}
