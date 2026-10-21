import { AlertCircle, Play, ShieldCheck } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/api/errors';
import { InstrumentPicker } from '@/features/instruments/InstrumentPicker';
import { tradable } from '@/features/paper/paper-model';
import { PriceChart } from '@/features/instruments/PriceChart';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  ACTION_LABELS,
  BAR_CHOICES,
  buildTestRun,
  emptyTestRun,
  SANDBOX_LABELS,
  SANDBOX_NOTES,
  signalMarkers,
  TEST_RUN_NOTE,
  testRunSummary,
  type StrategyCodeError,
  type TestRun,
  type TestRunDraft,
} from './sandbox-model';
import { useTestRun } from './queries';

const ACTION_TONE: Record<string, string> = {
  BUY: 'text-success',
  SELL: 'text-destructive',
  EXIT: 'text-warning',
  HOLD: 'text-muted-foreground',
};

/** The structured error the backend sent, with the line it points at. */
export function CodeErrorBox(props: {
  error: StrategyCodeError;
  onGoToLine?: (line: number) => void;
}) {
  const { error } = props;
  const where =
    error.phase === 'check'
      ? 'The code was refused before it ran'
      : error.phase === 'load'
        ? 'The code failed while loading'
        : 'The code failed while running';
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
    >
      <div className="flex gap-2">
        <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">
            {where}
            {error.line ? `, at line ${error.line}` : ''}
            {error.bar_date ? ` (bar of ${error.bar_date.slice(0, 10)})` : ''}:
          </p>
          <p className="break-words">
            <span className="font-mono">{error.exception}</span>: {error.message}
          </p>
          {error.line && props.onGoToLine && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => props.onGoToLine!(error.line!)}
            >
              Go to line {error.line}
            </Button>
          )}
        </div>
      </div>
      {error.traceback && (
        <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 text-xs whitespace-pre-wrap">
          {error.traceback}
        </pre>
      )}
    </div>
  );
}

function Signals(props: { run: TestRun }) {
  const { run } = props;
  const shown = useMemo(
    () => run.signals.filter((signal) => signal.changed || signal.logs.length > 0).slice(-60),
    [run.signals],
  );
  if (!shown.length) {
    return (
      <p className="text-sm text-muted-foreground">
        The code held on every bar and logged nothing.
      </p>
    );
  }
  return (
    <ol className="max-h-72 divide-y overflow-y-auto text-sm" aria-label="Signals and logs">
      {shown.map((signal) => (
        <li key={signal.index} className="flex gap-3 py-1.5" data-action={signal.action}>
          <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
            {signal.date.slice(0, 10)}
          </span>
          <span className={cn('w-12 shrink-0 text-xs font-medium', ACTION_TONE[signal.action])}>
            {ACTION_LABELS[signal.action] ?? signal.action}
          </span>
          <span className="w-20 shrink-0 text-xs tabular-nums">
            {signal.changed ? `hold ${formatNumber(signal.position, 0)}` : ''}
          </span>
          <span className="min-w-0 break-words text-xs text-muted-foreground">
            {signal.logs.join(' \u00b7 ')}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Feature 6: run the saved code over recent bars in the backend's sandbox, and
 * show the signals on a chart with the logs and any error. Nothing is stored.
 */
export function TestRunPanel(props: { strategyId?: string; onGoToLine?: (line: number) => void }) {
  const [draft, setDraft] = useState<TestRunDraft>(emptyTestRun);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refused, setRefused] = useState<StrategyCodeError | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const testRun = useTestRun(props.strategyId);
  const run = testRun.data;
  const set = (patch: Partial<TestRunDraft>) => setDraft((d) => ({ ...d, ...patch }));

  if (!props.strategyId) {
    return (
      <EmptyState
        title="Save the strategy to test it"
        description="A test run needs a saved strategy: the backend runs the saved code, never the text in the box."
      />
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const built = buildTestRun(draft);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setRefused(null);
    setFailure(null);
    try {
      await testRun.mutateAsync(built.body);
    } catch (error) {
      // A refused code check comes back as a 422 whose detail is the structured error.
      const detail = error instanceof ApiError ? error.detail : undefined;
      if (detail && detail.code === 'STRATEGY_CODE_ERROR') {
        setRefused(detail as unknown as StrategyCodeError);
      } else {
        setFailure((error as Error).message);
      }
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Instrument" error={errors.instrument_id} hint="NSE equities and ETFs.">
          {(field) => (
            <InstrumentPicker
              {...field}
              value={draft.instrumentId}
              filter={tradable}
              onChange={(id) => set({ instrumentId: id })}
            />
          )}
        </FormField>
        <FormField label="Bars" hint="The most recent stored daily bars.">
          {(field) => (
            <NativeSelect
              {...field}
              value={String(draft.bars)}
              onChange={(e) => set({ bars: Number(e.target.value) })}
            >
              {BAR_CHOICES.map((count) => (
                <NativeSelectOption key={count} value={String(count)}>
                  {count}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label="Quantity" error={errors.quantity} hint="Shares a BUY or SELL holds.">
          {(field) => (
            <Input
              {...field}
              inputMode="numeric"
              value={draft.quantity}
              onChange={(e) => set({ quantity: e.target.value })}
            />
          )}
        </FormField>
        <FormField
          label="Parameters"
          error={errors.parameters}
          hint="One per line, as lookback = 20. They arrive as context.params."
        >
          {(field) => (
            <Textarea
              {...field}
              rows={2}
              className="font-mono text-xs"
              placeholder="lookback = 20"
              value={draft.parameters}
              onChange={(e) => set({ parameters: e.target.value })}
            />
          )}
        </FormField>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={testRun.isPending}>
            {testRun.isPending ? <Spinner /> : <Play />} Test run
          </Button>
        </div>
      </form>

      <p className="text-xs text-muted-foreground">{TEST_RUN_NOTE}</p>

      {refused && <CodeErrorBox error={refused} onGoToLine={props.onGoToLine} />}
      {failure && <ErrorState error={new Error(failure)} />}

      {run && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium" data-testid="test-run-summary">
              {run.symbol}: {testRunSummary(run)}
            </p>
            <span
              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground"
              title={SANDBOX_NOTES[run.sandbox]}
              data-testid="sandbox-kind"
            >
              <ShieldCheck aria-hidden className="size-3.5" />
              {SANDBOX_LABELS[run.sandbox] ?? run.sandbox}
            </span>
          </div>
          {run.error && <CodeErrorBox error={run.error} onGoToLine={props.onGoToLine} />}
          <PriceChart
            bars={run.bars.map((bar) => ({
              time: bar.date.slice(0, 10),
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
            }))}
            mode="candles"
            label={`${run.symbol} with the test run's signals`}
            markers={signalMarkers(run).map((marker) => ({
              time: marker.time.slice(0, 10),
              side: marker.side,
              text: marker.text,
            }))}
          />
          <Signals run={run} />
        </div>
      )}
    </div>
  );
}
