import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/**
 * First-use guidance built only from the dashboard's own counts.
 * `done` is true / false when the count is known, null while loading or failed:
 * then the step is shown without a status rather than guessing.
 */
export interface NextStep {
  label: string;
  description: string;
  to: string;
  done: boolean | null;
  optional?: boolean;
}

export function NextSteps({ steps }: { steps: NextStep[] }) {
  return (
    <section aria-labelledby="next-steps" className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 id="next-steps" className="font-semibold tracking-tight">
        Next steps
      </h2>
      <ul className="mt-3 divide-y">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3 py-3">
            {step.done ? (
              <CheckCircle2 aria-hidden className="size-5 shrink-0 text-success" />
            ) : (
              <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground/50" />
            )}
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-medium', step.done && 'text-muted-foreground')}>
                {step.label}
                {step.optional && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    (optional)
                  </span>
                )}
                {step.done && <span className="sr-only"> (done)</span>}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
            {!step.done && (
              <Link
                to={step.to}
                aria-label={step.label}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-accent"
              >
                Start <ArrowRight aria-hidden className="size-4" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
