import type { ColumnDef } from '@tanstack/react-table';
import { CircleCheck, CircleX, Play } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { isTerminal, POLL_MS } from '@/features/backtests/backtest-model';
import { formatDate, formatDateTime, formatPercent, MISSING } from '@/lib/format';
import { frequencyLabel, type PortfolioBacktestSummary } from './pb-model';
import { usePortfolioBacktests } from './queries';

function Met(props: { met: boolean; label: string }) {
  return (
    <span
      className={
        props.met
          ? 'inline-flex items-center gap-1 text-success'
          : 'inline-flex items-center gap-1 text-destructive'
      }
    >
      {props.met ? (
        <CircleCheck aria-hidden className="size-4" />
      ) : (
        <CircleX aria-hidden className="size-4" />
      )}
      {`${props.label} ${props.met ? 'met' : 'not met'}`}
    </span>
  );
}

const columns: ColumnDef<PortfolioBacktestSummary>[] = [
  {
    id: 'created',
    header: 'Created',
    accessorFn: (r) => r.created_at,
    cell: ({ row }) => (
      <Link
        to={`/app/portfolio-backtests/${row.original.id}`}
        className="font-medium whitespace-nowrap text-primary hover:underline"
      >
        {formatDateTime(row.original.created_at)}
      </Link>
    ),
  },
  { id: 'name', header: 'Name', accessorFn: (r) => r.name },
  {
    id: 'status',
    header: 'Status',
    accessorFn: (r) => r.status,
    cell: ({ row }) => <StatusBadge kind="execution" value={row.original.status} />,
  },
  {
    id: 'period',
    header: 'Period',
    accessorFn: (r) => r.start_date,
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{`${formatDate(row.original.start_date)} to ${formatDate(row.original.end_date)}`}</span>
    ),
  },
  { id: 'frequency', header: 'Rebalancing', accessorFn: (r) => frequencyLabel(r.frequency) },
  {
    id: 'strategies',
    header: 'Strategies',
    accessorFn: (r) => r.strategy_count,
    meta: { align: 'right' },
  },
  {
    id: 'return',
    header: 'Return (Nifty 50)',
    accessorFn: (r) => r.headline?.portfolio_return ?? null,
    cell: ({ row }) => {
      const h = row.original.headline;
      return h ? (
        <span className="whitespace-nowrap tabular-nums">{`${formatPercent(h.portfolio_return)} (${formatPercent(h.nifty_return)})`}</span>
      ) : (
        <span className="text-muted-foreground">{MISSING}</span>
      );
    },
    meta: { align: 'right' },
  },
  {
    id: 'objectives',
    header: 'Objectives',
    enableSorting: false,
    cell: ({ row }) => {
      const h = row.original.headline;
      if (!h) return <span className="text-muted-foreground">{MISSING}</span>;
      return (
        <span className="flex flex-col gap-0.5 text-xs">
          <Met met={h.sharpe_met} label="Sharpe" />
          <Met met={h.drawdown_met} label="Drawdown" />
        </span>
      );
    },
  },
];

/** /app/portfolio-backtests - the user's portfolio backtests against Nifty 50, newest first. */
export default function PortfolioBacktestsPage() {
  const query = usePortfolioBacktests();
  const rows = query.data ?? [];
  const running = rows.some((r) => !isTerminal(r.status));
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Portfolio backtests</h1>
            <SimulationLabel kind="historical" />
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Your strategies run together as one portfolio, rebalanced weekly or monthly from their
            scores and the market regime, against Nifty 50 bought and held. Newest first.
          </p>
        </div>
        <Button asChild>
          <Link to="/app/portfolio-backtests/new">
            <Play /> New portfolio backtest
          </Link>
        </Button>
      </div>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {query.isSuccess && (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {`${rows.length} ${rows.length === 1 ? 'portfolio backtest' : 'portfolio backtests'}`}
              {running
                ? `. Some are still running; this list checks every ${POLL_MS / 1000} seconds.`
                : '.'}
            </p>
          )}
          <DataTable
            caption="Portfolio backtests"
            columns={columns}
            data={query.data}
            loading={query.isPending}
            empty={
              <EmptyState
                title="No portfolio backtests yet"
                description="Backtest your strategies together as one portfolio against Nifty 50; every run is listed here."
                action={
                  <Button asChild>
                    <Link to="/app/portfolio-backtests/new">New portfolio backtest</Link>
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
