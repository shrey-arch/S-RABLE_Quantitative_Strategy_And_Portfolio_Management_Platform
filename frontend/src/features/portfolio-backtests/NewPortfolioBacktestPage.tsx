import { ArrowLeft, Info, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { DateRangeField } from '@/components/ui/date-range-field';
import { FormField } from '@/components/ui/form-field';
import { FormSection as Section } from '@/components/ui/form-section';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { Spinner } from '@/components/ui/spinner';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import type { Execution } from '@/features/backtests/backtest-model';
import { useExecutions } from '@/features/backtests/queries';
import { InstrumentPicker } from '@/features/instruments/InstrumentPicker';
import { todayIst } from '@/features/instruments/market-data';
import { useInstruments, type Instrument } from '@/features/instruments/queries';
import { useRegimeModels } from '@/features/regime/queries';
import { KIND_SHORT, modelName } from '@/features/regime/regime-model';
import { coreInfo } from '@/features/strategies/core-strategies';
import { useMyStrategies, type Strategy } from '@/features/strategies/queries';
import { ModelOverlapNote } from '@/features/validation/RegimeModelPicker';
import { ValidationBadge } from '@/features/validation/ValidationBadge';
import { formatDate, formatINR, formatNumber, formatPercent } from '@/lib/format';
import {
  buildRequest,
  draftFrom,
  FREQUENCIES,
  FREQUENCY_HINTS,
  FREQUENCY_LABELS,
  initialDraft,
  pickNifty,
  type DraftErrors,
  type Frequency,
  type PortfolioBacktestRequest,
  type PortfolioDraft,
} from './pb-model';
import { usePortfolioBacktest, useSubmitPortfolioBacktest } from './queries';

function Page(props: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        to="/app/portfolio-backtests"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Portfolio backtests
      </Link>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">New portfolio backtest</h1>
          <SimulationLabel kind="historical" />
        </div>
        <p className="text-sm text-muted-foreground">
          Runs your strategies together as one portfolio on stored daily data: on each rebalance day
          the strategies are scored and checked against the market regime using only data up to that
          day, then weighted within the risk limits. Compared with Nifty 50 bought and held and an
          equal-weight portfolio. Nothing is traded.
        </p>
      </div>
      {props.children}
    </div>
  );
}

/** /app/portfolio-backtests/new - configure, review and submit (POST /portfolio-backtests). */
export default function NewPortfolioBacktestPage() {
  const [search] = useSearchParams();
  const from = search.get('from') ?? '';
  const strategies = useMyStrategies();
  const previous = usePortfolioBacktest(from);
  if (strategies.isError)
    return (
      <Page>
        <ErrorState error={strategies.error} onRetry={() => void strategies.refetch()} />
      </Page>
    );
  if (!strategies.data || (from && previous.isPending))
    return (
      <Page>
        <LoadingState rows={6} />
      </Page>
    );
  return (
    <Page>
      <PortfolioForm
        strategies={strategies.data}
        initial={previous.data ? draftFrom(previous.data) : null}
        rerunOf={previous.data ? { id: previous.data.id, created: previous.data.created_at } : null}
      />
    </Page>
  );
}

/** The latest completed backtest of each strategy (the list is newest first). */
function latestBacktests(executions: Execution[] | undefined) {
  const out = new Map<string, Execution>();
  for (const e of executions ?? []) if (!out.has(e.strategy_id)) out.set(e.strategy_id, e);
  return out;
}

function backtestText(run: Execution | undefined, instruments: Instrument[] | undefined) {
  if (!run) return 'No completed backtest yet: it will be left out.';
  const key = (run.run_settings as { strategy_key?: string } | undefined)?.strategy_key;
  const symbol = instruments?.find((i) => i.id === run.instrument_id)?.symbol ?? '...';
  return `Latest backtest: ${key ? `${coreInfo(key).name} on ` : ''}${symbol}, ${formatDate(run.completed_at ?? run.created_at)}.`;
}

function submitProblem(error: unknown): { title: string; text: string } {
  if (error instanceof ApiError) {
    if (error.status === 409) return { title: 'Another run is in progress', text: error.message };
    const fields = Object.values(error.fieldErrors).map((m) => m.replace(/^Value error, /, ''));
    return {
      title: 'The backend did not accept this portfolio backtest',
      text: fields.length ? fields.join(' ') : error.message,
    };
  }
  return { title: 'Could not submit', text: (error as Error).message };
}

function PortfolioForm(props: {
  strategies: Strategy[];
  initial: PortfolioDraft | null;
  rerunOf: { id: string; created: string } | null;
}) {
  const today = todayIst();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<PortfolioDraft>(() => props.initial ?? initialDraft(today));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [reviewed, setReviewed] = useState<PortfolioBacktestRequest | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const instruments = useInstruments().data;
  const backtests = useExecutions({ execution_type: 'BACKTEST', status: 'COMPLETED' });
  const latest = useMemo(() => latestBacktests(backtests.data), [backtests.data]);
  const models = useRegimeModels();
  const ready = useMemo(
    () => (models.data ?? []).filter((m) => m.status === 'READY'),
    [models.data],
  );
  const submit = useSubmitPortfolioBacktest();

  const change = (patch: Partial<PortfolioDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setReviewed(null);
  };

  // Nifty 50 and the active regime model are preselected.
  useEffect(() => {
    if (draft.benchmarkId || !instruments) return;
    const nifty = pickNifty(instruments.filter((i) => i.is_active));
    if (nifty) setDraft((d) => ({ ...d, benchmarkId: nifty.id }));
  }, [instruments, draft.benchmarkId]);
  useEffect(() => {
    if (draft.regimeModelId) return;
    const active = ready.find((m) => m.is_active);
    if (active) setDraft((d) => ({ ...d, regimeModelId: active.id }));
  }, [ready, draft.regimeModelId]);

  const shown = props.strategies.filter((s) => s.is_active || draft.strategyIds.includes(s.id));
  const toggle = (id: string, on: boolean) =>
    change({
      strategyIds: on ? [...draft.strategyIds, id] : draft.strategyIds.filter((x) => x !== id),
    });

  const onReview = () => {
    const built = buildRequest(draft, today);
    setErrors(built.errors);
    setSubmitError(null);
    setReviewed(built.request);
  };
  const onSubmit = async () => {
    if (!reviewed) return;
    setSubmitError(null);
    try {
      const run = await submit.mutateAsync(reviewed);
      toast.success('Portfolio backtest submitted.');
      void navigate(`/app/portfolio-backtests/${run.id}`);
    } catch (error) {
      setSubmitError(error);
    }
  };

  if (reviewed) {
    return (
      <Review
        request={reviewed}
        strategies={props.strategies}
        latest={latest}
        instruments={instruments}
        modelLabel={(id) => {
          const m = ready.find((x) => x.id === id);
          return m
            ? `${modelName(m)} (${KIND_SHORT[m.model_kind]}) on ${m.instrument.symbol ?? 'a deleted instrument'}`
            : id;
        }}
        pending={submit.isPending}
        problem={submitError ? submitProblem(submitError) : null}
        onBack={() => setReviewed(null)}
        onSubmit={() => void onSubmit()}
      />
    );
  }

  const errorCount = Object.keys(errors).length;
  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onReview();
      }}
    >
      {props.rerunOf && (
        <p className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            Filled in from the{' '}
            <Link
              to={`/app/portfolio-backtests/${props.rerunOf.id}`}
              className="underline underline-offset-4"
            >
              portfolio backtest created {formatDate(props.rerunOf.created)}
            </Link>
            . Change what you need, then review. The earlier run is not changed.
          </span>
        </p>
      )}
      {errorCount > 0 && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          Some fields need attention. They are marked below.
        </p>
      )}

      <Section title="Portfolio">
        <FormField label="Name" error={errors.name}>
          {(f) => (
            <Input
              {...f}
              className="max-w-md"
              value={draft.name}
              onChange={(e) => change({ name: e.target.value })}
            />
          )}
        </FormField>
      </Section>

      <Section
        title="Strategies"
        description="Each strategy is backtested as a sleeve on the instrument, parameters and costs of its latest completed backtest. Strategies the backend cannot use are left out, with the reason."
      >
        <fieldset aria-describedby={errors.strategyIds ? 'pb-strategies-error' : undefined}>
          <legend className="sr-only">Strategies</legend>
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have no active strategies.{' '}
              <Link to="/app/strategies" className="underline underline-offset-4">
                Create one
              </Link>{' '}
              and backtest it first.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {shown.map((s) => (
                <li key={s.id} className="flex items-start gap-3 p-3">
                  <input
                    id={`pb-s-${s.id}`}
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={draft.strategyIds.includes(s.id)}
                    onChange={(e) => toggle(s.id, e.target.checked)}
                  />
                  <label htmlFor={`pb-s-${s.id}`} className="min-w-0 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {backtests.isPending
                        ? 'Checking its backtests...'
                        : backtestText(latest.get(s.id), instruments)}
                    </span>
                    {s.validation && <ValidationBadge validation={s.validation} className="mt-1" />}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {errors.strategyIds && (
            <p id="pb-strategies-error" role="alert" className="mt-2 text-xs text-destructive">
              {errors.strategyIds}
            </p>
          )}
        </fieldset>
        <p className="text-sm text-muted-foreground">
          {`${draft.strategyIds.length} of ${shown.length} chosen (at most 20).`}
        </p>
      </Section>

      <Section title="Benchmark and period">
        <FormField
          label="Benchmark"
          error={errors.benchmarkId}
          hint="Nifty 50 as a price index: dividends are not included, so its return is understated a little."
        >
          {(f) => (
            <InstrumentPicker
              {...f}
              value={draft.benchmarkId}
              filter={(i) => i.instrument_type === 'INDEX'}
              onChange={(id) => change({ benchmarkId: id })}
            />
          )}
        </FormField>
        <DateRangeField
          value={{ start: draft.start, end: draft.end }}
          max={today}
          error={errors.start ?? null}
          onChange={(v) => change({ start: v.start, end: v.end })}
        />
        <p className="text-xs text-muted-foreground">
          IST dates, inclusive. The calendar is the benchmark&apos;s NSE trading days in this
          period.
        </p>
        <FormField label="Rebalancing" hint={FREQUENCY_HINTS[draft.frequency]}>
          {(f) => (
            <NativeSelect
              {...f}
              value={draft.frequency}
              onChange={(e) => change({ frequency: e.target.value as Frequency })}
            >
              {FREQUENCIES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {FREQUENCY_LABELS[value]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </Section>

      <Section title="Capital and costs">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Capital (INR)" error={errors.capital}>
            {(f) => (
              <Input
                {...f}
                inputMode="decimal"
                value={draft.capital}
                onChange={(e) => change({ capital: e.target.value })}
              />
            )}
          </FormField>
          <FormField label="Brokerage (%)" error={errors.brokeragePct} hint="Of the traded value.">
            {(f) => (
              <Input
                {...f}
                inputMode="decimal"
                value={draft.brokeragePct}
                onChange={(e) => change({ brokeragePct: e.target.value })}
              />
            )}
          </FormField>
          <FormField label="Slippage (bps)" error={errors.slippageBps} hint="Of the traded value.">
            {(f) => (
              <Input
                {...f}
                inputMode="decimal"
                value={draft.slippageBps}
                onChange={(e) => change({ slippageBps: e.target.value })}
              />
            )}
          </FormField>
        </div>
        <p className="text-xs text-muted-foreground">
          Each rebalance costs the value traded to reach the new weights times (brokerage +
          slippage). Each sleeve keeps its own backtest&apos;s costs for its trades.
        </p>
      </Section>

      <Section
        title="Risk limits"
        description="Shares of the portfolio's value on each rebalance day."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Cash reserve (%)" error={errors.cashReservePct}>
            {(f) => (
              <Input
                {...f}
                inputMode="decimal"
                value={draft.cashReservePct}
                onChange={(e) => change({ cashReservePct: e.target.value })}
              />
            )}
          </FormField>
          <FormField label="Most per strategy (%)" error={errors.maxStrategyPct}>
            {(f) => (
              <Input
                {...f}
                inputMode="decimal"
                value={draft.maxStrategyPct}
                onChange={(e) => change({ maxStrategyPct: e.target.value })}
              />
            )}
          </FormField>
          <FormField label="Most per instrument (%)" error={errors.maxAssetPct}>
            {(f) => (
              <Input
                {...f}
                inputMode="decimal"
                value={draft.maxAssetPct}
                onChange={(e) => change({ maxAssetPct: e.target.value })}
              />
            )}
          </FormField>
        </div>
      </Section>

      <Section title="Regime and benchmarks">
        <div className="flex items-center gap-3">
          <Switch
            id="pb-regime"
            checked={draft.regimeFilter}
            onCheckedChange={(on) => change({ regimeFilter: on })}
          />
          <label htmlFor="pb-regime" className="text-sm font-medium">
            Regime filter
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          On: a strategy whose rule does not suit the regime of the day gets no weight that day.
          Each rebalance uses the model&apos;s regime as of that day.
        </p>
        {draft.regimeFilter &&
          (models.isSuccess && ready.length === 0 ? (
            <p role="alert" className="text-sm text-warning">
              No regime model has been trained yet.{' '}
              <Link
                to="/app/regime?tab=training"
                className="font-medium underline-offset-4 hover:underline"
              >
                Train one on the Market Regime page
              </Link>
              , or turn the regime filter off.
            </p>
          ) : (
            <>
              <FormField label="Regime model" error={errors.regimeModelId}>
                {(f) => (
                  <NativeSelect
                    {...f}
                    value={draft.regimeModelId}
                    disabled={!models.isSuccess}
                    onChange={(e) => change({ regimeModelId: e.target.value })}
                  >
                    {ready.map((m) => (
                      <NativeSelectOption key={m.id} value={m.id}>
                        {`${modelName(m)} \u00b7 ${KIND_SHORT[m.model_kind]} \u00b7 ${m.instrument.symbol ?? 'deleted instrument'}${m.is_active ? ' (active)' : ''}`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              {draft.regimeModelId && (
                <ModelOverlapNote
                  modelId={draft.regimeModelId}
                  start={draft.start}
                  end={draft.end}
                />
              )}
            </>
          ))}
        <div className="flex items-center gap-3 pt-2">
          <Switch
            id="pb-6040"
            checked={draft.sixtyForty}
            onCheckedChange={(on) => change({ sixtyForty: on })}
          />
          <label htmlFor="pb-6040" className="text-sm font-medium">
            Also compare with 60/40
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          60% Nifty 50 and 40% debt growing at a constant rate, rebalanced on the same days.
        </p>
        <div className="flex items-center gap-3 pt-2">
          <Switch
            id="pb-validated"
            checked={draft.requireValidated}
            onCheckedChange={(on) => change({ requireValidated: on })}
          />
          <label htmlFor="pb-validated" className="text-sm font-medium">
            Only validated strategies
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          On: strategies without a passing validation of their current version are left out, with
          the reason. A validation that used data from inside the period is hindsight; the results
          say so.
        </p>
      </Section>

      <Button type="submit">Review portfolio backtest</Button>
    </form>
  );
}

function Review(props: {
  request: PortfolioBacktestRequest;
  strategies: Strategy[];
  latest: Map<string, Execution>;
  instruments: Instrument[] | undefined;
  modelLabel: (id: string) => string;
  pending: boolean;
  problem: { title: string; text: string } | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const r = props.request;
  const l = r.limits!;
  const name = (id: string) => props.strategies.find((s) => s.id === id)?.name ?? id;
  const symbol =
    props.instruments?.find((i) => i.id === r.benchmark_instrument_id)?.symbol ?? '...';
  const rows: [string, React.ReactNode][] = [
    ['Name', r.name],
    [
      'Strategies',
      <ul key="s" className="space-y-1">
        {r.strategy_ids.map((id) => (
          <li key={id}>
            <span className="font-medium">{name(id)}</span>
            <span className="block text-xs text-muted-foreground">
              {backtestText(props.latest.get(id), props.instruments)}
            </span>
          </li>
        ))}
      </ul>,
    ],
    [
      'Benchmark',
      `${symbol} (price index, buy and hold), and equal weight${r.sixty_forty ? ', and 60/40' : ''}`,
    ],
    [
      'Validation',
      r.require_validated
        ? 'Only strategies with a passing validation of their current version'
        : 'Not required: every chosen strategy that has a backtest',
    ],
    ['Dates', `${formatDate(r.start_date)} to ${formatDate(r.end_date)} (IST, inclusive)`],
    [
      'Rebalancing',
      `${FREQUENCY_LABELS[r.frequency as Frequency]}: ${FREQUENCY_HINTS[r.frequency as Frequency].toLowerCase()}`,
    ],
    ['Capital', formatINR(r.capital)],
    [
      'Rebalancing cost',
      `Brokerage ${formatPercent(r.brokerage_rate)} + slippage ${formatNumber(r.slippage_bps, 2)} bps of the traded value`,
    ],
    [
      'Risk limits',
      `Cash reserve ${formatPercent(l.cash_reserve)}, at most ${formatPercent(l.max_strategy_weight)} per strategy, at most ${formatPercent(l.max_asset_weight)} per instrument`,
    ],
    [
      'Regime filter',
      r.regime_filter && r.regime_model_id ? (
        <div key="rm" className="space-y-1">
          <p>{`On: ${props.modelLabel(r.regime_model_id)}`}</p>
          <ModelOverlapNote modelId={r.regime_model_id} start={r.start_date} end={r.end_date} />
        </div>
      ) : (
        'Off'
      ),
    ],
  ];
  return (
    <div className="space-y-6">
      <section
        aria-labelledby="review-heading"
        className="space-y-4 rounded-xl border bg-card p-4 sm:p-6"
      >
        <div className="space-y-1">
          <h2 id="review-heading" className="font-semibold">
            Review
          </h2>
          <p className="text-sm text-muted-foreground">
            Check the settings. The run starts when you submit; it uses historical data and places
            no orders.
          </p>
        </div>
        <dl className="divide-y text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {props.problem && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <p className="font-medium text-destructive">{props.problem.title}</p>
          <p className="mt-1">{props.problem.text}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={props.onBack} disabled={props.pending}>
          <ArrowLeft /> Back to edit
        </Button>
        <Button type="button" onClick={props.onSubmit} disabled={props.pending}>
          {props.pending ? <Spinner /> : <Play />} Submit portfolio backtest
        </Button>
      </div>
    </div>
  );
}
