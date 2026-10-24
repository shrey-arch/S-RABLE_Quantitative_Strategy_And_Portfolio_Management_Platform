import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useValidations } from './queries';
import { VERDICT_LABELS, VERDICT_TONES } from './validation-model';

const TONE_TEXT = {
  success: 'text-success',
  danger: 'text-destructive',
  warning: 'text-warning',
  info: 'text-info',
  neutral: 'text-muted-foreground',
} as const;

/** Dashboard card: the user's five latest validation runs and their verdicts (GET /validations). */
export function LatestVerdictsWidget() {
  const query = useValidations();
  const latest = (query.data ?? []).slice(0, 5);
  return (
    <section aria-labelledby="latest-verdicts" className="rounded-xl border bg-card shadow-card p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck aria-hidden className="size-4 text-muted-foreground" />
        <h2 id="latest-verdicts" className="text-sm font-medium">
          Latest validation verdicts
        </h2>
      </div>
      <div className="mt-3">
        {query.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : query.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              Could not load the validations: {(query.error as Error).message}
            </p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : latest.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No validations yet: only validated strategies receive capital.{' '}
            <Link to="/app/validation/new" className="font-medium text-primary hover:underline">
              Validate a strategy
            </Link>
          </p>
        ) : (
          <div className="space-y-2">
            <ul className="divide-y text-sm" aria-label="Latest validation verdicts">
              {latest.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
                >
                  <Link
                    to={`/app/validation/${v.id}`}
                    className="min-w-0 truncate font-medium text-primary hover:underline"
                  >
                    {v.strategy_name ?? 'Deleted strategy'}
                  </Link>
                  <span className="flex items-baseline gap-3">
                    <span
                      className={cn('font-medium', TONE_TEXT[VERDICT_TONES[v.verdict.status]])}
                      title={v.verdict.reason}
                    >
                      {VERDICT_LABELS[v.verdict.status]}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(v.completed_at ?? v.created_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <Link to="/app/validation" className="text-sm font-medium text-primary hover:underline">
              All validations &rarr;
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
