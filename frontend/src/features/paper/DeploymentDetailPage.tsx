import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, CircleSlash, Pause, Play, Square } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { MoneyText } from '@/components/ui/value-text';
import { Row, Section } from '@/features/results/parts';
import { EquityChart } from '@/features/results/ResultsCharts';
import { RulesSummary } from '@/features/strategies/RulesSummary';
import { formatDate, formatDateTime, formatINR, formatPercent, MISSING } from '@/lib/format';
import { PerformanceTiles } from './DeploymentViews';
import {
  dayOrderText,
  DEPLOY_NOTE,
  DEPLOYMENT_ACTION_LABELS,
  deploymentActions,
  PAPER_LABEL,
  type DeploymentAction,
  type PaperDeploymentDay,
  type PaperDeploymentDetail,
} from './paper-model';
import { isNotFound, useDeployment, useDeploymentAction } from './queries';

function BackLink() {
  return (
    <Link
      to="/app/live?tab=deployments"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden /> Live Trading (Paper)
    </Link>
  );
}

function NotAvailable() {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
        <CircleSlash className="size-6" />
      </span>
      <h1 className="mt-4 page-title text-3xl">Paper deployment not available</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This deployment does not exist, or it belongs to another account.
      </p>
      <Button asChild className="mt-6">
        <Link to="/app/live?tab=deployments">Back to paper trading</Link>
      </Button>
    </div>
  );
}

const ICONS: Record<DeploymentAction, typeof Pause> = { pause: Pause, resume: Play, stop: Square };

function Controls({ dep }: { dep: PaperDeploymentDetail }) {
  const action = useDeploymentAction();
  const run = async (a: DeploymentAction) => {
    try {
      const out = await action.mutateAsync({ id: dep.id, action: a });
      toast.success(`${out.name}: ${out.status.toLowerCase()}.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {deploymentActions(dep.status).map((a) => {
        const Icon = ICONS[a];
        return a === 'stop' ? (
          <ConfirmDialog
            key={a}
            trigger={
              <Button variant="outline" disabled={action.isPending}>
                <Icon /> {DEPLOYMENT_ACTION_LABELS[a]}
              </Button>
            }
            title="Stop this deployment?"
            description="It stops trading for good; its holdings stay in the account. A stopped validation deployment fails stage 5."
            confirmLabel="Stop deployment"
            destructive
            onConfirm={() => run(a)}
          />
        ) : (
          <Button key={a} variant="outline" disabled={action.isPending} onClick={() => run(a)}>
            <Icon /> {DEPLOYMENT_ACTION_LABELS[a]}
          </Button>
        );
      })}
    </div>
  );
}

function DaysTable({ dep }: { dep: PaperDeploymentDetail }) {
  const symbol = useMemo(
    () => new Map(dep.instruments.map((i) => [i.id, i.symbol] as const)),
    [dep.instruments],
  );
  const columns = useMemo<ColumnDef<PaperDeploymentDay>[]>(
    () => [
      {
        id: 'day',
        header: 'Close',
        accessorFn: (d) => d.day,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDate(row.original.day)}</span>
        ),
      },
      {
        id: 'closes',
        header: 'Prices',
        enableSorting: false,
        accessorFn: (d) =>
          Object.entries(d.closes)
            .map(([id, c]) => `${symbol.get(id) ?? id} ${c === null ? MISSING : formatINR(c)}`)
            .join(', '),
      },
      {
        id: 'signal',
        header: 'Decision',
        enableSorting: false,
        accessorFn: (d) =>
          d.allocations
            ? Object.entries(d.allocations)
                .map(([id, w]) => `${symbol.get(id) ?? id} ${formatPercent(w)}`)
                .join(', ')
            : (d.signal ?? MISSING),
      },
      {
        id: 'orders',
        header: 'Orders',
        enableSorting: false,
        accessorFn: (d) => d.orders.length,
        cell: ({ row }) =>
          row.original.orders.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            <ul className="space-y-0.5 text-xs">
              {row.original.orders.map((o, i) => (
                <li key={i}>{dayOrderText(o)}</li>
              ))}
            </ul>
          ),
      },
      {
        id: 'equity',
        header: 'Value',
        accessorFn: (d) => d.equity,
        cell: ({ row }) => <MoneyText value={row.original.equity} />,
      },
      {
        id: 'cash',
        header: 'Cash',
        accessorFn: (d) => d.cash,
        cell: ({ row }) => <MoneyText value={row.original.cash} />,
      },
      {
        id: 'drawdown',
        header: 'Drawdown',
        accessorFn: (d) => d.drawdown,
        cell: ({ row }) =>
          row.original.drawdown === null ? MISSING : formatPercent(row.original.drawdown),
      },
      {
        id: 'note',
        header: 'Note',
        enableSorting: false,
        accessorFn: (d) => d.note ?? '',
        cell: ({ row }) => (
          <span className="block max-w-64 text-xs text-muted-foreground">{row.original.note}</span>
        ),
      },
    ],
    [symbol],
  );
  return (
    <DataTable
      caption="Daily log"
      columns={columns}
      data={dep.days}
      empty={
        <EmptyState
          title="No closes traded yet"
          description={`The daily job trades from ${formatDate(dep.start_date)}, after that session's close.`}
        />
      }
    />
  );
}

function Detail({ dep }: { dep: PaperDeploymentDetail }) {
  const points = useMemo(
    () =>
      [...dep.days]
        .filter((d) => d.equity !== null)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((d) => ({ time: d.day, value: d.equity! })),
    [dep.days],
  );
  const symbol = new Map(dep.instruments.map((i) => [i.id, i.symbol] as const));
  const holdings = Object.entries(dep.holdings).filter(([, q]) => q > 0);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="page-title text-3xl">{dep.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge kind="paperDeployment" value={dep.status} />
            <span>{dep.instruments.map((i) => i.symbol).join(', ')}</span>
            {dep.validation_id && (
              <Link
                to={`/app/validation/${dep.validation_id}?tab=paper_trading`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Validation stage 5
              </Link>
            )}
          </div>
          {dep.status_reason && <p className="text-sm">{dep.status_reason}</p>}
          <p className="inline-flex rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
            {PAPER_LABEL}
          </p>
        </div>
        <Controls dep={dep} />
      </div>

      <PerformanceTiles performance={dep.performance} label="Deployment performance" />

      <Section
        id="dep-equity"
        title="Value at each close"
        description="The deployment's own cash plus its holdings at the close, as the daily job recorded them."
      >
        {points.length === 0 ? (
          <EmptyState title="No closes traded yet" description={DEPLOY_NOTE} />
        ) : (
          <EquityChart
            strategy={points}
            benchmark={null}
            benchmarkLabel=""
            seriesLabel="Deployment"
            label={`Deployment value at each close, ${points.length} closes`}
          />
        )}
      </Section>

      <Section id="dep-log" title="Daily log" description={DEPLOY_NOTE}>
        <DaysTable dep={dep} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="dep-position" title="Position">
          <dl className="divide-y text-sm">
            <Row label="Cash">
              <MoneyText value={dep.cash} />
            </Row>
            {holdings.length === 0 ? (
              <Row label="Holdings">None</Row>
            ) : (
              holdings.map(([id, q]) => (
                <Row key={id} label={symbol.get(id) ?? id}>
                  {`${q} shares`}
                </Row>
              ))
            )}
            <Row label="Loss-limit breaches">{String(dep.breaches)}</Row>
          </dl>
        </Section>
        <Section id="dep-config" title="Configuration">
          <dl className="divide-y text-sm">
            <Row label="Strategy">
              {dep.strategy_id ? (
                <Link
                  to={`/app/strategies/${dep.strategy_id}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {dep.name}
                </Link>
              ) : (
                'Deleted strategy'
              )}
              {dep.strategy_version !== null && ` (v${dep.strategy_version} at deployment)`}
            </Row>
            {dep.rules ? (
              <Row label="Rules">
                <RulesSummary config={dep.rules} />
              </Row>
            ) : (
              <Row label="Parameters">
                {Object.keys(dep.parameters).length === 0 ? (
                  'Template defaults'
                ) : (
                  <span className="font-mono text-xs">
                    {Object.entries(dep.parameters)
                      .map(([k, v]) => `${k} = ${String(v)}`)
                      .join(', ')}
                  </span>
                )}
              </Row>
            )}
            {dep.layout === 'single' && <Row label="Quantity">{String(dep.quantity)}</Row>}
            <Row label="Capital">{formatINR(dep.capital)}</Row>
            <Row label="Loss limit">
              {dep.loss_limit === null ? 'None' : formatPercent(dep.loss_limit)}
            </Row>
            <Row label="Dates">
              {formatDate(dep.start_date)} to{' '}
              {dep.end_date ? formatDate(dep.end_date) : 'until stopped'}
            </Row>
            <Row label="Last close traded">
              {dep.last_processed_date ? formatDate(dep.last_processed_date) : 'None yet'}
            </Row>
            <Row label="Created">{formatDateTime(dep.created_at)}</Row>
            {dep.completed_at && <Row label="Ended">{formatDateTime(dep.completed_at)}</Row>}
          </dl>
        </Section>
      </div>
    </>
  );
}

/** /app/live/deployments/:id - one strategy deployment on the paper account. */
export default function DeploymentDetailPage() {
  const { id = '' } = useParams();
  const dep = useDeployment(id);
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <BackLink />
      {dep.isError ? (
        isNotFound(dep.error) ? (
          <NotAvailable />
        ) : (
          <ErrorState error={dep.error} onRetry={() => void dep.refetch()} />
        )
      ) : !dep.data ? (
        <LoadingState rows={5} />
      ) : (
        <Detail dep={dep.data} />
      )}
    </div>
  );
}
