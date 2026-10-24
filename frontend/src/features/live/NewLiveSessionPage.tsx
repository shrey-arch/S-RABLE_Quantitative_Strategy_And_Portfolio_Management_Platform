import { ArrowLeft, Play } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { InstrumentPicker } from '@/features/instruments/InstrumentPicker';
import { tradable } from '@/features/paper/paper-model';
import { usePaperAccount } from '@/features/paper/queries';
import { useMyStrategies, useRegistry } from '@/features/strategies/queries';
import { liveRunnable } from './live-strategies';
import { formatINR, formatNumber } from '@/lib/format';
import {
  buildSessionBody,
  emptySession,
  istDay,
  LIVE_AREA,
  LIVE_LABEL,
  SPEEDS,
  TIMEFRAME_LABELS,
  TIMEFRAMES,
  type CreateLiveSessionBody,
  type SessionDraft,
  type Speed,
} from './live-model';
import { LiveLabel } from './LiveViews';
import { useCreateLiveSession, useLiveStatus, useReplayDays } from './queries';

function Review(props: {
  body: CreateLiveSessionBody;
  strategy: string;
  onBack: () => void;
  onStart: () => void;
  busy: boolean;
  refusal: string | null;
}) {
  const b = props.body;
  const rows: [string, string][] = [
    ['Strategy', props.strategy],
    ['Bars', TIMEFRAME_LABELS[b.timeframe ?? '5M']],
    [
      'Clock',
      b.mode === 'REPLAY'
        ? `Replay of ${istDay(b.replay_date!)} from 09:15 at ${b.speed}x`
        : 'Delayed live: market time minus 15 minutes, today',
    ],
    ['Capital', formatINR(b.capital)],
    ['Shares per position', formatNumber(b.quantity, 0)],
    [
      'Daily loss limit',
      b.loss_limit_pct ? `${b.loss_limit_pct}% of the capital: square off and pause` : 'None',
    ],
    [
      'Maximum position value',
      b.max_position_value ? formatINR(b.max_position_value) : 'The capital (no leverage)',
    ],
    ['Slippage', `${b.slippage_bps ?? 5} bps on each fill`],
  ];
  return (
    <section
      aria-label="Review"
      className="space-y-4 rounded-xl border bg-card shadow-card p-4 sm:p-6"
    >
      <h2 className="text-lg font-semibold">Review</h2>
      {props.refusal && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          {props.refusal}
        </p>
      )}
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          {LIVE_LABEL}. Each signal on a closed bar fills at that bar&apos;s close plus slippage,
          with intraday (MIS) charges, in your paper account.
        </li>
        <li>
          Long and short positions are allowed intraday; the position never exceeds the capital.
        </li>
        <li>Open positions are squared off at 15:20; the session ends at 15:30.</li>
        <li>
          If market data stops arriving, no signals are made; after 10 minutes the session pauses.
        </li>
      </ul>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={props.onBack} disabled={props.busy}>
          Back
        </Button>
        <Button onClick={props.onStart} disabled={props.busy}>
          {props.busy ? <Spinner /> : <Play />} Start session
        </Button>
      </div>
    </section>
  );
}

/** /app/live/new: a live paper session (form, then Review). */
export default function NewLiveSessionPage() {
  const navigate = useNavigate();
  const strategies = useMyStrategies();
  const registry = useRegistry();
  const status = useLiveStatus();
  const account = usePaperAccount();
  const create = useCreateLiveSession();
  const [draft, setDraft] = useState<SessionDraft>(emptySession);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<CreateLiveSessionBody | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const days = useReplayDays(draft.instrumentId);
  const usable = useMemo(
    () => liveRunnable(strategies.data ?? [], registry.data ?? []),
    [strategies.data, registry.data],
  );
  const open = Boolean(status.data?.delayed_day);
  const replayable = (days.data ?? []).filter((d) => d.replayable);
  const set = (patch: Partial<SessionDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const available = account.data ? account.data.available_cash : null;
  const mode = draft.mode === 'DELAYED' && !open ? 'REPLAY' : draft.mode;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const built = buildSessionBody({ ...draft, mode }, available);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setRefusal(null);
    setReview(built.body);
  };

  const start = async () => {
    if (!review) return;
    setRefusal(null);
    try {
      const s = await create.mutateAsync(review);
      toast.success(`${s.name} started. ${s.clock.label}.`);
      void navigate(`/app/live/sessions/${s.id}`);
    } catch (e) {
      setRefusal((e as Error).message);
    }
  };

  const loading = strategies.isPending || registry.isPending;
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        to="/app/live"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> {LIVE_AREA}
      </Link>
      <div className="space-y-2">
        <h1 className="page-title text-3xl">New live session</h1>
        <p className="text-sm text-muted-foreground">
          A strategy trades one NSE instrument on intraday bars as the market moves. Delayed live
          runs 15 minutes behind the market during NSE hours; replay plays a recorded day from
          09:15.
        </p>
        <LiveLabel />
      </div>
      {strategies.isError || registry.isError ? (
        <ErrorState
          error={strategies.error ?? registry.error}
          onRetry={() => {
            void strategies.refetch();
            void registry.refetch();
          }}
        />
      ) : loading ? (
        <LoadingState rows={4} />
      ) : usable.length === 0 ? (
        <EmptyState
          title="No strategy to run"
          description="Save a strategy from a core template or build one without code first. Pair and multi-asset strategies cannot run live; Python strategies wait for the custom runner."
        />
      ) : review ? (
        <Review
          body={review}
          strategy={usable.find((s) => s.id === review.strategy_id)?.name ?? ''}
          onBack={() => setReview(null)}
          onStart={() => void start()}
          busy={create.isPending}
          refusal={refusal}
        />
      ) : (
        <form
          onSubmit={submit}
          noValidate
          className="space-y-5 rounded-xl border bg-card shadow-card p-4 sm:p-6"
        >
          <FormField
            label="Strategy"
            error={errors.strategy_id}
            hint="Runs with its saved parameters or rules."
          >
            {(f) => (
              <NativeSelect
                {...f}
                value={draft.strategyId}
                onChange={(e) => set({ strategyId: e.target.value })}
              >
                <NativeSelectOption value="">Choose a strategy</NativeSelectOption>
                {usable.map((s) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label="Instrument" error={errors.instrument_id} hint="NSE equities and ETFs.">
            {(f) => (
              <InstrumentPicker
                {...f}
                value={draft.instrumentId}
                filter={tradable}
                onChange={(id) => set({ instrumentId: id, replayDate: '' })}
              />
            )}
          </FormField>
          <FormField label="Bars">
            {(f) => (
              <NativeSelect
                {...f}
                value={draft.timeframe}
                onChange={(e) => set({ timeframe: e.target.value as SessionDraft['timeframe'] })}
              >
                {TIMEFRAMES.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {TIMEFRAME_LABELS[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Clock</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                className="mt-1"
                checked={mode === 'REPLAY'}
                onChange={() => set({ mode: 'REPLAY' })}
              />
              <span>
                Replay a recorded day
                <span className="block text-xs text-muted-foreground">
                  Plays the day&apos;s 1-minute bars from 09:15, through the same engine.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                className="mt-1"
                checked={mode === 'DELAYED'}
                disabled={!open}
                onChange={() => set({ mode: 'DELAYED' })}
              />
              <span>
                Delayed live
                <span className="block text-xs text-muted-foreground">
                  {open
                    ? `Today, 15 minutes behind the market (${istDay(status.data!.delayed_day!)}).`
                    : 'Only while NSE is open (09:15 to 15:30 IST, trading days).'}
                </span>
              </span>
            </label>
          </fieldset>
          {mode === 'REPLAY' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Recorded day"
                error={errors.replay_date}
                hint={
                  !draft.instrumentId
                    ? 'Choose the instrument first.'
                    : days.data && replayable.length === 0
                      ? 'No full day of 1-minute bars is recorded for it yet.'
                      : 'Days with a full session of stored 1-minute bars.'
                }
              >
                {(f) => (
                  <NativeSelect
                    {...f}
                    value={draft.replayDate}
                    disabled={!draft.instrumentId || replayable.length === 0}
                    onChange={(e) => set({ replayDate: e.target.value })}
                  >
                    <NativeSelectOption value="">Choose a day</NativeSelectOption>
                    {replayable.map((d) => (
                      <NativeSelectOption key={d.day} value={d.day}>
                        {istDay(d.day)} ({d.bars} bars)
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField label="Speed">
                {(f) => (
                  <NativeSelect
                    {...f}
                    value={String(draft.speed)}
                    onChange={(e) => set({ speed: Number(e.target.value) as Speed })}
                  >
                    {SPEEDS.map((v) => (
                      <NativeSelectOption key={v} value={String(v)}>
                        {v}x{v === 1 ? ' (real time)' : ''}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Capital (Rs)"
              error={errors.capital}
              hint={
                available !== null
                  ? `The paper account has ${formatINR(available)} available.`
                  : 'A slice of the paper account.'
              }
            >
              {(f) => (
                <Input
                  {...f}
                  inputMode="decimal"
                  value={draft.capital}
                  onChange={(e) => set({ capital: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              label="Shares per position"
              error={errors.quantity}
              hint="Held long on a buy signal, short on a sell."
            >
              {(f) => (
                <Input
                  {...f}
                  inputMode="numeric"
                  value={draft.quantity}
                  onChange={(e) => set({ quantity: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              label="Daily loss limit (%)"
              error={errors.loss_limit_pct}
              hint="Of the capital. On reaching it the session squares off and pauses. Empty for none."
            >
              {(f) => (
                <Input
                  {...f}
                  inputMode="decimal"
                  value={draft.lossLimitPct}
                  onChange={(e) => set({ lossLimitPct: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              label="Maximum position value (Rs)"
              error={errors.max_position_value}
              hint="Orders above it are refused. Empty: the capital."
            >
              {(f) => (
                <Input
                  {...f}
                  inputMode="decimal"
                  value={draft.maxPositionValue}
                  onChange={(e) => set({ maxPositionValue: e.target.value })}
                />
              )}
            </FormField>
            <FormField label="Slippage (bps)" error={errors.slippage_bps}>
              {(f) => (
                <Input
                  {...f}
                  inputMode="decimal"
                  value={draft.slippageBps}
                  onChange={(e) => set({ slippageBps: e.target.value })}
                />
              )}
            </FormField>
            <FormField label="Name (optional)" hint="Defaults to the strategy's name.">
              {(f) => (
                <Input
                  {...f}
                  value={draft.name}
                  maxLength={150}
                  onChange={(e) => set({ name: e.target.value })}
                />
              )}
            </FormField>
          </div>
          <div className="flex justify-end">
            <Button type="submit">Review</Button>
          </div>
        </form>
      )}
    </div>
  );
}
