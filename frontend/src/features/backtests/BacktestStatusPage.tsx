import {
  ChartLine,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Loader2,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { useInstruments } from '@/features/instruments/queries';
import { coreInfo } from '@/features/strategies/core-strategies';
import { useRegistry, useStrategy } from '@/features/strategies/queries';
import { RulesSummary } from '@/features/strategies/RulesSummary';
import {
  formatDate,
  formatDateTime,
  formatINR,
  formatNumber,
  humanize,
  MISSING,
} from '@/lib/format';
import { istDate } from '@/features/instruments/market-data';
import {
  duration,
  isTerminal,
  POLL_MS,
  runSettings,
  slotLabel,
  timeline,
  type Execution,
  type TimelineStep,
} from './backtest-model';
import { useCancelExecution, useExecution } from './queries';

const isNotAvailable = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

function Shell(props: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">{props.children}</div>;
}

function NotAvailable() {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
        <CircleSlash className="size-6" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Backtest not available</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This backtest does not exist, or it belongs to another account.
      </p>
      <Button asChild className="mt-6">
        <Link to="/app/backtests/new">Start a new backtest</Link>
      </Button>
    </div>
  );
}

/** /app/backtests/:id - one run, as the backend reports it, refreshed while it runs. */
export default function BacktestStatusPage() {
  const { id = '' } = useParams();
  const query = useExecution(id);

  if (query.isError && isNotAvailable(query.error)) {
    return (
      <Shell>
        <NotAvailable />
      </Shell>
    );
  }
  if (!query.data) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Backtest</h1>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <LoadingState rows={6} />
        )}
      </Shell>
    );
  }
  return (
    <Shell>
      <ExecutionView execution={query.data} refreshError={query.isError ? query.error : null} />
    </Shell>
  );
}

const STEP_ICON: Record<TimelineStep['state'], React.ReactNode> = {
  done: <CircleCheck aria-hidden className="size-4 text-success" />,
  current: <Loader2 aria-hidden className="size-4 animate-spin text-info" />,
  upcoming: <CircleDashed aria-hidden className="size-4 text-muted-foreground" />,
  skipped: <X aria-hidden className="size-4 text-muted-foreground" />,
};

const STEP_STATE: Record<TimelineStep['state'], string> = {
  done: 'done',
  current: 'in progress',
  upcoming: 'not yet',
  skipped: 'skipped',
};

/** The job's lifecycle (created, started, finished), shared by backtests and validations. */
export function Timeline({
  execution,
}: {
  execution: Pick<Execution, 'status' | 'created_at' | 'started_at' | 'completed_at'>;
}) {
  const steps = timeline(execution);
  const last = steps[steps.length - 1]!;
  const failed = execution.status === 'FAILED';
  return (
    <ol aria-label="Timeline" className="space-y-3">
      {steps.map((step) => (
        <li key={step.label} className="flex items-start gap-3">
          <span className="mt-0.5">
            {step === last && failed ? (
              <X aria-hidden className="size-4 text-destructive" />
            ) : step === last && execution.status === 'CANCELLED' ? (
              <Square aria-hidden className="size-4 text-warning" />
            ) : (
              STEP_ICON[step.state]
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {step.label}
              <span className="sr-only"> ({STEP_STATE[step.state]})</span>
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {step.at ? formatDateTime(step.at) : (step.note ?? MISSING)}
              {step.at && step.note ? ` \u00b7 ${step.note}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 break-words">{props.children}</dd>
    </div>
  );
}

function ExecutionView({
  execution,
  refreshError,
}: {
  execution: Execution;
  refreshError: unknown;
}) {
  const strategy = useStrategy(execution.strategy_id);
  const instruments = useInstruments().data;
  const registry = useRegistry();
  const cancel = useCancelExecution();
  const rs = runSettings(execution);
  const active = !isTerminal(execution.status);
  const key = rs.strategy_key ?? null;
  const layout = registry.data?.find((e) => e.strategy_key === key)?.instruments ?? 'single';
  const ids = [execution.instrument_id, ...(rs.other_instrument_ids ?? [])].filter(
    (v): v is string => Boolean(v),
  );
  const symbol = (id: string) => instruments?.find((i) => i.id === id)?.symbol ?? id;
  const params = Object.entries(execution.execution_config ?? {});
  const took = duration(execution.started_at, execution.completed_at);

  const onCancel = async () => {
    try {
      await cancel.mutateAsync(execution.id);
      toast.success('Backtest cancelled.');
    } catch (error) {
      // 409: it finished first. The page reloads the run and shows how it ended.
      toast.error((error as Error).message);
    }
  };

  const strategyName = strategy.data?.name;

  return (
    <>
      <Link to="/app/executions" className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Backtest history
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Backtest</h1>
            <StatusBadge kind="execution" value={execution.status} />
            <SimulationLabel kind="historical" />
          </div>
          <p className="text-sm text-muted-foreground">
            {strategyName ? (
              <Link
                to={`/app/strategies/${execution.strategy_id}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {strategyName}
              </Link>
            ) : strategy.isError ? (
              'Strategy no longer available'
            ) : (
              'Loading strategy...'
            )}
            {key ? ` \u00b7 ${coreInfo(key).name}` : ''} &middot; created{' '}
            {formatDateTime(execution.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {active && (
            <ConfirmDialog
              trigger={
                <Button variant="outline">
                  <Square /> Cancel backtest
                </Button>
              }
              title="Cancel this backtest?"
              description="The run is stopped and marked Cancelled. It cannot be resumed; you can run it again later."
              confirmLabel="Cancel backtest"
              onConfirm={onCancel}
            />
          )}
          {execution.status === 'COMPLETED' && (
            <Button asChild>
              <Link to={`/app/executions/${execution.id}/results`}>
                <ChartLine /> View results
              </Link>
            </Button>
          )}
          <Button
            asChild
            variant={active ? 'ghost' : execution.status === 'COMPLETED' ? 'outline' : 'default'}
          >
            <Link to={`/app/backtests/new?from=${encodeURIComponent(execution.id)}`}>
              <RotateCcw /> Edit and rerun
            </Link>
          </Button>
        </div>
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {active
          ? `Status: ${humanize(execution.status)}. This page checks for updates every ${POLL_MS / 1000} seconds.`
          : `Status: ${humanize(execution.status)}. This is final.`}
      </p>
      {Boolean(refreshError) && active && (
        <p role="alert" className="text-sm text-destructive">
          Could not refresh the status. Retrying...
        </p>
      )}

      <section
        aria-labelledby="timeline-heading"
        className="space-y-4 rounded-xl border bg-card p-4 sm:p-6"
      >
        <h2 id="timeline-heading" className="font-semibold">
          Timeline
        </h2>
        <Timeline execution={execution} />
        {took && <p className="text-xs text-muted-foreground">Ran for {took}.</p>}
      </section>

      {execution.status === 'FAILED' && (
        <section
          aria-labelledby="error-heading"
          className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-6"
        >
          <h2 id="error-heading" className="font-semibold text-destructive">
            Why it failed
          </h2>
          <dl className="divide-y text-sm">
            <Row label="Error code">
              <code className="font-mono text-xs">{execution.error?.code ?? MISSING}</code>
            </Row>
            <Row label="Category">{execution.error?.category ?? MISSING}</Row>
            <Row label="Stage">
              {execution.error?.stage ? humanize(execution.error.stage) : MISSING}
            </Row>
            <Row label="Message">
              {execution.error?.message ?? execution.error_message ?? MISSING}
            </Row>
          </dl>
        </section>
      )}

      {execution.status === 'COMPLETED' && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 p-3 text-sm">
          The backtest finished.{' '}
          <Link
            to={`/app/executions/${execution.id}/results`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            See its results
          </Link>
          (metrics, equity curve, trades and records).
        </p>
      )}

      <section
        aria-labelledby="config-heading"
        className="space-y-3 rounded-xl border bg-card p-4 sm:p-6"
      >
        <h2 id="config-heading" className="font-semibold">
          Configuration
        </h2>
        <dl className="divide-y text-sm">
          <Row label={ids.length > 1 ? 'Instruments' : 'Instrument'}>
            {ids.length === 0 ? (
              MISSING
            ) : (
              <ul className="space-y-0.5">
                {ids.map((id, index) => (
                  <li key={id}>
                    {ids.length > 1 && `${slotLabel(layout, index)}: `}
                    <Link
                      to={`/app/instruments/${id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {symbol(id)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Row>
          <Row label="Timeframe">
            {execution.timeframe === '1D' ? 'Daily (1D)' : execution.timeframe}, historical data
          </Row>
          <Row label="Dates">
            {rs.start_timestamp || rs.end_timestamp
              ? `${rs.start_timestamp ? formatDate(istDate(rs.start_timestamp)) : 'All stored data'} to ${
                  rs.end_timestamp ? formatDate(istDate(rs.end_timestamp)) : 'the last stored bar'
                }`
              : 'All stored data'}
          </Row>
          <Row label="Initial capital">{formatINR(execution.initial_capital)}</Row>
          <Row label="Quantity per trade">
            {rs.quantity !== undefined ? formatNumber(rs.quantity, 0) : MISSING}
          </Row>
          {rs.rules !== undefined && rs.rules !== null ? (
            <Row label="Rules">
              <RulesSummary config={rs.rules} />
            </Row>
          ) : (
            <Row label="Parameters">
              {params.length === 0 ? (
                'Template defaults'
              ) : (
                <span className="font-mono text-xs">
                  {params.map(([k, v]) => `${k} = ${String(v)}`).join(', ')}
                </span>
              )}
            </Row>
          )}
          <Row label="Slippage">
            {rs.slippage_bps !== undefined ? `${formatNumber(rs.slippage_bps, 2)} bps` : MISSING}
          </Row>
          <Row label="Brokerage">
            {rs.brokerage_rate !== undefined
              ? `${formatNumber(rs.brokerage_rate * 100, 4)}% of trade value`
              : MISSING}
          </Row>
          <Row label="Run id">
            <code className="font-mono text-xs">{execution.id}</code>
          </Row>
        </dl>
      </section>
    </>
  );
}
