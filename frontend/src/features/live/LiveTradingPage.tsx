import { OctagonX, Plus, Radio } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DeploymentsPanel, PerformancePanel } from '@/features/paper/DeploymentViews';
import { PaperAccountPanel } from '@/features/paper/PaperTradingPage';
import { istDay, isLiveNow, istTime, LIVE_AREA, MAX_ACTIVE, REPORT_TEXT } from './live-model';
import { LiveLabel, SessionsTable } from './LiveViews';
import { useLiveSessions, useLiveStatus, useStopAllLive } from './queries';

const TABS = ['sessions', 'account', 'deployments', 'performance'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  sessions: 'Live sessions',
  account: 'Paper account',
  deployments: 'Deployments',
  performance: 'Performance',
};
const isTab = (v: string | null): v is Tab => (TABS as readonly string[]).includes(v ?? '');

/** The Yahoo feed's last error and back-off, as GET /live/status reports them. */
function feedProblem(feed: Record<string, unknown> | null | undefined): string {
  if (!feed || consecutive(feed) === 0 || typeof feed.last_error !== 'string') return '';
  const wait =
    typeof feed.backoff_until === 'string'
      ? ` Next try at ${istTime(feed.backoff_until)} IST.`
      : '';
  return ` Yahoo feed: ${feed.rate_limited ? 'rate limited (HTTP 429)' : feed.last_error}.${wait}`;
}
const consecutive = (feed: Record<string, unknown>) => Number(feed.consecutive_errors ?? 0);

function MarketLine() {
  const status = useLiveStatus();
  if (!status.data) return null;
  const s = status.data;
  return (
    <p className="text-sm text-muted-foreground" data-testid="market-line">
      {s.delayed_day
        ? `NSE is open. A delayed live session trades ${istDay(s.delayed_day)} at market time minus ${s.delay_minutes} minutes.`
        : 'NSE is closed, so delayed live sessions cannot start now. Replay a recorded day instead.'}
      {feedProblem(s.feed)}
    </p>
  );
}

function SessionsPanel() {
  const sessions = useLiveSessions();
  if (sessions.isError)
    return <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />;
  if (!sessions.data) return <LoadingState rows={3} />;
  const live = sessions.data.filter(isLiveNow).length;
  return (
    <div className="space-y-4">
      <MarketLine />
      {sessions.data.length === 0 ? (
        <EmptyState
          title="No live sessions yet"
          description="Run a strategy on 1, 5 or 15-minute bars: delayed live during NSE hours, or a replay of a recorded day."
          action={
            <Button asChild>
              <Link to="/app/live/new">
                <Plus /> New live session
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {live} of at most {MAX_ACTIVE} sessions running.
          </p>
          <SessionsTable sessions={sessions.data} />
        </>
      )}
      <p className="text-xs text-muted-foreground">{REPORT_TEXT}</p>
    </div>
  );
}

function StopAll() {
  const sessions = useLiveSessions();
  const stopAll = useStopAllLive();
  const live = (sessions.data ?? []).filter(isLiveNow).length;
  if (!live) return null;
  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive">
          <OctagonX /> Stop all
        </Button>
      }
      title={`Stop all ${live} live sessions?`}
      description="Every running session stops at the next tick and its position is squared off at once."
      confirmLabel="Stop all and square off"
      destructive
      onConfirm={async () => {
        await stopAll.mutateAsync();
        toast.success('Stopping every live session.');
      }}
    />
  );
}

/** /app/live: Live Trading (Paper). Live sessions, the paper account, deployments. */
export default function LiveTradingPage() {
  const [params, setParams] = useSearchParams();
  const value = params.get('tab');
  const tab: Tab = isTab(value) ? value : 'sessions';
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 page-title text-3xl">
            <Radio aria-hidden className="size-5 text-muted-foreground" />
            {LIVE_AREA}
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Strategies trade as the market moves, with virtual money: live sessions on intraday bars
            (15 minutes behind the market, or a replay of a recorded day), and the paper account
            with its daily deployments. No order is ever sent to a broker.
          </p>
          <LiveLabel />
        </div>
        <div className="flex flex-wrap gap-2">
          <StopAll />
          <Button asChild>
            <Link to="/app/live/new">
              <Plus /> New live session
            </Link>
          </Button>
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(t) =>
          setParams(
            () => {
              const p = new URLSearchParams();
              if (t !== 'sessions') p.set('tab', t);
              return p;
            },
            { replace: true },
          )
        }
      >
        <TabsList aria-label="Live trading" className="h-auto flex-wrap justify-start">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t} value={t} className="pt-2">
            {t === tab &&
              (t === 'sessions' ? (
                <SessionsPanel />
              ) : t === 'account' ? (
                <PaperAccountPanel />
              ) : t === 'deployments' ? (
                <DeploymentsPanel
                  onDeployed={(id) => void navigate(`/app/live/deployments/${id}`)}
                />
              ) : (
                <PerformancePanel />
              ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
