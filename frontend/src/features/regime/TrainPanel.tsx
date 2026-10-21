import { Loader2, Play } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { DateRangeField } from '@/components/ui/date-range-field';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { InstrumentPicker } from '@/features/instruments/InstrumentPicker';
import { useCoverage } from '@/features/instruments/market-data';
import { useInstruments } from '@/features/instruments/queries';
import { Section } from '@/features/results/parts';
import { formatDate, formatDateTime, formatNumber, MISSING } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTrainRegimeModel } from './queries';
import {
  buildTrainRequest,
  completeDays,
  dimensionMeanings,
  emptyTrainDraft,
  isSupervisedKind,
  KIND_HELP,
  KIND_LABELS,
  KIND_SHORT,
  MODEL_KINDS,
  MODEL_STATUS_LABELS,
  modelName,
  TRAIN_LIMITS,
  type ModelKind,
  type RegimeModelSummary,
  type TrainDraft,
  type TrainRequest,
} from './regime-model';

const STATUS_CLASSES: Record<RegimeModelSummary['status'], string> = {
  TRAINING: 'border-info/30 bg-info/10 text-info',
  READY: 'border-success/30 bg-success/10 text-success',
  FAILED: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function ModelStatus({ status }: { status: RegimeModelSummary['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_CLASSES[status],
      )}
    >
      {status === 'TRAINING' && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
      {MODEL_STATUS_LABELS[status]}
    </span>
  );
}

function settingsText(s: Record<string, unknown>, vixSymbol?: string | null) {
  const dates =
    s.start_date || s.end_date
      ? `${s.start_date ? formatDate(String(s.start_date)) : 'first bar'} to ${s.end_date ? formatDate(String(s.end_date)) : 'last bar'}`
      : 'all stored bars';
  const kind = (s.model_kind ?? 'GMM') as ModelKind;
  if (isSupervisedKind(kind))
    return `${dates}; ${KIND_SHORT[kind]}; next ${String(s.horizon_days ?? MISSING)} days; ${s.vix_instrument_id ? `India VIX ${vixSymbol ?? ''}`.trim() : 'no India VIX'}; seed ${String(s.random_state ?? MISSING)}`;
  const candidates = Array.isArray(s.candidate_components)
    ? s.candidate_components.join(', ')
    : MISSING;
  return `${dates}; windows ${String(s.volatility_window ?? MISSING)}/${String(s.trend_window ?? MISSING)} days; clusters ${candidates}; seed ${String(s.random_state ?? MISSING)}`;
}

/** Every model, newest first, with what it was trained on. */
export function ModelList({ models }: { models: RegimeModelSummary[] }) {
  if (models.length === 0)
    return <p className="text-sm text-muted-foreground">No model has been trained yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <caption className="sr-only">Regime models</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-2 font-medium">Model</th>
            <th className="py-2 pr-2 font-medium">Status</th>
            <th className="py-2 pr-2 font-medium">Type</th>
            <th className="py-2 pr-2 font-medium">Reference</th>
            <th className="py-2 pr-2 font-medium">Settings</th>
            <th className="py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.id} className="border-b last:border-0 align-top">
              <td className="py-2 pr-2 whitespace-nowrap">
                {m.status === 'READY' ? (
                  <Link
                    to={`/app/regime?tab=model&model=${m.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {modelName(m)}
                  </Link>
                ) : (
                  <span className="font-medium">{modelName(m)}</span>
                )}
                {m.is_active && <p className="text-xs text-success">Active</p>}
                {m.trained_by_you && (
                  <p className="text-xs text-muted-foreground">Trained by you</p>
                )}
              </td>
              <td className="py-2 pr-2">
                <ModelStatus status={m.status} />
                {m.error_message && (
                  <p className="mt-1 text-xs text-destructive">{m.error_message}</p>
                )}
              </td>
              <td className="py-2 pr-2">{KIND_SHORT[m.model_kind]}</td>
              <td className="py-2 pr-2">{m.instrument.symbol ?? 'Deleted instrument'}</td>
              <td className="py-2 pr-2 text-xs text-muted-foreground">
                {settingsText(m.settings, m.vix_instrument?.symbol)}
              </td>
              <td className="py-2 whitespace-nowrap">{formatDateTime(m.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function problemText(error: unknown) {
  if (error instanceof ApiError) {
    const fields = Object.values(error.fieldErrors).map((m) => m.replace(/^Value error, /, ''));
    return fields.length ? fields.join(' ') : error.message;
  }
  return (error as Error).message;
}

/** Train a new model on a reference instrument (POST /regime/models). */
export function TrainPanel(props: {
  models: RegimeModelSummary[];
  /** The active model's reference instrument, preselected. */
  defaultInstrumentId: string;
}) {
  const [draft, setDraft] = useState<TrainDraft>(() => emptyTrainDraft(props.defaultInstrumentId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<TrainRequest | null>(null);
  const train = useTrainRegimeModel();
  // A double-click must not start two trainings (the button disables a render later).
  const sending = useRef(false);
  const training = props.models.find((m) => m.status === 'TRAINING');
  const range = { start: draft.start || undefined, end: draft.end || undefined };
  const coverage = useCoverage(draft.instrumentId, range, Boolean(draft.instrumentId));
  const bars = coverage.data?.row_count ?? null;
  const complete = bars === null ? null : completeDays(bars, draft);
  const supervised = isSupervisedKind(draft.kind);
  const instruments = useInstruments().data ?? [];
  const vixSymbol = instruments.find((i) => i.id === draft.vixId)?.symbol;
  const horizon = /^\d+$/.test(draft.horizon.trim()) ? Number(draft.horizon) : 20;

  const change = (patch: Partial<TrainDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setReview(null);
    train.reset();
  };

  const onReview = () => {
    const built = buildTrainRequest(draft);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setReview(built.request);
  };

  const onStart = () => {
    if (!review || sending.current) return;
    sending.current = true;
    train.mutate(review, {
      onSuccess: (model) => {
        sending.current = false;
        toast.success(`${modelName(model)} is training.`);
        setReview(null);
      },
      onError: () => {
        sending.current = false;
      },
    });
  };

  return (
    <div className="space-y-6">
      <Section
        id="train"
        title="Train a new model"
        description="Learns from the reference instrument's stored daily bars, split in time order: 70% of the days train it, 15% choose its settings, 15% test it once. When it is ready it becomes the active model for everyone."
      >
        {training && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-sm"
          >
            <Loader2 aria-hidden className="size-4 animate-spin" />{' '}
            {`${modelName(training)} is training. This page checks every few seconds.`}
          </p>
        )}
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onReview();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Model type" hint={KIND_HELP[draft.kind]}>
              {(f) => (
                <NativeSelect
                  {...f}
                  className="w-full"
                  value={draft.kind}
                  onChange={(e) => change({ kind: e.target.value as ModelKind })}
                >
                  {MODEL_KINDS.map((k) => (
                    <NativeSelectOption key={k} value={k}>
                      {KIND_LABELS[k]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <div className="hidden sm:block" />
            <FormField
              label="Reference instrument"
              error={errors.instrumentId}
              hint="The model is trained on it and describes it: the Nifty 50 index (NIFTY50) is recommended."
            >
              {(f) => (
                <InstrumentPicker
                  {...f}
                  className="w-full"
                  value={draft.instrumentId}
                  onChange={(id) => change({ instrumentId: id })}
                />
              )}
            </FormField>
            <div className="space-y-2">
              <DateRangeField
                value={{ start: draft.start, end: draft.end }}
                onChange={(v) => change({ start: v.start, end: v.end })}
                error={errors.range}
                labels={{ start: 'From (optional)', end: 'To (optional)' }}
              />
              <p aria-live="polite" className="text-xs text-muted-foreground">
                {!draft.instrumentId
                  ? 'Empty dates use every stored daily bar.'
                  : bars === null
                    ? 'Checking stored data...'
                    : supervised
                      ? `${formatNumber(bars, 0)} daily bars in the range; ${formatNumber(complete, 0)} labelled days after the 252-day warm-up and the horizon (training needs ${TRAIN_LIMITS.minLabelledDays}).`
                      : `${formatNumber(bars, 0)} daily bars in the range; ${formatNumber(complete, 0)} with complete features (training needs ${TRAIN_LIMITS.minCompleteDays}).`}
              </p>
            </div>
            {supervised ? (
              <>
                <FormField
                  label="Label horizon (trading days)"
                  error={errors.horizon}
                  hint="Each label describes this many days ahead; the splits are separated by the same gap. 5 to 60."
                >
                  {(f) => (
                    <Input
                      {...f}
                      inputMode="numeric"
                      value={draft.horizon}
                      onChange={(e) => change({ horizon: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField
                  label="India VIX (optional)"
                  error={errors.vixId}
                  hint="Adds VIX features and the VIX part of the risk-off rule. Without it, risk-off uses the drawdown only."
                >
                  {(f) => (
                    <div className="flex gap-2">
                      <InstrumentPicker
                        {...f}
                        className="w-full"
                        value={draft.vixId}
                        onChange={(id) => change({ vixId: id })}
                      />
                      {draft.vixId && (
                        <Button type="button" variant="ghost" onClick={() => change({ vixId: '' })}>
                          Clear
                        </Button>
                      )}
                    </div>
                  )}
                </FormField>
                <div
                  role="region"
                  aria-label="What each dimension means"
                  className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm sm:col-span-2"
                >
                  <p className="font-medium">
                    Three classifiers, one per dimension, each labelling the next {horizon} days:
                  </p>
                  <dl className="space-y-1">
                    {dimensionMeanings(horizon).map((m) => (
                      <div key={m.name}>
                        <dt className="inline font-medium">{m.name}: </dt>
                        <dd className="inline text-muted-foreground">{m.text}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    Features use only data up to each day. The test accuracy is compared with the
                    70% target and with two baselines, and shown as met or not met.
                  </p>
                </div>
              </>
            ) : (
              <>
                <FormField
                  label="Volatility window (days)"
                  error={errors.volatilityWindow}
                  hint="5 to 120."
                >
                  {(f) => (
                    <Input
                      {...f}
                      inputMode="numeric"
                      value={draft.volatilityWindow}
                      onChange={(e) => change({ volatilityWindow: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField label="Trend window (days)" error={errors.trendWindow} hint="5 to 120.">
                  {(f) => (
                    <Input
                      {...f}
                      inputMode="numeric"
                      value={draft.trendWindow}
                      onChange={(e) => change({ trendWindow: e.target.value })}
                    />
                  )}
                </FormField>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Cluster counts to try</legend>
                  <div className="flex flex-wrap gap-3">
                    {TRAIN_LIMITS.components.map((n) => (
                      <label key={n} className="inline-flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={draft.components.includes(n)}
                          onChange={(e) =>
                            change({
                              components: e.target.checked
                                ? [...draft.components, n]
                                : draft.components.filter((c) => c !== n),
                            })
                          }
                        />
                        {n}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The count with the lowest BIC on the validation days is kept.
                  </p>
                  {errors.components && (
                    <p role="alert" className="text-sm text-destructive">
                      {errors.components}
                    </p>
                  )}
                </fieldset>
              </>
            )}
            <FormField
              label="Seed"
              error={errors.seed}
              hint="The same data and seed give the same model."
            >
              {(f) => (
                <Input
                  {...f}
                  inputMode="numeric"
                  value={draft.seed}
                  onChange={(e) => change({ seed: e.target.value })}
                />
              )}
            </FormField>
          </div>
          {!review && (
            <Button type="submit" disabled={Boolean(training)}>
              Review training
            </Button>
          )}
        </form>

        {review && (
          <div
            role="region"
            aria-label="Confirm training"
            className="space-y-3 rounded-md border p-4"
          >
            <p className="text-sm">
              {`Train Model ${(props.models[0]?.number ?? 0) + 1}: ${settingsText(review as unknown as Record<string, unknown>, vixSymbol)}.`}
            </p>
            <p className="text-sm text-muted-foreground">
              When it finishes it replaces the active model for everyone; earlier models stay
              listed.
            </p>
            {train.isError && (
              <p role="alert" className="text-sm text-destructive">
                {problemText(train.error)}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setReview(null)}>
                Back
              </Button>
              <Button type="button" onClick={onStart} disabled={train.isPending}>
                {train.isPending ? <Spinner /> : <Play />} Start training
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section
        id="models"
        title="Models"
        description="Newest first. The newest ready model is active."
      >
        <ModelList models={props.models} />
      </Section>
    </div>
  );
}
