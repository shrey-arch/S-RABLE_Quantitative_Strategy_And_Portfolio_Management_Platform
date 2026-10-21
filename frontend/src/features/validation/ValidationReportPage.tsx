import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChartLine, CircleSlash, RotateCcw, Square } from 'lucide-react';
import { Fragment } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { duration, isTerminal, POLL_MS } from '@/features/backtests/backtest-model';
import { Timeline } from '@/features/backtests/BacktestStatusPage';
import { useCancelExecution } from '@/features/backtests/queries';
import { useInstruments } from '@/features/instruments/queries';
import { coreInfo } from '@/features/strategies/core-strategies';
import { RulesSummary } from '@/features/strategies/RulesSummary';
import { formatDateTime, humanize, MISSING } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useValidation } from './queries';
import {
  BacktestStageView,
  ConfigurationView,
  MonteCarloStageView,
  RegimeStageView,
  StageStatusBadge,
  ToneBox,
  WalkForwardStageView,
} from './StageViews';
import { PaperStageView } from './PaperStageView';
import {
  isReportTab,
  REPORT_TAB_LABELS,
  REPORT_TABS,
  STAGE_LABELS,
  STAGE_ORDER,
  VERDICT_LABELS,
  VERDICT_TONES,
  type ReportTab,
  type ValidationReport,
} from './validation-model';

const TITLE = 'Validation report';

function Shell(props: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">{props.children}</div>;
}

function BackLink() {
  return (
    <Link to="/app/validation" className="text-sm text-muted-foreground hover:text-foreground">
      &larr; Validation history
    </Link>
  );
}

const isMissing = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

/** /app/validation/:id - one validation run: its pipeline, verdicts and evidence. */
export default function ValidationReportPage() {
  const { id = '' } = useParams();
  const query = useValidation(id);

  if (query.isError && isMissing(query.error)) {
    return (
      <Shell>
        <BackLink />
        <h1 className="text-2xl font-semibold tracking-tight">{TITLE}</h1>
        <div className="flex flex-col items-center rounded-xl border px-6 py-12 text-center">
          <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
            <CircleSlash className="size-6" />
          </span>
          <p className="mt-4 font-medium">Validation not available</p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            This validation does not exist, or it belongs to another account.
          </p>
          <Button asChild className="mt-6">
            <Link to="/app/validation">Validation history</Link>
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
  return <ReportView report={query.data} refreshError={query.isError ? query.error : null} />;
}

/** The selected tab lives in the address (?tab=walk_forward). */
function useTab(): [ReportTab, (tab: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get('tab');
  const tab = isReportTab(value) ? value : 'backtest';
  const set = (next: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'backtest') p.delete('tab');
        else p.set('tab', next);
        return p;
      },
      { replace: true },
    );
  return [tab, set];
}

/** 1 Backtest -> 2 Walk-forward -> 3 Regime stress -> 4 Monte Carlo -> 5 Paper trading. */
function Pipeline(props: { report: ValidationReport; onOpen: (tab: string) => void }) {
  return (
    <nav aria-label="Validation pipeline">
      <ol className="flex flex-wrap items-stretch gap-2">
        {STAGE_ORDER.map((key, index) => {
          const stage = props.report.stages[key];
          return (
            <Fragment key={key}>
              {index > 0 && (
                <li aria-hidden className="hidden items-center text-muted-foreground sm:flex">
                  <ArrowRight className="size-4" />
                </li>
              )}
              <li>
                <button
                  type="button"
                  onClick={() => props.onOpen(key)}
                  aria-label={`Stage ${index + 1}, ${STAGE_LABELS[key]}: ${stage.status === 'NOT_RUN' ? 'Not run' : humanize(stage.status)}`}
                  className="flex min-w-36 flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="text-xs text-muted-foreground">{`${index + 1}. ${STAGE_LABELS[key]}`}</span>
                  <StageStatusBadge status={stage.status} />
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

function ReportView({ report, refreshError }: { report: ValidationReport; refreshError: unknown }) {
  const [tab, setTab] = useTab();
  const instruments = useInstruments().data;
  const cancel = useCancelExecution();
  const queryClient = useQueryClient();
  const symbol = (id: string) =>
    instruments?.find((i) => i.id === id)?.symbol ?? (instruments ? id.slice(0, 8) : '...');
  const c = report.configuration;
  const active = !isTerminal(report.status);
  const verdict = report.verdict;
  const took = duration(report.started_at, report.completed_at);

  const onCancel = async () => {
    try {
      await cancel.mutateAsync(report.id);
      toast.success('Validation cancelled.');
    } catch (error) {
      // 409: it finished first; the report is read again and shows how it ended.
      toast.error((error as Error).message);
    } finally {
      void queryClient.invalidateQueries({ queryKey: queryKeys.validations.all });
    }
  };

  return (
    <Shell>
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{TITLE}</h1>
            <StatusBadge kind="execution" value={report.status} />
            <SimulationLabel kind="historical" />
          </div>
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
            {` \u00b7 ${c.instrument_ids.map(symbol).join(', ')} \u00b7 created ${formatDateTime(report.created_at)}`}
          </p>
        </div>
        <div role="group" aria-label="Actions" className="flex flex-wrap items-center gap-2">
          {active && (
            <ConfirmDialog
              trigger={
                <Button variant="outline">
                  <Square /> Cancel validation
                </Button>
              }
              title="Cancel this validation?"
              description="The run is stopped and marked Cancelled. Stages that finished keep their results; you can run it again later."
              confirmLabel="Cancel validation"
              onConfirm={onCancel}
            />
          )}
          {report.source_execution_id && (
            <Button asChild variant="outline">
              <Link to={`/app/executions/${report.source_execution_id}/results`}>
                <ChartLine /> Source backtest results
              </Link>
            </Button>
          )}
          <Button asChild variant={active ? 'ghost' : 'default'}>
            <Link to={`/app/validation/new?from=${encodeURIComponent(report.id)}`}>
              <RotateCcw /> Edit and rerun
            </Link>
          </Button>
        </div>
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {active
          ? `Status: ${humanize(report.status)}. This page checks for updates every ${POLL_MS / 1000} seconds; stages fill in as they finish.`
          : `Status: ${humanize(report.status)}. This is final.`}
      </p>
      {Boolean(refreshError) && active && (
        <p role="alert" className="text-sm text-destructive">
          Could not refresh the status. Retrying...
        </p>
      )}

      <Pipeline report={report} onOpen={setTab} />

      <ToneBox tone={VERDICT_TONES[verdict.status]} label="Overall verdict">
        <p className="font-semibold">Overall: {VERDICT_LABELS[verdict.status]}</p>
        <p className="mt-1 text-foreground">{verdict.reason}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          The verdict and every threshold come from the backend ({report.thresholds_source}). A
          strategy is validated only when every stage, including paper trading, has passed.
        </p>
      </ToneBox>

      {(active || report.status !== 'COMPLETED') && (
        <section
          aria-labelledby="job-heading"
          className={cn(
            'space-y-4 rounded-xl border bg-card p-4 sm:p-6',
            report.status === 'FAILED' && 'border-destructive/30',
          )}
        >
          <h2 id="job-heading" className="font-semibold">
            Job
          </h2>
          <Timeline execution={report} />
          {took && <p className="text-xs text-muted-foreground">Ran for {took}.</p>}
          {report.status === 'FAILED' && (
            <dl className="divide-y text-sm">
              <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted-foreground">Error code</dt>
                <dd>
                  <code className="font-mono text-xs">{report.error?.code ?? MISSING}</code>
                </dd>
              </div>
              <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted-foreground">Message</dt>
                <dd>{report.error?.message ?? MISSING}</dd>
              </div>
            </dl>
          )}
        </section>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Report sections">
          {REPORT_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {REPORT_TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="backtest">
          <BacktestStageView report={report} />
        </TabsContent>
        <TabsContent value="walk_forward">
          <WalkForwardStageView report={report} />
        </TabsContent>
        <TabsContent value="regime_stress">
          <RegimeStageView report={report} />
        </TabsContent>
        <TabsContent value="monte_carlo">
          <MonteCarloStageView report={report} />
        </TabsContent>
        <TabsContent value="paper_trading">
          <PaperStageView report={report} />
        </TabsContent>
        <TabsContent value="configuration">
          <ConfigurationView
            report={report}
            symbol={symbol}
            rules={c.rules ? <RulesSummary config={c.rules} /> : null}
          />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}
