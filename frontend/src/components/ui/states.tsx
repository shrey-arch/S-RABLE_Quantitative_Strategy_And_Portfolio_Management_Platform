import { AlertTriangle, Inbox, Lock, RefreshCw, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/errors';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Skeleton } from './skeleton';

/** Shown when a list or page has no data yet. Always offers the next action when possible. */
export function EmptyState(props: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center',
        props.className,
      )}
    >
      <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
        <Inbox className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{props.title}</p>
        {props.description && (
          <p className="max-w-md text-sm text-muted-foreground">{props.description}</p>
        )}
      </div>
      {props.action}
    </div>
  );
}

/**
 * Shown when a request fails. Distinguishes:
 * not available (404/403) - connection problem (network) - everything else.
 */
export function ErrorState(props: { error: unknown; onRetry?: () => void; className?: string }) {
  const error = props.error instanceof ApiError ? props.error : null;
  const notAvailable = error?.status === 404 || error?.status === 403;
  const offline = error?.isNetworkError ?? false;

  const Icon = notAvailable ? Lock : offline ? WifiOff : AlertTriangle;
  const title = notAvailable
    ? 'Not available'
    : offline
      ? 'Connection problem'
      : 'Something went wrong';
  const message = error?.message ?? 'An unexpected error occurred.';

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center',
        props.className,
      )}
    >
      <Icon aria-hidden className="size-6 text-destructive" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      {props.onRetry && !notAvailable && (
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

/** Placeholder rows while data loads. */
export function LoadingState(props: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('space-y-2', props.className)}>
      {Array.from({ length: props.rows ?? 4 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
