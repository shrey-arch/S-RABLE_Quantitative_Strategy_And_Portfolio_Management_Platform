import { AlertTriangle, ArrowLeft, Info, Play, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormSection as Section } from '@/components/ui/form-section';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useDataRangeStatus, type DataRangeStatus } from '@/features/instruments/data-range';
import { DataRangeField } from '@/features/instruments/DataRangeField';
import { InstrumentPicker } from '@/features/instruments/InstrumentPicker';
import { useInstruments, type Instrument } from '@/features/instruments/queries';
import {
  coreInfo,
  formatParamValue,
  instrumentNeed,
  type RegistryEntry,
} from '@/features/strategies/core-strategies';
import {
  useMyStrategies,
  useRegistry,
  validateTemplateParams,
  type Strategy,
} from '@/features/strategies/queries';
import { RulesSummary } from '@/features/strategies/RulesSummary';
import { fieldForMessage, parseParams, templateOf } from '@/features/strategies/strategy-form';
import {
  BACKTEST_BLOCKED,
  NO_CODE_BACKTEST_NOTE,
  strategyKind,
} from '@/features/strategies/strategy-kind';
import { useSubmitValidation } from '@/features/validation/queries';
import { ModelOverlapNote } from '@/features/validation/RegimeModelPicker';
import { ValidationSettingsFields } from '@/features/validation/ValidationSettingsFields';
import {
  buildValidationSettings,
  emptyValidationDraft,
  validationDraftFromExecution,
  type ValidationDraft,
  type ValidationSettings,
} from '@/features/validation/validation-model';
import { formatDate, formatDateTime, formatINR, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  backtestable,
  barsBeforeFirstSignal,
  buildRequest,
  draftFromExecution,
  emptyDraft,
  entryFor,
  fitSlots,
  hasEntryConditions,
  isRules,
  LIMITS,
  minInstruments,
  slotLabel,
  warmupNote,
  withStrategy,
  type BacktestDraft,
  type BacktestRequest,
  type DraftErrors,
  type Execution,
} from './backtest-model';
import { useExecution, useSubmitBacktest } from './queries';

/**
 * The form serves two pages: a backtest (POST /backtests) and a validation
 * (POST /validations), which is a backtest's settings plus the settings of the
 * validation stages.
 */
export type RunMode = 'backtest' | 'validation';

const PAGE_TEXT: Record<RunMode, { title: string; intro: string }> = {
  backtest: {
    title: 'New backtest',
    intro: 'Runs one of your strategies on stored historical daily data. Nothing is traded.',
  },
  validation: {
    title: 'New validation',
    intro:
      'Runs the validation pipeline on stored historical daily data: a backtest, walk-forward windows, regime stress and Monte Carlo. Nothing is traded.',
  },
};

function Page(props: { mode: RunMode; children: React.ReactNode }) {
  const text = PAGE_TEXT[props.mode];
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{text.title}</h1>
          <SimulationLabel kind="historical" />
        </div>
        <p className="text-sm text-muted-foreground">{text.intro}</p>
      </div>
      {props.children}
    </div>
  );
}

const isNotAvailable = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

/** /app/backtests/new - configure, review and submit a backtest (POST /backtests). */
export default function NewBacktestPage() {
  return <NewRunPage mode="backtest" />;
}

/**
 * The backtest or validation form. ?from=<run id> fills it in from an earlier run
 * (a backtest, or for a validation also an earlier validation); ?strategy=<id>
 * preselects a strategy.
 */
export function NewRunPage({ mode }: { mode: RunMode }) {
  const [search] = useSearchParams();
  const from = search.get('from') ?? '';
  const wanted = search.get('strategy') ?? '';
  const strategies = useMyStrategies();
  const registry = useRegistry();
  const previous = useExecution(from, { poll: false });

  if (from && previous.isError && isNotAvailable(previous.error)) {
    return (
      <Page mode={mode}>
        <EmptyState
          title="This run is not available"
          description="The run to start from does not exist, or it belongs to another account."
          action={
            <Button asChild>
              <Link to={mode === 'validation' ? '/app/validation/new' : '/app/backtests/new'}>
                {mode === 'validation' ? 'Start a new validation' : 'Start a new backtest'}
              </Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const failed = [strategies, registry, ...(from ? [previous] : [])].find((q) => q.isError);
  if (failed) {
    return (
      <Page mode={mode}>
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      </Page>
    );
  }
  if (!strategies.isSuccess || !registry.isSuccess || (from && !previous.isSuccess)) {
    return (
      <Page mode={mode}>
        <LoadingState rows={8} />
      </Page>
    );
  }

  const start =
    from && previous.data
      ? draftFromExecution(previous.data)
      : { draft: { ...emptyDraft(), strategyId: wanted }, overrides: {} };

  const earlier = from ? previous.data : undefined;
  // A validation started from a backtest links back to it; one started from an
  // earlier validation keeps that validation's source.
  const sourceId =
    earlier?.execution_type === 'BACKTEST'
      ? earlier.id
      : (((earlier?.run_settings ?? {}) as { source_execution_id?: string | null })
          .source_execution_id ?? null);

  return (
    <Page mode={mode}>
      <BacktestForm
        key={from || wanted || 'new'}
        mode={mode}
        initial={start.draft}
        overrides={start.overrides}
        initialValidation={
          earlier?.execution_type === 'VALIDATION'
            ? validationDraftFromExecution(earlier)
            : emptyValidationDraft()
        }
        sourceId={mode === 'validation' ? sourceId : null}
        strategies={strategies.data}
        registry={registry.data}
        rerunOf={earlier}
      />
    </Page>
  );
}

/** Why the strategy named in the address cannot be used here. */
function unusableReason(strategy: Strategy | undefined, registry: RegistryEntry[]) {
  if (!strategy) return 'The strategy in the link is not available.';
  const kind = strategyKind(strategy);
  if (BACKTEST_BLOCKED[kind]) return BACKTEST_BLOCKED[kind];
  if (kind === 'no-code') {
    if (!hasEntryConditions(strategy))
      return `${strategy.name} has no entry conditions, so it would never trade. Add one in the builder.`;
  } else if (kind === 'python') {
    // Feature 6: the backend runs the saved code in its isolated sandbox.
    if (!strategy.python_code)
      return `${strategy.name} has no Python code yet. Write it in the editor first.`;
  } else if (!registry.some((e) => e.strategy_key === templateOf(strategy.strategy_config)))
    return `${strategy.name} uses a template the backend does not offer.`;
  if (!strategy.is_active) return `${strategy.name} is inactive. Turn it on to backtest it.`;
  return null;
}

function initialDraft(
  initial: BacktestDraft,
  overrides: Record<string, unknown>,
  usable: Strategy[],
  registry: RegistryEntry[],
) {
  const strategy = usable.find((s) => s.id === initial.strategyId);
  const entry = entryFor(strategy, registry);
  if (strategy && entry) return withStrategy(initial, strategy, entry, overrides);
  return { ...initial, strategyId: '' };
}

const symbolOf = (instruments: Instrument[] | undefined, id: string) =>
  instruments?.find((i) => i.id === id)?.symbol ?? 'Unknown instrument';

/** Sentences for a failed submission, without server internals. */
function submitProblem(error: unknown, mode: RunMode): { title: string; text: string } {
  const what = mode === 'validation' ? 'validation' : 'backtest';
  if (error instanceof ApiError) {
    if (error.status === 409)
      return {
        title:
          mode === 'validation'
            ? 'Another backtest or validation is running'
            : 'Another backtest is running',
        text: error.message,
      };
    const fields = Object.values(error.fieldErrors).map((m) => m.replace(/^Value error, /, ''));
    if (fields.length)
      return { title: `The backend did not accept this ${what}`, text: fields.join(' ') };
    return { title: `The backend did not accept this ${what}`, text: error.message };
  }
  return { title: 'Could not submit', text: (error as Error).message };
}

function BacktestForm(props: {
  mode: RunMode;
  initial: BacktestDraft;
  overrides: Record<string, unknown>;
  initialValidation: ValidationDraft;
  sourceId: string | null;
  strategies: Strategy[];
  registry: RegistryEntry[];
  rerunOf?: Execution;
}) {
  const { mode } = props;
  const { registry } = props;
  const navigate = useNavigate();
  const usable = useMemo(
    () => backtestable(props.strategies, registry),
    [props.strategies, registry],
  );
  const instruments = useInstruments().data;
  const [draft, setDraft] = useState(() =>
    initialDraft(props.initial, props.overrides, usable, registry),
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [statuses, setStatuses] = useState<Record<number, DataRangeStatus>>({});
  const [checking, setChecking] = useState(false);
  const [reviewed, setReviewed] = useState<BacktestRequest | null>(null);
  const [vdraft, setVdraft] = useState(props.initialValidation);
  const [settings, setSettings] = useState<ValidationSettings | null>(null);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const submit = useSubmitBacktest();
  const submitValidation = useSubmitValidation();
  const sending = useRef(false);

  const strategy = usable.find((s) => s.id === draft.strategyId);
  const entry = entryFor(strategy, registry);
  const layout = entry?.instruments ?? 'single';
  const info = entry ? coreInfo(entry.strategy_key) : null;
  const requested =
    props.initial.strategyId && !strategy
      ? unusableReason(
          props.strategies.find((s) => s.id === props.initial.strategyId),
          registry,
        )
      : null;

  const report = useCallback(
    (index: number, status: DataRangeStatus) =>
      setStatuses((prev) => (prev[index] === status ? prev : { ...prev, [index]: status })),
    [],
  );
  const reportMain = useCallback((status: DataRangeStatus) => report(0, status), [report]);

  const slotStatuses = draft.instrumentIds.map((_, i) => statuses[i]);
  const dataReady = slotStatuses.every((s) => s?.kind === 'ok');
  const barsInRange = dataReady
    ? Math.min(...slotStatuses.map((s) => (s?.kind === 'ok' ? s.coverage.row_count : 0)))
    : null;
  const rules = isRules(entry);
  const parsed = entry ? parseParams(entry, draft.params) : null;
  const warmup = warmupNote(
    entry && parsed?.ok ? barsBeforeFirstSignal(entry.strategy_key, parsed.values) : null,
    barsInRange,
  );

  const update = (change: Partial<BacktestDraft>) => {
    setDraft((d) => ({ ...d, ...change }));
    setReviewed(null);
  };

  const chooseStrategy = (id: string) => {
    const next = usable.find((s) => s.id === id);
    const nextEntry = entryFor(next, registry);
    setErrors({});
    setReviewed(null);
    setDraft((d) =>
      next && nextEntry ? withStrategy(d, next, nextEntry) : { ...d, strategyId: '', params: {} },
    );
  };

  const setInstrument = (index: number, id: string) =>
    update({ instrumentIds: draft.instrumentIds.map((v, i) => (i === index ? id : v)) });

  const removeInstrument = (index: number) => {
    update({ instrumentIds: draft.instrumentIds.filter((_, i) => i !== index) });
  };

  const updateValidation = (change: Partial<ValidationDraft>) => {
    setVdraft((d) => ({ ...d, ...change }));
    setReviewed(null);
  };

  const onReview = async () => {
    const built = buildRequest(draft, entry);
    const problems: DraftErrors = built.ok ? {} : { ...built.errors };
    const validation = mode === 'validation' ? buildValidationSettings(vdraft, entry, rules) : null;
    if (validation && !validation.ok) Object.assign(problems, validation.errors);
    if (!problems.range && !dataReady) {
      problems.range =
        layout === 'single'
          ? 'Choose dates with stored daily data for this instrument.'
          : 'Every instrument needs stored daily data in this range.';
    }
    setErrors(problems);
    if (!built.ok || Object.keys(problems).length || !entry) return;

    setChecking(true);
    try {
      // The rule engine has no parameters; the backend checks the rules on submit.
      if (!rules) await validateTemplateParams(entry.strategy_key, built.values);
    } catch (error) {
      const message = (error as Error).message;
      const field =
        error instanceof ApiError && error.status === 422
          ? fieldForMessage(
              message,
              entry.parameters.map((p) => p.name),
            )
          : null;
      setErrors(field ? { [`param.${field}`]: message } : { form: message });
      return;
    } finally {
      setChecking(false);
    }
    setSubmitError(null);
    setSettings(validation?.ok ? validation.settings : null);
    setReviewed(built.request);
  };

  const onSubmit = () => {
    // One click = one job: later clicks are ignored until this request has answered.
    if (!reviewed || sending.current) return;
    sending.current = true;
    setSubmitError(null);
    if (mode === 'validation' && settings) {
      submitValidation.mutate(
        { ...reviewed, ...settings, source_execution_id: props.sourceId },
        {
          onSuccess: (execution) => {
            toast.success('Validation submitted.');
            navigate(`/app/validation/${execution.id}`);
          },
          onError: (error) => {
            sending.current = false;
            setSubmitError(error);
          },
        },
      );
      return;
    }
    submit.mutate(reviewed, {
      onSuccess: (execution) => {
        toast.success('Backtest submitted.');
        navigate(`/app/backtests/${execution.id}`);
      },
      onError: (error) => {
        sending.current = false;
        setSubmitError(error);
      },
    });
  };

  if (usable.length === 0) {
    return (
      <EmptyState
        title={
          mode === 'validation'
            ? 'No strategy can be validated yet'
            : 'No strategy can be backtested yet'
        }
        description="Backtests and validations run your active strategies made from a core template or built without code. Custom Python strategies cannot run yet."
        action={
          <Button asChild>
            <Link to="/app/strategies">Open the strategy library</Link>
          </Button>
        }
      />
    );
  }

  if (reviewed && strategy && entry && info) {
    const problem = submitError ? submitProblem(submitError, mode) : null;
    return (
      <Review
        mode={mode}
        settings={settings}
        request={reviewed}
        strategy={strategy}
        entry={entry}
        instruments={instruments}
        statuses={slotStatuses}
        warmup={warmup}
        pending={mode === 'validation' ? submitValidation.isPending : submit.isPending}
        problem={problem}
        onBack={() => setReviewed(null)}
        onSubmit={onSubmit}
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
        void onReview();
      }}
    >
      {props.rerunOf && (
        <p className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            Filled in from the{' '}
            <Link
              to={
                props.rerunOf.execution_type === 'VALIDATION'
                  ? `/app/validation/${props.rerunOf.id}`
                  : `/app/backtests/${props.rerunOf.id}`
              }
              className="underline underline-offset-4"
            >
              {props.rerunOf.execution_type === 'VALIDATION' ? 'validation' : 'backtest'} created{' '}
              {formatDateTime(props.rerunOf.created_at)}
            </Link>
            .{' '}
            {mode === 'validation' && props.rerunOf.execution_type === 'BACKTEST'
              ? 'The validation runs its own backtest with these settings, then the other stages. Change what you need, then review.'
              : 'Change what you need, then review. The earlier run is not changed.'}
          </span>
        </p>
      )}
      {requested && (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          {requested} Choose another strategy below.
        </p>
      )}
      {errorCount > 0 && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {errors.form ?? 'Some fields need attention. They are marked below.'}
        </p>
      )}

      <Section title="Strategy">
        <FormField
          label="Strategy"
          error={errors.strategy}
          hint={
            props.strategies.length > usable.length
              ? `${props.strategies.length - usable.length} of your strategies are not listed: only active strategies made from a core template, or built without code with at least one entry condition, can be backtested.`
              : undefined
          }
        >
          {(field) => (
            <NativeSelect
              {...field}
              className="min-w-72"
              value={draft.strategyId}
              onChange={(e) => chooseStrategy(e.target.value)}
            >
              <NativeSelectOption value="">Choose a strategy</NativeSelectOption>
              {usable.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {`${s.name} (${coreInfo(entryFor(s, registry)?.strategy_key ?? '').name}, v${s.version})`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {info && entry && (
          <p className="text-sm text-muted-foreground">
            {info.summary} {instrumentNeed(entry.instruments)}
          </p>
        )}
      </Section>

      {entry && (
        <>
          <Section
            title="Instruments"
            description={
              layout === 'pair'
                ? 'The pair trade buys one and sells the other. A is the first leg.'
                : layout === 'universe'
                  ? `The strategy holds the best ${draft.params.top_k ?? 'top_k'} of these. Up to ${LIMITS.instrumentsMax}.`
                  : undefined
            }
          >
            <div className="space-y-4">
              {draft.instrumentIds.map((id, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <FormField
                    label={slotLabel(layout, index)}
                    error={errors[`instrument.${index}`]}
                    className="min-w-0"
                  >
                    {(field) => (
                      <InstrumentPicker
                        {...field}
                        value={id}
                        onChange={(next) => setInstrument(index, next)}
                        filter={(i) => i.id === id || !draft.instrumentIds.includes(i.id)}
                      />
                    )}
                  </FormField>
                  {layout === 'universe' &&
                    draft.instrumentIds.length > minInstruments(layout, draft.params) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${slotLabel(layout, index)}`}
                        onClick={() => removeInstrument(index)}
                      >
                        <X />
                      </Button>
                    )}
                </div>
              ))}
              {errors[`instrument.${draft.instrumentIds.length}`] && (
                <p role="alert" className="text-xs text-destructive">
                  {errors[`instrument.${draft.instrumentIds.length}`]}
                </p>
              )}
              {layout === 'universe' && draft.instrumentIds.length < LIMITS.instrumentsMax && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update({ instrumentIds: [...draft.instrumentIds, ''] })}
                >
                  <Plus /> Add asset
                </Button>
              )}
            </div>
          </Section>

          <Section
            title="Dates and data"
            description="Daily (1D) bars of stored historical data. The range is inclusive, in IST."
          >
            <DataRangeField
              instrumentId={draft.instrumentIds[0] ?? ''}
              value={draft.range}
              onChange={(range) => update({ range })}
              onStatusChange={reportMain}
            />
            {errors.range && (
              <p role="alert" className="text-xs text-destructive">
                {errors.range}
              </p>
            )}
            <DatasetPreview
              layout={layout}
              draft={draft}
              instruments={instruments}
              statuses={slotStatuses}
              report={report}
              warmup={warmup}
              rules={rules}
            />
          </Section>

          <Section title="Capital and size">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={'Initial capital (\u20b9)'}
                error={errors.capital}
                hint="Simulated cash at the start. No real money is used."
              >
                {(field) => (
                  <Input
                    {...field}
                    inputMode="decimal"
                    value={draft.capital}
                    onChange={(e) => update({ capital: e.target.value })}
                  />
                )}
              </FormField>
              <FormField
                label="Quantity per trade"
                error={errors.quantity}
                hint="Units bought or sold on each signal."
              >
                {(field) => (
                  <Input
                    {...field}
                    inputMode="numeric"
                    value={draft.quantity}
                    onChange={(e) => update({ quantity: e.target.value })}
                  />
                )}
              </FormField>
            </div>
          </Section>

          {rules && strategy ? (
            <Section
              title="Rules"
              description="Saved in the builder. A backtest has no per-run parameters for them."
            >
              <RulesSummary config={strategy.strategy_config} />
              <p className="text-sm text-muted-foreground">{NO_CODE_BACKTEST_NOTE}</p>
              <Link
                to={`/app/builder/${encodeURIComponent(strategy.id)}`}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Edit the rules in the builder
              </Link>
            </Section>
          ) : (
            <Section
              title="Parameters"
              description="For this run only. The saved strategy keeps its own values."
            >
              {entry.parameters.length === 0 ? (
                <p className="text-sm text-muted-foreground">This strategy has no parameters.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {entry.parameters.map((param) => (
                    <FormField
                      key={param.name}
                      label={param.name}
                      error={errors[`param.${param.name}`]}
                      hint={[info?.parameterHelp[param.name], `Default ${formatParamValue(param)}.`]
                        .filter(Boolean)
                        .join('. ')}
                    >
                      {(field) => (
                        <Input
                          {...field}
                          inputMode={param.type === 'int' ? 'numeric' : 'decimal'}
                          className="font-mono"
                          value={draft.params[param.name] ?? ''}
                          onChange={(e) =>
                            setDraft((d) => {
                              const params = { ...d.params, [param.name]: e.target.value };
                              // top_k decides how many assets a universe needs.
                              return {
                                ...d,
                                params,
                                instrumentIds: fitSlots(d.instrumentIds, layout, params),
                              };
                            })
                          }
                        />
                      )}
                    </FormField>
                  ))}
                </div>
              )}
            </Section>
          )}

          <Section title="Costs" description="Applied by the simulated broker to every fill.">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Slippage (bps)"
                error={errors.slippage}
                hint="10 bps = a 0.10% worse price on each fill. 0 to 1,000."
              >
                {(field) => (
                  <Input
                    {...field}
                    inputMode="decimal"
                    value={draft.slippageBps}
                    onChange={(e) => update({ slippageBps: e.target.value })}
                  />
                )}
              </FormField>
              <FormField
                label="Brokerage (%)"
                error={errors.brokerage}
                hint="Of each trade's value. 0.03 = 0.03%. 0 to 5."
              >
                {(field) => (
                  <Input
                    {...field}
                    inputMode="decimal"
                    value={draft.brokeragePct}
                    onChange={(e) => update({ brokeragePct: e.target.value })}
                  />
                )}
              </FormField>
            </div>
          </Section>

          {mode === 'validation' && (
            <ValidationSettingsFields
              draft={vdraft}
              onChange={updateValidation}
              errors={errors}
              entry={entry}
              rules={rules}
              bars={barsInRange}
              range={draft.range}
            />
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={checking || !entry}>
          {checking && <Spinner />}{' '}
          {mode === 'validation' ? 'Review validation' : 'Review backtest'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Nothing is submitted until you confirm on the next step.
        </span>
      </div>
    </form>
  );
}

/** Data check for an instrument other than the first (the first one is shown by DataRangeField). */
function RangeCheck(props: {
  index: number;
  instrumentId: string;
  range: BacktestDraft['range'];
  report: (index: number, status: DataRangeStatus) => void;
}) {
  const status = useDataRangeStatus(props.instrumentId, props.range);
  const { index, report, instrumentId } = props;
  useEffect(() => {
    report(index, status);
    // The status object is rebuilt each render; report when what it says changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind, 'message' in status ? status.message : '', index, instrumentId, report]);
  return null;
}

function statusText(status: DataRangeStatus | undefined): {
  text: string;
  tone: 'ok' | 'bad' | 'wait';
} {
  if (!status || status.kind === 'loading')
    return { text: 'Checking stored data...', tone: 'wait' };
  switch (status.kind) {
    case 'no-instrument':
      return { text: 'Choose an instrument.', tone: 'wait' };
    case 'incomplete':
      return { text: status.message, tone: 'wait' };
    case 'error':
      return { text: 'Could not check the stored data. Try again.', tone: 'bad' };
    case 'ok':
      return { text: status.message, tone: 'ok' };
    default:
      return { text: status.message, tone: 'bad' };
  }
}

function DatasetPreview(props: {
  layout: RegistryEntry['instruments'];
  draft: BacktestDraft;
  instruments: Instrument[] | undefined;
  statuses: (DataRangeStatus | undefined)[];
  report: (index: number, status: DataRangeStatus) => void;
  warmup: ReturnType<typeof warmupNote>;
  rules?: boolean;
}) {
  const { draft, layout } = props;
  return (
    <div
      aria-label="Dataset preview"
      role="region"
      className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm"
    >
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Dataset preview
      </h3>
      {draft.instrumentIds.slice(1).map((id, i) => (
        <RangeCheck
          key={i + 1}
          index={i + 1}
          instrumentId={id}
          range={draft.range}
          report={props.report}
        />
      ))}
      {layout !== 'single' && (
        <ul className="space-y-1">
          {draft.instrumentIds.map((id, index) => {
            const { text, tone } = statusText(props.statuses[index]);
            const status = props.statuses[index];
            return (
              <li key={index}>
                <span className="font-medium">
                  {slotLabel(layout, index)}
                  {id ? ` (${symbolOf(props.instruments, id)})` : ''}:
                </span>{' '}
                <span
                  className={cn(
                    tone === 'ok' && 'text-success',
                    tone === 'bad' && 'text-destructive',
                    tone === 'wait' && 'text-muted-foreground',
                  )}
                >
                  {text}
                </span>
                {status?.kind === 'ok' && status.warning && (
                  <span className="text-warning"> {status.warning}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {layout !== 'single' && (
        <p className="text-xs text-muted-foreground">
          Only dates that every instrument has are used, so the run may have fewer bars than shown.
        </p>
      )}
      {props.warmup ? (
        <p
          className={cn(
            'flex items-start gap-1.5',
            props.warmup.insufficient ? 'font-medium text-warning' : 'text-muted-foreground',
          )}
        >
          {props.warmup.insufficient && (
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          {props.warmup.text}
        </p>
      ) : props.rules ? (
        <p className="text-muted-foreground">
          Warm-up: nothing is traded until every indicator in the rules has a value.
        </p>
      ) : (
        <p className="text-muted-foreground">Warm-up is shown once the parameters are valid.</p>
      )}
    </div>
  );
}

function Review(props: {
  mode: RunMode;
  settings: ValidationSettings | null;
  request: BacktestRequest;
  strategy: Strategy;
  entry: RegistryEntry;
  instruments: Instrument[] | undefined;
  statuses: (DataRangeStatus | undefined)[];
  warmup: ReturnType<typeof warmupNote>;
  pending: boolean;
  problem: { title: string; text: string } | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const { request, entry } = props;
  const layout = entry.instruments;
  const ids = [request.instrument_id, ...(request.other_instrument_ids ?? [])];
  const start = request.start_timestamp?.slice(0, 10) ?? '';
  const end = request.end_timestamp?.slice(0, 10) ?? '';
  const params = Object.entries(request.execution_config ?? {});

  const rows: [string, React.ReactNode][] = [
    ['Strategy', `${props.strategy.name} (version ${props.strategy.version})`],
    ['Template', coreInfo(entry.strategy_key).name],
    [
      layout === 'single' ? 'Instrument' : 'Instruments',
      <ul key="i" className="space-y-0.5">
        {ids.map((id, index) => {
          const status = props.statuses[index];
          return (
            <li key={id}>
              {layout !== 'single' && `${slotLabel(layout, index)}: `}
              <span className="font-medium">{symbolOf(props.instruments, id)}</span>
              {status?.kind === 'ok' && (
                <span className="text-muted-foreground"> &middot; {status.message}</span>
              )}
            </li>
          );
        })}
      </ul>,
    ],
    ['Timeframe', 'Daily (1D), historical data'],
    ['Dates', `${formatDate(start)} to ${formatDate(end)} (IST, inclusive)`],
    ['Initial capital', formatINR(request.initial_capital)],
    ['Quantity per trade', formatNumber(request.quantity, 0)],
    isRules(entry)
      ? ['Rules', <RulesSummary key="r" config={props.strategy.strategy_config} />]
      : [
          'Parameters',
          params.length === 0 ? (
            'None'
          ) : (
            <span key="p" className="font-mono text-xs">
              {params.map(([k, v]) => `${k} = ${String(v)}`).join(', ')}
            </span>
          ),
        ],
    ['Slippage', `${formatNumber(request.slippage_bps, 2)} bps`],
    ['Brokerage', `${formatNumber((request.brokerage_rate ?? 0) * 100, 4)}% of trade value`],
  ];
  const v = props.mode === 'validation' ? props.settings : null;
  if (v) {
    const wf = v.walk_forward!;
    const grid = Object.entries(wf.parameter_grid ?? {});
    rows.push(
      [
        'Walk-forward',
        `Train ${wf.train_bars} + validation ${wf.validation_bars} + test ${wf.test_bars} bars, moving ${wf.step_bars ?? wf.test_bars} bars per window`,
      ],
      [
        'Parameter search',
        grid.length === 0 ? (
          'None: the parameters above on every window'
        ) : (
          <span key="g" className="font-mono text-xs">
            {grid.map(([k, values]) => `${k} in {${values.join(', ')}}`).join(', ')}
          </span>
        ),
      ],
      [
        'Regime stress',
        v.regimes!.source === 'model' ? (
          <div key="rm" className="space-y-1">
            <p>Market regime model</p>
            <ModelOverlapNote modelId={v.regimes!.model_id ?? ''} start={start} end={end} />
          </div>
        ) : (
          `Rule-based: ${v.regimes!.trend_window}-day trend average, ${v.regimes!.volatility_window}-day volatility`
        ),
      ],
      [
        'Monte Carlo',
        `${formatNumber(v.monte_carlo!.simulations, 0)} simulations, seed ${v.monte_carlo!.seed}`,
      ],
    );
  }

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
            {props.mode === 'validation'
              ? 'Check the settings. The validation starts when you submit: a backtest, walk-forward windows, regime stress and Monte Carlo, all on historical data. It places no orders.'
              : 'Check the settings. The backtest starts when you submit; it runs on historical data and places no orders.'}
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
        {props.warmup && (
          <p
            className={cn(
              'flex items-start gap-1.5 text-sm',
              props.warmup.insufficient ? 'font-medium text-warning' : 'text-muted-foreground',
            )}
          >
            {props.warmup.insufficient && (
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            )}
            {props.warmup.text}
          </p>
        )}
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
          {props.pending ? <Spinner /> : <Play />}{' '}
          {props.mode === 'validation' ? 'Submit validation' : 'Submit backtest'}
        </Button>
      </div>
    </div>
  );
}
