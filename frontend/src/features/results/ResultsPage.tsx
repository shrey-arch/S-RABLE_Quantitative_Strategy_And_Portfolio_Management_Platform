import { CircleSlash, RotateCcw, ShieldCheck } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '@/api/errors';
import { AvailabilityTag } from '@/components/ui/availability-tag';
import { Button } from '@/components/ui/button';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isTerminal, POLL_MS, type Execution } from '@/features/backtests/backtest-model';
import { useExecution } from '@/features/backtests/queries';
import { istDate } from '@/features/instruments/market-data';
import { useInstruments } from '@/features/instruments/queries';
import { coreInfo } from '@/features/strategies/core-strategies';
import { formatDate, formatNumber, humanize } from '@/lib/format';
import { ChartsTab } from './ChartsTab';
import { ConfigurationTab } from './ConfigurationTab';
import { useExecutionResults } from './queries';
import {
  isResultTab,
  madeNoTrades,
  RESULT_TABS,
  TAB_LABELS,
  versionChanged,
  type ExecutionResults,
  type ResultTab,
} from './results-model';
import { SummaryTab } from './SummaryTab';
import { RecordsTab, TradesTab } from './TradesTab';
import { StoredRecords } from '@/features/records/StoredRecords';

const TITLE = 'Backtest results';

function Shell(props: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">{props.children}</div>;
}

function Heading(props: { children?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="micro-label">Execution report</p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title text-3xl">{TITLE}</h1>
        <SimulationLabel kind="historical" />
        {props.children}
      </div>
    </div>
  );
}

function BackToRun({ id }: { id: string }) {
  return (
    <Link
      to={`/app/backtests/${id}`}
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      &larr; Backtest
    </Link>
  );
}

/** Not found, or another user's run: the page never says which. */
function NotAvailable() {
  return (
    <Shell>
      <Link to="/app/executions" className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Backtest history
      </Link>
      <Heading />
      <div className="flex flex-col items-center rounded-xl border px-6 py-12 text-center">
        <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
          <CircleSlash className="size-6" />
        </span>
        <p className="mt-4 font-medium">Results not available</p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          This backtest does not exist, or it belongs to another account.
        </p>
        <Button asChild className="mt-6">
          <Link to="/app/executions">Backtest history</Link>
        </Button>
      </div>
    </Shell>
  );
}

const isMissing = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

/** The run has not completed (or ended without a result): say so, and where to go instead. */
function NoResultsYet({ execution }: { execution: Execution }) {
  const active = !isTerminal(execution.status);
  return (
    <Shell>
      <BackToRun id={execution.id} />
      <Heading>
        <StatusBadge kind="execution" value={execution.status} />
      </Heading>
      <div className="space-y-3 rounded-xl border bg-card shadow-card p-4 sm:p-6">
        <p aria-live="polite" className="text-sm">
          {active
            ? `This backtest is ${humanize(execution.status).toLowerCase()}. Results appear here when it completes; this page checks every ${POLL_MS / 1000} seconds.`
            : `This backtest ended ${humanize(execution.status).toLowerCase()}, so it has no results.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to={`/app/backtests/${execution.id}`}>
              {execution.status === 'FAILED' ? 'See why it failed' : 'Open the run'}
            </Link>
          </Button>
          {!active && (
            <Button asChild>
              <Link to={`/app/backtests/new?from=${encodeURIComponent(execution.id)}`}>
                <RotateCcw /> Edit and rerun
              </Link>
            </Button>
          )}
        </div>
      </div>
    </Shell>
  );
}

/** /app/executions/:id/results - the full results of a completed backtest. */
export default function ResultsPage() {
  const { id = '' } = useParams();
  const execution = useExecution(id);
  const completed = execution.data?.status === 'COMPLETED';
  const results = useExecutionResults(id, completed);

  if (execution.isError && isMissing(execution.error)) return <NotAvailable />;
  if (!execution.data) {
    return (
      <Shell>
        <Heading />
        {execution.isError ? (
          <ErrorState error={execution.error} onRetry={() => void execution.refetch()} />
        ) : (
          <LoadingState rows={6} />
        )}
      </Shell>
    );
  }
  if (!completed) return <NoResultsYet execution={execution.data} />;
  if (results.isError && isMissing(results.error)) return <NotAvailable />;
  if (!results.data) {
    return (
      <Shell>
        <BackToRun id={id} />
        <Heading />
        {results.isError ? (
          results.error instanceof ApiError && results.error.status === 409 ? (
            <div role="alert" className="rounded-xl border bg-card shadow-card p-4 text-sm sm:p-6">
              <p className="font-medium">No results for this run</p>
              <p className="mt-1 text-muted-foreground">{results.error.message}</p>
            </div>
          ) : (
            <ErrorState error={results.error} onRetry={() => void results.refetch()} />
          )
        ) : (
          <div role="status" aria-label="Loading results" className="space-y-4">
            <Skeleton className="h-9 w-full max-w-lg" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          </div>
        )}
      </Shell>
    );
  }
  return <ResultsView results={results.data} />;
}

/** The selected tab lives in the address (?tab=charts), so a reload or a link keeps it. */
function useTab(): [ResultTab, (tab: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get('tab');
  const tab = isResultTab(value) ? value : 'summary';
  const set = (next: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'summary') p.delete('tab');
        else p.set('tab', next);
        return p;
      },
      { replace: true },
    );
  return [tab, set];
}

function ResultsView({ results }: { results: ExecutionResults }) {
  const [tab, setTab] = useTab();
  const instruments = useInstruments().data;
  const symbol = (id: string) =>
    instruments?.find((i) => i.id === id)?.symbol ?? (instruments ? id.slice(0, 8) : '...');
  const c = results.configuration;
  const s = results.summary;
  const changed = versionChanged(results);
  const id = results.execution_id;

  return (
    <Shell>
      <BackToRun id={id} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Heading />
          <p className="text-sm text-muted-foreground">
            {c.strategy_name ? (
              <Link
                to={`/app/strategies/${c.strategy_id}`}
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {c.strategy_name}
              </Link>
            ) : (
              'Deleted strategy'
            )}
            {c.strategy_key ? ` \u00b7 ${coreInfo(c.strategy_key).name}` : ''}
            {` \u00b7 ${c.instrument_ids.map(symbol).join(', ')} \u00b7 ${formatDate(istDate(s.first_bar_at))} to ${formatDate(istDate(s.last_bar_at))} \u00b7 ${formatNumber(s.bar_count, 0)} daily bars`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Actions" role="group">
          <Button asChild>
            <Link to={`/app/backtests/new?from=${encodeURIComponent(id)}`}>
              <RotateCcw /> Re-run with changes
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/app/validation/new?from=${encodeURIComponent(id)}`}>
              <ShieldCheck /> Validate this strategy
            </Link>
          </Button>
          <Button variant="outline" disabled>
            Use in portfolio <AvailabilityTag value="planned" />
          </Button>
        </div>
      </div>

      {madeNoTrades(results) && (
        <p role="status" className="rounded-lg border border-info/25 bg-info-soft p-3 text-sm text-info-ink">
          The strategy made no trades in this run. That is a valid result: the capital stayed in
          cash, so the trade statistics are empty.
        </p>
      )}
      {changed && (
        <p role="status" className="rounded-lg border border-warning/35 bg-warning-soft p-3 text-sm text-warning-ink">
          {changed}
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Results sections">
          {RESULT_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="summary">
          <SummaryTab results={results} symbol={symbol} />
        </TabsContent>
        <TabsContent value="charts">
          <ChartsTab results={results} symbol={symbol} />
        </TabsContent>
        <TabsContent value="trades">
          <TradesTab results={results} symbol={symbol} />
        </TabsContent>
        <TabsContent value="records" className="space-y-6">
          <StoredRecords executionId={results.execution_id} />
          <RecordsTab results={results} symbol={symbol} />
        </TabsContent>
        <TabsContent value="configuration">
          <ConfigurationTab results={results} symbol={symbol} />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}
