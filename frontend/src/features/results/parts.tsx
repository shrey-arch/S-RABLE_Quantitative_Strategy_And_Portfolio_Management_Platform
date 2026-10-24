import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MISSING } from '@/lib/format';
import { cn } from '@/lib/utils';
import { metricText, metricValue, type ExecutionResults, type MetricDef } from './results-model';

/** A labelled section of a results tab. */
export function Section(props: {
  id: string;
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${props.id}-heading`}
      className="space-y-4 rounded-xl border bg-card shadow-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="space-y-1">
          {props.eyebrow && <p className="micro-label">{props.eyebrow}</p>}
          <h2 id={`${props.id}-heading`} className="text-base font-semibold tracking-[-0.01em]">
            {props.title}
          </h2>
          {props.description && (
            <p className="text-sm text-muted-foreground">{props.description}</p>
          )}
        </div>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

/** A row of a definition list. */
export function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[13rem_1fr]">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 break-words">{props.children}</dd>
    </div>
  );
}

/** "-" with the backend's reason next to it (visible, not only on hover). */
export function NotAvailable(props: { reason?: string }) {
  return (
    <span className="text-muted-foreground">
      {MISSING}
      <span className="ml-2 text-xs">{props.reason ?? 'Not available.'}</span>
    </span>
  );
}

const signClass = (value: number | null, colored?: boolean) =>
  !colored || value === null
    ? ''
    : value > 0
      ? 'text-success'
      : value < 0
        ? 'text-destructive'
        : '';

/**
 * One metric: its value as the API sent it (formatted), a tooltip with its
 * definition and basis, and when the value is null an em dash with the reason.
 */
export function MetricTile(props: {
  results: ExecutionResults;
  metric: MetricDef;
  extra?: ReactNode;
}) {
  const { metric, results } = props;
  const value = metricValue(results, metric);
  const reason = results.null_reasons[metric.key];
  const about = `${metric.definition} ${metric.basis(results.basis)}`;
  return (
    <div role="group" aria-label={metric.label} className="rounded-lg border border-border bg-surface-row p-3 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[0.6875rem] font-semibold tracking-[0.06em] text-subtle-foreground">
          {metric.label}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`About ${metric.label}`}
              className="-m-1 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Info aria-hidden className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-left">{about}</TooltipContent>
        </Tooltip>
      </div>
      <p
        data-metric={metric.key}
        className={cn(
          'mt-1.5 text-xl font-semibold tabular-nums tracking-[-0.01em]',
          signClass(value, metric.colored),
          value === null && 'text-muted-foreground',
        )}
      >
        {metricText(metric.format, value)}
      </p>
      {value === null && (
        <p className="text-xs text-muted-foreground">{reason ?? 'Not available.'}</p>
      )}
      {props.extra}
    </div>
  );
}
