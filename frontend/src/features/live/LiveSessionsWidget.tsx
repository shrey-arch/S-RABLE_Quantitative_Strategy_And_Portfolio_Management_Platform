import { Radio } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { MoneyText } from '@/components/ui/value-text';
import { isLiveNow, LIVE_LABEL } from './live-model';
import { useLiveSessions } from './queries';

/**
 * Dashboard card: running live paper sessions first, then the latest finished
 * ones, each with its net P&L as the backend reports it (GET /live/sessions).
 */
export function LiveSessionsWidget() {
  const query = useLiveSessions();
  const all = query.data ?? [];
  const running = all.filter(isLiveNow);
  const shown = [...running, ...all.filter((s) => !isLiveNow(s))].slice(0, 5);
  return (
    <section aria-labelledby="live-sessions-card" className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Radio aria-hidden className="size-4 text-muted-foreground" />
        <h2 id="live-sessions-card" className="text-sm font-medium">
          Live sessions
        </h2>
        <span className="ml-auto text-xs text-warning">{LIVE_LABEL}</span>
      </div>
      <div className="mt-3">
        {query.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : query.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              Could not load the live sessions: {(query.error as Error).message}
            </p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No live sessions yet.{' '}
            <Link to="/app/live/new" className="font-medium text-primary hover:underline">
              Start one
            </Link>{' '}
            (delayed live in market hours, or a replay).
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{running.length} running now.</p>
            <ul className="divide-y text-sm" aria-label="Live sessions">
              {shown.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
                >
                  <Link
                    to={`/app/live/sessions/${s.id}`}
                    className="min-w-0 truncate font-medium text-primary hover:underline"
                  >
                    {s.name}
                  </Link>
                  <span className="flex items-baseline gap-3">
                    <StatusBadge kind="liveSession" value={s.status} />
                    <MoneyText value={s.money.net_pnl} colored />
                  </span>
                </li>
              ))}
            </ul>
            <Link to="/app/live" className="text-sm font-medium text-primary hover:underline">
              All live sessions &rarr;
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
