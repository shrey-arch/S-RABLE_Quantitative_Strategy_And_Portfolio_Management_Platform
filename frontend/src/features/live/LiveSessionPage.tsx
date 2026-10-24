import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { equityPoints, isLiveNow, LIVE_AREA } from './live-model';
import { EquityLine, LiveChart } from './LiveChart';
import {
  ClockLine,
  EventLog,
  LiveFillsTable,
  LiveLabel,
  MoneyTiles,
  RiskMeter,
  SessionControls,
  SessionFacts,
  SessionSummary,
} from './LiveViews';
import { useLiveBars, useLiveEvents, useLiveFills, useLiveSession } from './queries';
import { useLiveStream } from './useLiveStream';

function Back() {
  return (
    <Link
      to="/app/live"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-4" /> {LIVE_AREA}
    </Link>
  );
}

/** /app/live/sessions/:id: one live paper session as it runs, then its summary. */
export default function LiveSessionPage() {
  const id = useParams().id ?? '';
  const streamingRef = useRef(false);
  const session = useLiveSession(id, () => streamingRef.current);
  const live = session.data ? isLiveNow(session.data) : false;
  const stream = useLiveStream(id, live);
  const streaming = stream.state === 'open';
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);
  const poll = live && !streaming;
  const bars = useLiveBars(id, poll);
  const events = useLiveEvents(id, poll);
  const fills = useLiveFills(id, poll);
  const equity = useMemo(() => equityPoints(events.data ?? []), [events.data]);

  if (session.isError)
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
        <Back />
        <h1 className="page-title text-3xl">Live session</h1>
        <ErrorState error={session.error} onRetry={() => void session.refetch()} />
      </div>
    );
  const s = session.data;
  if (!s)
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
        <Back />
        <h1 className="page-title text-3xl">Live session</h1>
        <LoadingState rows={6} />
      </div>
    );

  const forming = live ? (stream.forming ?? bars.data?.forming ?? null) : null;
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Back />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="page-title text-3xl">
            <span className="sr-only">Live session: </span>
            {s.name}
          </h1>
          <SessionFacts session={s} />
          <ClockLine session={s} stream={stream.state} />
          <LiveLabel />
        </div>
        <SessionControls session={s} />
      </div>
      {s.status_reason && (
        <p
          role={
            s.status === 'STALE' || s.status === 'PAUSED' || s.status === 'FAILED'
              ? 'alert'
              : undefined
          }
          className="rounded-md border bg-muted/40 p-3 text-sm"
          data-testid="status-reason"
        >
          {s.status_reason}
        </p>
      )}
      <SessionSummary session={s} />
      <section aria-label="Chart" className="rounded-xl border bg-card shadow-card p-4">
        {bars.isError ? (
          <ErrorState error={bars.error} onRetry={() => void bars.refetch()} />
        ) : !bars.data ? (
          <LoadingState rows={4} />
        ) : (
          <LiveChart
            bars={bars.data.bars}
            forming={forming}
            fills={fills.data ?? []}
            timeframe={s.timeframe}
            label={`${s.symbol ?? ''} ${s.timeframe} bars`}
          />
        )}
        {forming && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="forming-note">
            The last candle is still forming ({forming.minutes} of {forming.of} minutes); the
            strategy sees it only when it closes.
          </p>
        )}
      </section>
      <MoneyTiles session={s} />
      <div className="grid gap-4 lg:grid-cols-2">
        <RiskMeter session={s} />
        <section aria-label="Equity" className="space-y-2 rounded-xl border bg-card shadow-card p-4">
          <h2 className="text-sm font-semibold">Equity after each bar</h2>
          {equity.length ? (
            <EquityLine points={equity} capital={s.capital} label="Session equity" />
          ) : (
            <p className="text-sm text-muted-foreground">No bar has closed yet.</p>
          )}
        </section>
      </div>
      <section aria-label="Fills" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Fills</h2>
          <Link
            to="/app/live?tab=account&view=fills"
            className="text-sm underline-offset-4 hover:underline"
          >
            All fills in the paper account
          </Link>
        </div>
        {fills.isError ? (
          <ErrorState error={fills.error} onRetry={() => void fills.refetch()} />
        ) : (
          <LiveFillsTable fills={fills.data ?? []} />
        )}
      </section>
      {events.isError ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : (
        <EventLog events={events.data ?? []} />
      )}
    </div>
  );
}
