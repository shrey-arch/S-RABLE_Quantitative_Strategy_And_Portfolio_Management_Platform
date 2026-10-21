import { useQueryClient } from '@tanstack/react-query';
import { CircleSlash, RotateCcw, Square } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { duration, isTerminal, POLL_MS } from '@/features/backtests/backtest-model';
import { Timeline } from '@/features/backtests/BacktestStatusPage';
import { useCancelExecution } from '@/features/backtests/queries';
import { Section } from '@/features/results/parts';
import { formatDate, formatDateTime, humanize, MISSING } from '@/lib/format';
import { cn } from '@/lib/utils';
import { frequencyLabel, type PortfolioBacktestDetail } from './pb-model';
import {
  EquitySection,
  MetricsTable,
  NotesList,
  ObjectivesView,
  RebalanceLog,
  RelativeTable,
  SettingsList,
  SleevesTable,
  WeightsSection,
} from './PortfolioBacktestViews';
import { usePortfolioBacktest, usePortfolioBacktestResults } from './queries';

const TITLE = 'Portfolio backtest';

function Shell(props: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">{props.children}</div>;
}

function BackLink() {
  return (
    <Link
      to="/app/portfolio-backtests"
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      &larr; Portfolio backtests
    </Link>
  );
}

const isMissing = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

/** /app/portfolio-backtests/:id - one run: its job while it runs, then its results. */
export default function PortfolioBacktestPage() {
  const { id = '' } = useParams();
  const query = usePortfolioBacktest(id);

  if (query.isError && isMissing(query.error)) {
    return (
      <Shell>
        <BackLink />
        <h1 className="text-2xl font-semibold tracking-tight">{TITLE}</h1>
        <div className="flex flex-col items-center rounded-xl border px-6 py-12 text-center">
          <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
            <CircleSlash className="size-6" />
          </span>
          <p className="mt-4 font-medium">Portfolio backtest not available</p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            This portfolio backtest does not exist, or it belongs to another account.
          </p>
          <Button asChild className="mt-6">
            <Link to="/app/portfolio-backtests">Portfolio backtests</Link>
          </Button>
        </div>
      </Shell>
    );
  }
  if (!query.data) {
    return (
      <Shell>
        <BackLink />
        <h1 className="text-2xl font-semibold tracking-tight">{TITLE}</h1>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <LoadingState rows={6} />
        )}
      </Shell>
    );
  }
  return <RunView run={query.data} refreshError={query.isError ? query.error : null} />;
}

function RunView({ run, refreshError }: { run: PortfolioBacktestDetail; refreshError: unknown }) {
  const cancel = useCancelExecution();
  const queryClient = useQueryClient();
  const active = !isTerminal(run.status);
  const completed = run.status === 'COMPLETED';
  const results = usePortfolioBacktestResults(run.id, completed);
  const took = duration(run.started_at, run.completed_at);

  const onCancel = async () => {
    try {
      await cancel.mutateAsync(run.id);
      toast.success('Portfolio backtest cancelled.');
    } catch (error) {
      // 409: it finished first; the run is read again and shows how it ended.
      toast.error((error as Error).message);
    } finally {
      void queryClient.invalidateQueries({ queryKey: queryKeys.portfolioBacktests.all });
    }
  };

  return (
    <Shell>
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{run.name}</h1>
            <StatusBadge kind="execution" value={run.status} />
            <SimulationLabel kind="historical" />
          </div>
          <p className="text-sm text-muted-foreground">
            {`${TITLE} \u00b7 ${run.strategy_count} ${run.strategy_count === 1 ? 'strategy' : 'strategies'} \u00b7 ${frequencyLabel(run.frequency)} rebalancing \u00b7 ${formatDate(run.start_date)} to ${formatDate(run.end_date)} \u00b7 against ${run.benchmark_symbol ?? 'a deleted instrument'} \u00b7 created ${formatDateTime(run.created_at)}`}
          </p>
        </div>
        <div role="group" aria-label="Actions" className="flex flex-wrap items-center gap-2">
          {active && (
            <ConfirmDialog
              trigger={
                <Button variant="outline">
                  <Square /> Cancel run
                </Button>
              }
              title="Cancel this portfolio backtest?"
              description="The run is stopped and marked Cancelled. Nothing is stored for it; you can run it again later."
              confirmLabel="Cancel run"
              onConfirm={onCancel}
            />
          )}
          <Button asChild variant={active ? 'ghost' : 'default'}>
            <Link to={`/app/portfolio-backtests/new?from=${encodeURIComponent(run.id)}`}>
              <RotateCcw /> Edit and rerun
            </Link>
          </Button>
        </div>
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {active
          ? `Status: ${humanize(run.status)}. This page checks for updates every ${POLL_MS / 1000} seconds.`
          : `Status: ${humanize(run.status)}. This is final.`}
      </p>
      {Boolean(refreshError) && active && (
        <p role="alert" className="text-sm text-destructive">
          Could not refresh the status. Retrying...
        </p>
      )}

      {run.excluded.length > 0 && (
        <div
          role="note"
          aria-label="Strategies left out"
          className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
        >
          <p className="font-medium">
            {`${run.excluded.length} chosen ${run.excluded.length === 1 ? 'strategy was' : 'strategies were'} left out:`}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {run.excluded.map((e) => (
              <li key={e.strategy_id}>{`${e.name}: ${e.reason}`}</li>
            ))}
          </ul>
        </div>
      )}

      {!completed && (
        <section
          aria-labelledby="job-heading"
          className={cn(
            'space-y-4 rounded-xl border bg-card p-4 sm:p-6',
            run.status === 'FAILED' && 'border-destructive/30',
          )}
        >
          <h2 id="job-heading" className="font-semibold">
            Job
          </h2>
          <Timeline execution={run} />
          {took && <p className="text-xs text-muted-foreground">Ran for {took}.</p>}
          {run.status === 'FAILED' && (
            <dl className="divide-y text-sm">
              <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted-foreground">Message</dt>
                <dd>{run.error_message ?? MISSING}</dd>
              </div>
            </dl>
          )}
        </section>
      )}

      {completed &&
        (results.isError ? (
          <ErrorState error={results.error} onRetry={() => void results.refetch()} />
        ) : !results.data ? (
          <LoadingState rows={6} />
        ) : (
          <>
            <Section
              id="pb-objectives"
              title="Objectives against Nifty 50"
              description={`Over ${results.data.days.length} trading days with ${results.data.rebalance_count} rebalances${took ? `; the run took ${took}` : ''}.`}
            >
              <ObjectivesView results={results.data} />
            </Section>
            <EquitySection results={results.data} />
            <WeightsSection results={results.data} />
            <Section
              id="pb-metrics"
              title="Metrics"
              description="Daily values, 252 trading days a year."
            >
              <MetricsTable results={results.data} />
              <h3 className="pt-2 text-sm font-semibold">Against Nifty 50</h3>
              <RelativeTable results={results.data} />
            </Section>
            <Section
              id="pb-log"
              title="Rebalance log"
              description="On each rebalance day: the regime, the weights set (from scores and regimes on data up to that day, then the risk limits), cash, turnover and cost."
            >
              <RebalanceLog results={results.data} />
            </Section>
            <Section id="pb-notes" title="How these numbers are made">
              <NotesList results={results.data} />
            </Section>
          </>
        ))}

      <Section id="pb-strategies" title="Strategies">
        <SleevesTable detail={run} results={results.data} />
      </Section>
      <Section id="pb-settings" title="Settings">
        <SettingsList detail={run} />
      </Section>
    </Shell>
  );
}
