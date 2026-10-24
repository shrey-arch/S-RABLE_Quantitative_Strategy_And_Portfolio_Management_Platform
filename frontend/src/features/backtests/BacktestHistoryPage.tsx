import { ChartLine, Play } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { DateRangeField } from '@/components/ui/date-range-field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { todayIst, istDate } from '@/features/instruments/market-data';
import { useInstruments } from '@/features/instruments/queries';
import { coreInfo } from '@/features/strategies/core-strategies';
import { useMyStrategies } from '@/features/strategies/queries';
import { EXECUTION_STATUSES } from '@/lib/enums';
import { formatDate, formatDateTime, humanize, MISSING } from '@/lib/format';
import {
  duration,
  endOfDay,
  isTerminal,
  POLL_MS,
  runSettings,
  startOfDay,
  type Execution,
} from './backtest-model';
import { useExecutions, type ExecutionFilters } from './queries';

const FILTER_KEYS = ['status', 'type', 'strategy', 'instrument', 'from', 'to'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/** Filters live in the address (?status=FAILED&strategy=...&from=2026-10-01). */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const value = (key: FilterKey) => params.get(key) ?? '';
  const set = (changes: Partial<Record<FilterKey, string>>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, v] of Object.entries(changes)) {
          if (v) next.set(key, v);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  const active = FILTER_KEYS.some((k) => params.get(k));
  return { value, set, active, clear: () => setParams({}, { replace: true }) };
}

function Filter(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <NativeSelect
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-44"
    >
      {props.children}
    </NativeSelect>
  );
}

interface Row {
  execution: Execution;
  strategy: string;
  template: string;
  instruments: string;
  dates: string;
}

const columns: ColumnDef<Row, unknown>[] = [
  {
    id: 'created',
    header: 'Created',
    accessorFn: (r) => r.execution.created_at,
    cell: ({ row }) => (
      <Link
        to={`/app/backtests/${row.original.execution.id}`}
        className="font-medium whitespace-nowrap text-primary tabular-nums hover:underline"
      >
        {formatDateTime(row.original.execution.created_at)}
      </Link>
    ),
  },
  { accessorKey: 'strategy', header: 'Strategy' },
  { accessorKey: 'template', header: 'Template' },
  { accessorKey: 'instruments', header: 'Instruments' },
  {
    accessorKey: 'dates',
    header: 'Dates',
    cell: ({ row }) => <span className="whitespace-nowrap">{row.original.dates}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    accessorFn: (r) => r.execution.status,
    cell: ({ row }) => <StatusBadge kind="execution" value={row.original.execution.status} />,
  },
  {
    id: 'took',
    header: 'Ran for',
    enableSorting: false,
    cell: ({ row }) =>
      duration(row.original.execution.started_at, row.original.execution.completed_at) ?? MISSING,
  },
  {
    id: 'outcome',
    header: 'Results',
    enableSorting: false,
    cell: ({ row }) => {
      const e = row.original.execution;
      if (e.status === 'COMPLETED')
        return (
          <Link
            to={`/app/executions/${e.id}/results`}
            className="inline-flex items-center gap-1 font-medium whitespace-nowrap text-primary hover:underline"
          >
            <ChartLine aria-hidden className="size-4" /> View results
          </Link>
        );
      if (e.status === 'FAILED')
        return (
          <code className="block max-w-48 font-mono text-xs break-all text-destructive">
            {e.error?.code ?? 'Failed'}
          </code>
        );
      return <span className="text-muted-foreground">{MISSING}</span>;
    },
  },
];

/** /app/executions - the user's backtests, newest first, with filters. */
export default function BacktestHistoryPage() {
  const filters = useFilters();
  const from = filters.value('from');
  const to = filters.value('to');
  const apiFilters: ExecutionFilters = {
    status: (filters.value('status') || undefined) as ExecutionFilters['status'],
    // Validation runs are listed on the Validation page, not here.
    execution_type: 'BACKTEST',
    strategy_id: filters.value('strategy') || undefined,
    instrument_id: filters.value('instrument') || undefined,
    created_from: from ? startOfDay(from) : undefined,
    created_to: to ? endOfDay(to) : undefined,
  };
  const query = useExecutions(apiFilters);
  const strategies = useMyStrategies().data;
  const instruments = useInstruments().data;

  const rows = useMemo<Row[]>(() => {
    const strategyName = new Map((strategies ?? []).map((s) => [s.id, s.name]));
    const symbol = new Map((instruments ?? []).map((i) => [i.id, i.symbol]));
    return (query.data ?? []).map((execution) => {
      const rs = runSettings(execution);
      const ids = [execution.instrument_id, ...(rs.other_instrument_ids ?? [])].filter(
        (v): v is string => Boolean(v),
      );
      return {
        execution,
        strategy: strategyName.get(execution.strategy_id) ?? (strategies ? 'Deleted strategy' : ''),
        template: rs.strategy_key ? coreInfo(rs.strategy_key).name : MISSING,
        instruments: ids.map((id) => symbol.get(id) ?? '...').join(', ') || MISSING,
        dates:
          rs.start_timestamp && rs.end_timestamp
            ? `${formatDate(istDate(rs.start_timestamp))} to ${formatDate(istDate(rs.end_timestamp))}`
            : 'All stored data',
      };
    });
  }, [query.data, strategies, instruments]);

  const running = (query.data ?? []).some((e) => !isTerminal(e.status));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title text-3xl">Backtest history</h1>
            <SimulationLabel kind="historical" />
          </div>
          <p className="text-sm text-muted-foreground">
            Your backtests, newest first. Open one to see its timeline and settings.
          </p>
        </div>
        <Button asChild>
          <Link to="/app/backtests/new">
            <Play /> New backtest
          </Link>
        </Button>
      </div>

      <div role="group" aria-label="Filters" className="flex flex-wrap items-end gap-3">
        <Filter
          label="Status"
          value={filters.value('status')}
          onChange={(v) => filters.set({ status: v })}
        >
          <NativeSelectOption value="">All statuses</NativeSelectOption>
          {EXECUTION_STATUSES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {humanize(s)}
            </NativeSelectOption>
          ))}
        </Filter>
        <Filter
          label="Strategy"
          value={filters.value('strategy')}
          onChange={(v) => filters.set({ strategy: v })}
        >
          <NativeSelectOption value="">All strategies</NativeSelectOption>
          {(strategies ?? []).map((s) => (
            <NativeSelectOption key={s.id} value={s.id}>
              {s.name}
            </NativeSelectOption>
          ))}
        </Filter>
        <Filter
          label="Instrument"
          value={filters.value('instrument')}
          onChange={(v) => filters.set({ instrument: v })}
        >
          <NativeSelectOption value="">All instruments</NativeSelectOption>
          {(instruments ?? []).map((i) => (
            <NativeSelectOption key={i.id} value={i.id}>
              {i.symbol}
            </NativeSelectOption>
          ))}
        </Filter>
        <DateRangeField
          labels={{ start: 'Created from', end: 'Created to' }}
          value={{ start: from, end: to }}
          max={todayIst()}
          onChange={(range) => filters.set({ from: range.start, to: range.end })}
        />
        {filters.active && (
          <Button variant="ghost" size="sm" onClick={filters.clear}>
            Clear filters
          </Button>
        )}
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {query.isSuccess && (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {`${rows.length} ${rows.length === 1 ? 'backtest' : 'backtests'}`}
              {running
                ? `. Some are still running; this list checks every ${POLL_MS / 1000} seconds.`
                : '.'}
            </p>
          )}
          <DataTable
            caption="Backtests"
            columns={columns}
            data={rows}
            loading={query.isPending}
            empty={
              filters.active ? (
                <EmptyState
                  title="No backtests match these filters"
                  action={
                    <Button variant="outline" onClick={filters.clear}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="No backtests yet"
                  description="Run a strategy on historical data; it will be listed here."
                  action={
                    <Button asChild>
                      <Link to="/app/backtests/new">New backtest</Link>
                    </Button>
                  }
                />
              )
            }
          />
        </>
      )}
    </div>
  );
}
