import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import type { IndicatorInfo } from '@/features/indicators/queries';
import { useCreateStrategy, useUpdateStrategy } from '@/features/strategies/queries';
import { NO_CODE_BACKTEST_NOTE } from '@/features/strategies/strategy-kind';
import { cn } from '@/lib/utils';
import {
  NAME_MAX,
  outputsByType,
  problemPlace,
  problemsOf,
  renameReferences,
  sideSentence,
  STEPS,
  toConfig,
  validateDraft,
  type Draft,
  type Problems,
  type StepKey,
} from './builder-model';
import { ConditionsEditor } from './ConditionsEditor';
import { IndicatorsEditor } from './IndicatorsEditor';
import { ParametersEditor } from './ParametersEditor';

/** Pydantic prefixes model-level messages with "Value error, "; the rest is the reason. */
const cleanMessage = (text: string) => text.replace(/^Value error, /, '');

/** The backend's reasons for refusing a save, one line each. */
function saveMessages(error: unknown): string[] {
  if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
    return Object.entries(error.fieldErrors).map(([field, message]) =>
      field === 'name' ? `Name: ${cleanMessage(message)}` : cleanMessage(message),
    );
  }
  return [(error as Error).message];
}

function StepNav(props: {
  step: StepKey;
  counts: Record<StepKey, number>;
  showProblems: boolean;
  onGo: (step: StepKey) => void;
}) {
  return (
    <nav aria-label="Builder steps">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {STEPS.map((s, i) => {
          const current = s.key === props.step;
          const count = props.showProblems ? props.counts[s.key] : 0;
          return (
            <li key={s.key} className="min-w-0">
              <button
                type="button"
                aria-current={current ? 'step' : undefined}
                onClick={() => props.onGo(s.key)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  current
                    ? 'border-primary bg-primary font-medium text-primary-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <span className={cn('tabular-nums', !current && 'text-muted-foreground')}>
                  {i + 1}.
                </span>
                <span className="min-w-0 truncate">{s.title}</span>
                {count > 0 && (
                  <span className="ml-auto rounded-full bg-destructive px-1.5 text-xs text-white">
                    {count}
                    <span className="sr-only"> problem(s)</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Review(props: {
  draft: Draft;
  problems: Problems;
  outputs: ReturnType<typeof outputsByType>;
  saveErrors: string[] | null;
  onGo: (step: StepKey) => void;
}) {
  const { draft, problems, outputs } = props;
  const ok = Object.keys(problems).length === 0;
  const config = ok ? toConfig(draft, outputs) : null;

  return (
    <div className="space-y-5">
      <section aria-labelledby="review-summary" className="space-y-2">
        <h3 id="review-summary" className="font-medium">
          Summary
        </h3>
        <p className="text-sm">
          <span className="font-medium">{draft.name.trim() || 'Unnamed strategy'}</span>
          {draft.description.trim() && (
            <span className="text-muted-foreground"> &middot; {draft.description.trim()}</span>
          )}
        </p>
        {config ? (
          <ul className="space-y-1 text-sm">
            <li>{sideSentence('entry', config.entry_conditions)}</li>
            <li>{sideSentence('exit', config.exit_conditions)}</li>
            <li className="text-muted-foreground">
              {config.indicators.length} indicator(s), {Object.keys(config.parameters).length}{' '}
              parameter(s).
            </li>
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="review-check" className="space-y-2">
        <h3 id="review-check" className="font-medium">
          Validation
        </h3>
        {ok ? (
          <p role="status" className="flex items-start gap-2 text-sm">
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            No problems found in the browser. The backend checks the strategy again when you save.
          </p>
        ) : (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/30 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertCircle aria-hidden className="size-4 text-destructive" />
              Fix these before saving:
            </p>
            <ul className="space-y-1 text-sm">
              {STEPS.filter((s) => s.key !== 'review').flatMap((s) =>
                problemsOf(problems, s.key).map((key) => (
                  <li key={key} className="flex flex-wrap items-baseline gap-x-2">
                    <button
                      type="button"
                      className="text-primary underline-offset-2 hover:underline"
                      onClick={() => props.onGo(s.key)}
                    >
                      {s.title}
                    </button>
                    <span>
                      <span className="text-muted-foreground">{problemPlace(key)}:</span>{' '}
                      {problems[key]}
                    </span>
                  </li>
                )),
              )}
            </ul>
          </div>
        )}
        {props.saveErrors && (
          <div role="alert" className="space-y-1 rounded-md border border-destructive/30 p-3">
            <p className="text-sm font-medium">The backend did not save the strategy:</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {props.saveErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="review-json" className="space-y-2">
        <h3 id="review-json" className="font-medium">
          Configuration (StrategyConfig v1)
        </h3>
        {config ? (
          <pre
            aria-label="Configuration JSON"
            className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
          >
            {JSON.stringify(config, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            Shown here once the problems above are fixed. This is exactly what will be saved.
          </p>
        )}
      </section>

      <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        {NO_CODE_BACKTEST_NOTE}
      </p>
    </div>
  );
}

/**
 * The six-step no-code builder. It edits a draft in the browser; nothing is sent
 * until Save, which POSTs (new) or PATCHes (existing) /strategies with the
 * StrategyConfig shown on the Review step.
 */
export function NoCodeBuilder(props: {
  initial: Draft;
  strategyId?: string;
  catalogue: IndicatorInfo[];
}) {
  const navigate = useNavigate();
  const create = useCreateStrategy();
  const update = useUpdateStrategy();
  const [draft, setDraft] = useState(props.initial);
  const [step, setStep] = useState<StepKey>('basics');
  const [showProblems, setShowProblems] = useState(Boolean(props.strategyId));
  const [saveErrors, setSaveErrors] = useState<string[] | null>(null);

  const outputs = useMemo(() => outputsByType(props.catalogue), [props.catalogue]);
  const problems = useMemo(() => validateDraft(draft, outputs), [draft, outputs]);
  const counts = Object.fromEntries(
    STEPS.map((s) => [s.key, problemsOf(problems, s.key).length]),
  ) as Record<StepKey, number>;

  const index = STEPS.findIndex((s) => s.key === step);
  const current = STEPS[index]!;
  const saving = create.isPending || update.isPending;
  const edit = (patch: Partial<Draft>) => {
    setSaveErrors(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const go = (next: StepKey) => {
    setShowProblems(true);
    setStep(next);
  };

  async function save() {
    setShowProblems(true);
    setSaveErrors(null);
    if (Object.keys(problems).length > 0) {
      setStep('review');
      return;
    }
    const config = toConfig(draft, outputs);
    const name = draft.name.trim();
    const description = draft.description.trim();
    try {
      const saved = props.strategyId
        ? await update.mutateAsync({
            id: props.strategyId,
            body: { name, description, strategy_config: config },
          })
        : await create.mutateAsync({
            name,
            description: description || null,
            strategy_type: 'NO_CODE',
            strategy_config: config,
          });
      navigate(`/app/strategies/${saved.id}`);
    } catch (error) {
      setStep('review');
      setSaveErrors(saveMessages(error));
    }
  }

  return (
    <div className="space-y-6">
      <StepNav step={step} counts={counts} showProblems={showProblems} onGo={go} />

      <section
        aria-labelledby="builder-step"
        className="min-w-0 space-y-4 rounded-xl border bg-card shadow-card p-4 sm:p-6"
      >
        <h2 id="builder-step" className="text-lg font-semibold">
          Step {index + 1} of {STEPS.length}: {current.title}
        </h2>

        {step === 'basics' && (
          <div className="space-y-4">
            <FormField
              label="Name"
              required
              error={showProblems ? problems.name : undefined}
              hint={`Up to ${NAME_MAX} characters.`}
            >
              {(field) => (
                <Input
                  {...field}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  value={draft.name}
                  onChange={(e) => edit({ name: e.target.value })}
                />
              )}
            </FormField>
            <FormField label="Description" hint="Optional.">
              {(field) => (
                <Textarea
                  {...field}
                  rows={3}
                  value={draft.description}
                  onChange={(e) => edit({ description: e.target.value })}
                />
              )}
            </FormField>
          </div>
        )}

        {step === 'parameters' && (
          <ParametersEditor
            rows={draft.params}
            problems={problems}
            showProblems={showProblems}
            onChange={(params) => edit({ params })}
          />
        )}

        {step === 'indicators' && (
          <IndicatorsEditor
            draft={draft}
            catalogue={props.catalogue}
            problems={problems}
            showProblems={showProblems}
            onSave={(value, i) => {
              setSaveErrors(null);
              setDraft((d) => {
                if (i === null) return { ...d, indicators: [...d.indicators, value] };
                const old = d.indicators[i]!;
                const renamed = renameReferences(d, old.name, value.name);
                return {
                  ...renamed,
                  indicators: d.indicators.map((x, j) => (j === i ? value : x)),
                };
              });
            }}
            onRemove={(i) => edit({ indicators: draft.indicators.filter((_, j) => j !== i) })}
          />
        )}

        {(step === 'entry' || step === 'exit') && (
          <ConditionsEditor
            side={step}
            draft={draft}
            outputs={outputs}
            problems={problems}
            showProblems={showProblems}
            onChange={(rows) => edit(step === 'entry' ? { entry: rows } : { exit: rows })}
          />
        )}

        {step === 'review' && (
          <Review
            draft={draft}
            problems={problems}
            outputs={outputs}
            saveErrors={saveErrors}
            onGo={go}
          />
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={index === 0}
          onClick={() => go(STEPS[index - 1]!.key)}
        >
          <ArrowLeft /> Back
        </Button>
        {step === 'review' ? (
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? <Spinner /> : <Save />}
            {props.strategyId ? 'Save changes' : 'Create strategy'}
          </Button>
        ) : (
          <Button type="button" onClick={() => go(STEPS[index + 1]!.key)}>
            Next <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}
