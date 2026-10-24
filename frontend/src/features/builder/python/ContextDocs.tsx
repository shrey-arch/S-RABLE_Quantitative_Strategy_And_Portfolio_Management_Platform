import { BookOpen, ShieldCheck } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { SANDBOX_LABELS, SANDBOX_NOTES } from './sandbox-model';
import { useSandboxReference } from './queries';

/**
 * Feature 6: what the code may use, and the limits it runs under. Every line
 * comes from GET /sandbox/reference, so this panel and the sandbox can never
 * drift apart.
 */
export function ContextDocs(props: { onInsertExample?: (code: string) => void }) {
  const query = useSandboxReference();
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (!query.data) return <Skeleton className="h-64 w-full" />;
  const reference = query.data;

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <BookOpen aria-hidden className="size-4 text-muted-foreground" />
          Write <code className="font-mono">{reference.entry_point}</code>
        </p>
        <span
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground"
          title={SANDBOX_NOTES[reference.sandbox]}
        >
          <ShieldCheck aria-hidden className="size-3.5" />
          {SANDBOX_LABELS[reference.sandbox] ?? reference.sandbox}
        </span>
      </div>

      <section aria-label="What the code is given" className="space-y-2">
        <h3 className="font-semibold">What the code is given</h3>
        <dl className="space-y-2">
          {reference.context_api.map((entry) => {
            const row = entry as Record<string, string>;
            return (
              <div key={row.name} className="rounded-md border bg-card shadow-card p-2">
                <dt className="font-mono text-xs">{row.signature}</dt>
                <dd className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{row.returns}</span> &mdash;{' '}
                  {row.description}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section aria-label="What the code returns" className="space-y-2">
        <h3 className="font-semibold">What to return</h3>
        <ul className="space-y-1 text-xs">
          {reference.return_values.map((value) => {
            const row = value as Record<string, string>;
            return (
              <li key={row.value} className="flex flex-wrap gap-2">
                <code className="font-mono">{row.value}</code>
                <span className="text-muted-foreground">{row.meaning}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Indicators" className="space-y-2">
        <h3 className="font-semibold">Indicators you can ask for</h3>
        <ul className="space-y-1 text-xs">
          {reference.indicators.map((indicator) => {
            const row = indicator as Record<string, string | string[]>;
            return (
              <li key={String(row.key)}>
                <code className="font-mono">{String(row.example)}</code>{' '}
                <span className="text-muted-foreground">
                  {String(row.name)}
                  {Array.isArray(row.outputs) && row.outputs.length > 1
                    ? ` (gives ${row.outputs.join(', ')})`
                    : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Rules" className="space-y-2">
        <h3 className="font-semibold">Rules</h3>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {reference.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>

      <section aria-label="Limits" className="space-y-2">
        <h3 className="font-semibold">Limits</h3>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          {reference.limits.map((limit) => {
            const row = limit as Record<string, string>;
            return (
              <div key={row.name} className="rounded-md border bg-card shadow-card p-2">
                <dt className="text-muted-foreground">{row.name}</dt>
                <dd className="font-medium tabular-nums">{row.value}</dd>
                {row.detail && <dd className="text-muted-foreground">{row.detail}</dd>}
              </div>
            );
          })}
        </dl>
      </section>

      {props.onInsertExample && (
        <section aria-label="Example" className="space-y-2">
          <h3 className="font-semibold">Example</h3>
          <pre className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-2 text-xs">
            {reference.example}
          </pre>
          <button
            type="button"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => props.onInsertExample!(reference.example)}
          >
            Put this example in the editor
          </button>
        </section>
      )}
    </div>
  );
}
