import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * One dashboard number. Four states that always look different:
 * - loading: grey placeholder bars
 * - failed:  red message + Try again (never a 0 or a dash)
 * - empty:   "None yet" + the next action (the user has no records)
 * - value:   the number, which may legitimately be 0
 *
 * `source` names the endpoint and field the number comes from (shown on hover).
 */
export interface StatCardProps {
  title: string;
  icon: ReactNode;
  source: string;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  /** True when the user has no records of this kind. */
  isEmpty?: boolean;
  empty?: { message: string; action?: ReactNode };
  value?: ReactNode;
  detail?: ReactNode;
}

export function StatCard(props: StatCardProps) {
  const errorMessage =
    props.error instanceof ApiError ? props.error.message : 'Something went wrong.';

  return (
    <section
      aria-label={props.title}
      aria-busy={props.isPending}
      className={cn(
        'flex min-h-36 flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-card',
        props.error ? 'border-destructive/40' : '',
      )}
    >
      <header className="flex items-center gap-2">
        <span aria-hidden className="text-muted-foreground">
          {props.icon}
        </span>
        <h2 className="text-sm font-medium text-muted-foreground">{props.title}</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Data source for ${props.title}`}
              className="ml-auto rounded text-muted-foreground/70 hover:text-foreground"
            >
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="font-mono text-xs">{props.source}</TooltipContent>
        </Tooltip>
      </header>

      <div className="mt-3 flex flex-1 flex-col justify-end">
        {props.isPending ? (
          <div role="status" aria-label={`Loading ${props.title}`} className="space-y-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-36" />
          </div>
        ) : props.error ? (
          <div role="alert" className="space-y-2">
            <p className="flex items-start gap-1.5 text-sm text-destructive">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>Couldn&apos;t load. {errorMessage}</span>
            </p>
            <Button variant="outline" size="sm" onClick={props.onRetry}>
              <RefreshCw /> Try again
            </Button>
          </div>
        ) : props.isEmpty && props.empty ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{props.empty.message}</p>
            {props.empty.action}
          </div>
        ) : (
          <div>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">{props.value}</p>
            {props.detail && <p className="mt-1 text-sm text-muted-foreground">{props.detail}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
