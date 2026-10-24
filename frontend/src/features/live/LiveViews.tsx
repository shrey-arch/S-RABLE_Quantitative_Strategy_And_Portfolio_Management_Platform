import type { ColumnDef } from '@tanstack/react-table';
import { Clock, FlaskConical, OctagonX, Pause, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { MoneyText } from '@/components/ui/value-text';
import { Tile } from '@/features/paper/PaperViews';
import { formatINR, formatNumber, formatPercent, MISSING } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  AGE_LABELS,
  ageTone,
  EVENT_FILTER_LABELS,
  EVENT_FILTERS,
  EVENT_KIND_LABELS,
  filterEvents,
  formatAge,
  isLiveNow,
  isOpen,
  istDay,
  istTime,
  istTimeSeconds,
  LIVE_LABEL,
  MODE_LABELS,
  TIMEFRAME_LABELS,
  type AgeTone,
  type EventFilter,
  type LiveEvent,
  type LiveFill,
  type LiveSession,
  type LiveTimeframe,
} from './live-model';
import { usePauseLiveSession, useResumeLiveSession, useStopLiveSession } from './queries';
import type { StreamState } from './useLiveStream';

const tf = (s: Pick<LiveSession, 'timeframe'>) =>
  TIMEFRAME_LABELS[s.timeframe as LiveTimeframe] ?? s.timeframe;

/** The permanent honesty label: virtual money, simulated orders. */
export function LiveLabel(props: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning',
        props.className,
      )}
    >
      <FlaskConical aria-hidden className="size-3.5" />
      {LIVE_LABEL}
    </span>
  );
}

const DOT: Record<AgeTone, string> = {
  fresh: 'bg-success',
  late: 'bg-warning',
  stale: 'bg-destructive',
  none: 'bg-muted-foreground',
};

/** The session clock ("Market time 14:17 - 15 min behind live") and the data age. */
export function ClockLine(props: { session: LiveSession; stream?: StreamState }) {
  const s = props.session;
  const tone = ageTone(s);
  const live = isLiveNow(s);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1.5 font-medium" data-testid="session-clock">
        <Clock aria-hidden className="size-4 text-muted-foreground" />
        {s.clock.label}
      </span>
      {live && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden
            data-tone={tone}
            data-testid="data-age-dot"
            className={cn('size-2.5 rounded-full', DOT[tone])}
          />
          {AGE_LABELS[tone]}
          {s.last_price_at
            ? ` (bar to ${istTime(s.last_price_at)}, ${formatAge(s.data_age_seconds)})`
            : ''}
        </span>
      )}
      {live && props.stream && (
        <span className="text-xs text-muted-foreground" data-testid="stream-state">
          {props.stream === 'open'
            ? 'Live updates on'
            : props.stream === 'retrying'
              ? 'Reconnecting\u2026'
              : props.stream === 'connecting'
                ? 'Connecting\u2026'
                : 'Refreshing every 5 s'}
        </span>
      )}
    </div>
  );
}

/** Strategy, instrument, timeframe, mode and status. */
export function SessionFacts({ session: s }: { session: LiveSession }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <StatusBadge kind="liveSession" value={s.status} />
      <span>{s.symbol ?? MISSING}</span>
      <span aria-hidden>{'\u00b7'}</span>
      <span>{tf(s)} bars</span>
      <span aria-hidden>{'\u00b7'}</span>
      <span>{MODE_LABELS[s.mode]}</span>
      <span aria-hidden>{'\u00b7'}</span>
      <span>Intraday (MIS)</span>
    </p>
  );
}

/** Position, P&L and charges, exactly as the backend sends them. */
export function MoneyTiles({ session: s }: { session: LiveSession }) {
  const m = s.money;
  const side = s.position_qty > 0 ? 'Long' : s.position_qty < 0 ? 'Short' : 'Flat';
  return (
    <section aria-label="Position and P&L" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Position"
        hint={
          s.average_price !== null
            ? `Average ${formatINR(s.average_price)}`
            : s.squared_off
              ? 'Squared off for the day'
              : 'No open position'
        }
      >
        {side}
        {s.position_qty ? ` ${formatNumber(Math.abs(s.position_qty), 0)}` : ''}
      </Tile>
      <Tile
        label="Last price"
        hint={s.last_price_at ? `Bar close at ${istTime(s.last_price_at)} IST` : 'No bar yet'}
      >
        <MoneyText value={s.last_price} />
      </Tile>
      <Tile label="Equity" hint={`Capital ${formatINR(s.capital)}`}>
        <MoneyText value={m.equity} />
      </Tile>
      <Tile label="Net P&L" hint={`${formatNumber(s.order_count, 0)} orders`}>
        <MoneyText value={m.net_pnl} colored />
      </Tile>
      <Tile label="Realised P&L">
        <MoneyText value={m.realised_pnl} colored />
      </Tile>
      <Tile label="Unrealised P&L">
        <MoneyText value={m.unrealised_pnl} colored />
      </Tile>
      <Tile label="Charges" hint="Intraday: brokerage, STT, exchange, SEBI, stamp, GST">
        <MoneyText value={m.charges} />
      </Tile>
      <Tile label="Position value">
        <MoneyText value={m.position_value} />
      </Tile>
    </section>
  );
}

function Meter(props: { label: string; used: number | null; text: string; testId: string }) {
  const pct = props.used === null ? 0 : Math.min(100, Math.max(0, props.used * 100));
  const tone =
    props.used === null
      ? ''
      : props.used >= 1
        ? 'bg-destructive'
        : props.used >= 0.75
          ? 'bg-warning'
          : 'bg-success';
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-2 text-xs">
        <span className="font-medium">{props.label}</span>
        <span className="text-muted-foreground tabular-nums">{props.text}</span>
      </div>
      <div
        role="meter"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        data-testid={props.testId}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Loss so far against the daily limit; the position's value against its cap. */
export function RiskMeter({ session: s }: { session: LiveSession }) {
  const r = s.risk;
  return (
    <section aria-label="Risk limits" className="space-y-4 rounded-xl border bg-card shadow-card p-4">
      <h2 className="text-sm font-semibold">Risk limits</h2>
      <Meter
        label="Daily loss"
        used={r.loss_used ?? null}
        testId="loss-meter"
        text={
          r.loss_limit === null || r.loss_limit === undefined
            ? `${formatINR(r.loss)} lost \u00b7 no limit`
            : `${formatINR(r.loss)} of ${formatINR(r.loss_limit)} (${s.loss_limit_pct}% of capital)`
        }
      />
      <Meter
        label="Position value"
        used={r.position_used ?? null}
        testId="position-meter"
        text={`${formatINR(r.position_value ?? 0)} of ${formatINR(r.position_limit)}${s.max_position_value === null ? ' (the capital: no leverage)' : ''}`}
      />
      <p className="text-xs text-muted-foreground">
        At most {s.max_orders_per_bar} orders per bar. Slippage {formatNumber(s.slippage_bps, 1)}{' '}
        bps. Intraday positions are squared off at 15:20; the session ends at 15:30.
      </p>
    </section>
  );
}

const KIND_TONE: Record<string, string> = {
  FILL: 'text-info',
  SIGNAL: 'text-foreground',
  RISK: 'text-destructive',
  DATA: 'text-warning',
  STATUS: 'text-foreground',
};

/** The audit trail, newest first, with filters. */
export function EventLog(props: { events: LiveEvent[] }) {
  const [filter, setFilter] = useState<EventFilter>('all');
  const shown = useMemo(
    () => filterEvents(props.events, filter).slice().reverse(),
    [props.events, filter],
  );
  return (
    <section aria-label="Event log" className="space-y-3 rounded-xl border bg-card shadow-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Event log</h2>
        <div role="group" aria-label="Show events" className="flex flex-wrap gap-1">
          {EVENT_FILTERS.map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={f === filter ? 'secondary' : 'ghost'}
              aria-pressed={f === filter}
              onClick={() => setFilter(f)}
            >
              {EVENT_FILTER_LABELS[f]}
            </Button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ol className="max-h-96 space-y-1 overflow-y-auto text-sm" data-testid="event-log">
          {shown.map((e) => (
            <li key={e.id} className="flex gap-3 border-b py-1.5 last:border-0" data-kind={e.kind}>
              <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                {istTimeSeconds(e.market_time) || MISSING}
              </span>
              <span
                className={cn(
                  'w-14 shrink-0 text-xs font-medium',
                  KIND_TONE[e.kind] ?? 'text-muted-foreground',
                )}
              >
                {EVENT_KIND_LABELS[e.kind] ?? e.kind}
              </span>
              <span className="min-w-0 break-words">{e.message}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const fillColumns: ColumnDef<LiveFill>[] = [
  {
    id: 'time',
    header: 'Time (IST)',
    accessorFn: (f) => f.filled_at,
    cell: ({ row }) => istTime(row.original.filled_at),
  },
  { accessorKey: 'side', header: 'Side' },
  {
    accessorKey: 'quantity',
    header: 'Qty',
    cell: ({ row }) => formatNumber(row.original.quantity, 0),
  },
  {
    accessorKey: 'price',
    header: 'Fill price',
    cell: ({ row }) => formatINR(row.original.price),
  },
  {
    accessorKey: 'bar_close',
    header: 'Bar close',
    cell: ({ row }) => formatINR(row.original.bar_close),
  },
  {
    accessorKey: 'total_charges',
    header: 'Charges',
    cell: ({ row }) => formatINR(row.original.total_charges),
  },
  {
    accessorKey: 'realised_pnl',
    header: 'Realised P&L',
    cell: ({ row }) => <MoneyText value={row.original.realised_pnl} colored />,
  },
  { accessorKey: 'reason', header: 'Why', enableSorting: false },
];

/** The session's fills (simulated MIS orders in the paper account). */
export function LiveFillsTable(props: { fills: LiveFill[] }) {
  if (props.fills.length === 0)
    return (
      <EmptyState
        title="No fills yet"
        description="Orders are filled at the close of the bar that gave the signal, plus slippage."
      />
    );
  return <DataTable caption="Session fills" columns={fillColumns} data={props.fills} />;
}

/** The end-of-session summary the backend stored. */
export function SessionSummary({ session: s }: { session: LiveSession }) {
  const sum = (s.summary ?? {}) as Record<string, number | null>;
  if (!s.summary) return null;
  return (
    <section aria-label="Session summary" className="space-y-3">
      <h2 className="text-base font-semibold">Summary</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Net P&L" hint={`Equity ${formatINR(sum.equity)}`}>
          <MoneyText value={sum.net_pnl} colored />
        </Tile>
        <Tile label="Closed trades" hint={`${formatNumber(sum.fills, 0)} fills`}>
          {formatNumber(sum.closed_trades, 0)}
        </Tile>
        <Tile
          label="Win rate"
          hint={`${formatNumber(sum.winning_trades, 0)} of ${formatNumber(sum.closed_trades, 0)} closed with a profit`}
        >
          {sum.win_rate === null || sum.win_rate === undefined
            ? MISSING
            : formatPercent(sum.win_rate)}
        </Tile>
        <Tile label="Charges" hint={`Realised ${formatINR(sum.realised_pnl)}`}>
          <MoneyText value={sum.charges} />
        </Tile>
      </div>
    </section>
  );
}

/** Stop with a choice: square off now, or keep the position until the 15:20 square-off. */
export function StopDialog(props: { session: LiveSession; onClose: () => void }) {
  const stop = useStopLiveSession();
  const holding = props.session.position_qty !== 0;
  const run = async (squareOff: boolean) => {
    try {
      await stop.mutateAsync({ id: props.session.id, squareOff });
      toast.success(
        squareOff
          ? 'Stopping: the position is squared off at the next tick.'
          : 'Stopping: the open position is squared off at 15:20.',
      );
      props.onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !stop.isPending && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Stop this session?</DialogTitle>
          <DialogDescription>
            {holding
              ? `It holds ${props.session.position_qty > 0 ? 'a long' : 'a short'} position of ${Math.abs(props.session.position_qty)} ${props.session.symbol ?? ''}. Square it off now (at the latest bar close, plus slippage), or leave it for the automatic 15:20 square-off.`
              : 'No position is open. The session stops at the next tick (within a second).'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={props.onClose} disabled={stop.isPending}>
            Keep running
          </Button>
          <div className="flex flex-wrap gap-2">
            {holding && (
              <Button variant="outline" onClick={() => void run(false)} disabled={stop.isPending}>
                Stop, square off at 15:20
              </Button>
            )}
            <Button variant="destructive" onClick={() => void run(true)} disabled={stop.isPending}>
              {stop.isPending && <Spinner />}
              {holding ? 'Stop and square off now' : 'Stop session'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Stop, pause and resume for one session. */
export function SessionControls({ session: s }: { session: LiveSession }) {
  const [stopping, setStopping] = useState(false);
  const pause = usePauseLiveSession();
  const resume = useResumeLiveSession();
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (!isOpen(s)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {s.status === 'PAUSED' ? (
        <Button
          variant="outline"
          onClick={() => void act(() => resume.mutateAsync(s.id), 'Resumed.')}
          disabled={resume.isPending}
        >
          <Play /> Resume
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={() =>
            void act(() => pause.mutateAsync(s.id), 'Paused. No new orders until you resume.')
          }
          disabled={pause.isPending || s.stop_requested !== null}
        >
          <Pause /> Pause
        </Button>
      )}
      <Button
        variant="destructive"
        size="lg"
        onClick={() => setStopping(true)}
        disabled={s.stop_requested !== null}
      >
        <OctagonX /> {s.stop_requested ? 'Stopping\u2026' : 'Stop'}
      </Button>
      {stopping && <StopDialog session={s} onClose={() => setStopping(false)} />}
    </div>
  );
}

const sessionColumns: ColumnDef<LiveSession>[] = [
  {
    accessorKey: 'name',
    header: 'Session',
    cell: ({ row }) => (
      <Link
        to={`/app/live/sessions/${row.original.id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  { accessorKey: 'symbol', header: 'Instrument' },
  {
    id: 'setup',
    header: 'Bars \u00b7 mode',
    accessorFn: (s) => `${s.timeframe} ${s.mode}`,
    cell: ({ row }) => `${row.original.timeframe} \u00b7 ${MODE_LABELS[row.original.mode]}`,
  },
  {
    id: 'day',
    header: 'Day',
    accessorFn: (s) => s.session_date,
    cell: ({ row }) => istDay(row.original.session_date),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusBadge kind="liveSession" value={row.original.status} />,
  },
  {
    id: 'position',
    header: 'Position',
    accessorFn: (s) => s.position_qty,
    cell: ({ row }) => formatNumber(row.original.position_qty, 0),
  },
  {
    id: 'pnl',
    header: 'Net P&L',
    accessorFn: (s) => s.money.net_pnl,
    cell: ({ row }) => <MoneyText value={row.original.money.net_pnl} colored />,
  },
];

export function SessionsTable(props: { sessions: LiveSession[] }) {
  return <DataTable caption="Live sessions" columns={sessionColumns} data={props.sessions} />;
}
