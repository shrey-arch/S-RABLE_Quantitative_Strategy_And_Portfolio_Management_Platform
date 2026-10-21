import type { ColumnDef } from '@tanstack/react-table';
import { ChartLine, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { isTerminal, POLL_MS } from '@/features/backtests/backtest-model';
import { useInstruments } from '@/features/instruments/queries';
import { formatDateTime, MISSING } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useValidations } from './queries';
import { StageStatusBadge } from './StageViews';
import {
  STAGE_LABELS,
  STAGE_ORDER,
  VERDICT_LABELS,
  VERDICT_TONES,
  type ValidationSummary,
} from './validation-model';

interface Row {
  validation: ValidationSummary;
  instrument: string;
}

const VERDICT_CLASSES = {
  success: 'text-success',
  danger: 'text-destructive',
  warning: 'text-warning',
  info: 'text-info',
  neutral: 'text-muted-foreground',
} as const;

const columns: ColumnDef<Row>[] = [
  {
    id: 'created',
    header: 'Created',
    accessorFn: (r) => r.validation.created_at,
    cell: ({ row }) => (
      <Link
        to={`/app/validation/${row.original.validation.id}`}
        className="font-medium whitespace-nowrap text-primary hover:underline"
      >
        {formatDateTime(row.original.validation.created_at)}
      </Link>
    ),
  },
  {
    id: 'strategy',
    header: 'Strategy',
    accessorFn: (r) => r.validation.strategy_name ?? '',
    cell: ({ row }) => row.original.validation.strategy_name ?? 'Deleted strategy',
  },
  { id: 'instrument', header: 'Instrument', accessorFn: (r) => r.instrument },
  {
    id: 'status',
    header: 'Status',
    accessorFn: (r) => r.validation.status,
    cell: ({ row }) => <StatusBadge kind="execution" value={row.original.validation.status} />,
  },
  {
    id: 'verdict',
    header: 'Verdict',
    accessorFn: (r) => r.validation.verdict.status,
    cell: ({ row }) => {
      const v = row.original.validation.verdict;
      return (
        <span
          className={cn('font-medium', VERDICT_CLASSES[VERDICT_TONES[v.status]])}
          title={v.reason}
        >
          {VERDICT_LABELS[v.status]}
        </span>
      );
    },
  },
  {
    id: 'stages',
    header: 'Stages',
    enableSorting: false,
    cell: ({ row }) => (
      <ul className="flex flex-wrap gap-1">
        {STAGE_ORDER.map((key) => {
          const status = row.original.validation.stage_statuses[key];
          return (
            <li key={key} aria-label={`${STAGE_LABELS[key]}: ${status ?? MISSING}`}>
              {status ? <StageStatusBadge status={status} /> : MISSING}
            </li>
          );
        })}
      </ul>
    ),
  },
  {
    id: 'source',
    header: 'Source backtest',
    enableSorting: false,
    cell: ({ row }) => {
      const source = row.original.validation.source_execution_id;
      return source ? (
        <Link
          to={`/app/executions/${source}/results`}
          className="inline-flex items-center gap-1 whitespace-nowrap text-primary hover:underline"
        >
          <ChartLine aria-hidden className="size-4" /> Results
        </Link>
      ) : (
        <span className="text-muted-foreground">{MISSING}</span>
      );
    },
  },
];

/** /app/validation - the user's validation runs with their verdicts, newest first. */
export default function ValidationHistoryPage() {
  const query = useValidations();
  const instruments = useInstruments().data;
  const rows = useMemo<Row[]>(() => {
    const symbol = new Map((instruments ?? []).map((i) => [i.id, i.symbol]));
    return (query.data ?? []).map((validation) => ({
      validation,
      instrument: validation.instrument_id
        ? (symbol.get(validation.instrument_id) ?? '...')
        : MISSING,
    }));
  }, [query.data, instruments]);
  const running = (query.data ?? []).some((v) => !isTerminal(v.status));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Validation</h1>
            <SimulationLabel kind="historical" />
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Robustness evidence for a strategy: a backtest, walk-forward windows, regime stress and
            Monte Carlo, each judged against the backend&apos;s thresholds. Newest first.
          </p>
        </div>
        <Button asChild>
          <Link to="/app/validation/new">
            <ShieldCheck /> New validation
          </Link>
        </Button>
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {query.isSuccess && (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {`${rows.length} ${rows.length === 1 ? 'validation' : 'validations'}`}
              {running
                ? `. Some are still running; this list checks every ${POLL_MS / 1000} seconds.`
                : '.'}
            </p>
          )}
          <DataTable
            caption="Validations"
            columns={columns}
            data={rows}
            loading={query.isPending}
            empty={
              <EmptyState
                title="No validations yet"
                description="Validate a strategy to see how robust it is; every run is listed here."
                action={
                  <Button asChild>
                    <Link to="/app/validation/new">New validation</Link>
                  </Button>
                }
              />
            }
          />
        </>
      )}
    </div>
  );
}
