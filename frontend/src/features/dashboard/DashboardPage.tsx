import { ChartCandlestick, ChartPie, Landmark, Layers } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/auth-context';
import { LiveSessionsWidget } from '@/features/live/LiveSessionsWidget';
import { RegimeWidget } from '@/features/regime/RegimeWidget';
import { TopStrategiesWidget } from '@/features/scoring/TopStrategiesWidget';
import { LatestVerdictsWidget } from '@/features/validation/LatestVerdictsWidget';
import { formatINR } from '@/lib/format';
import {
  useActiveInstruments,
  useBrokerAccounts,
  usePortfolioSummary,
  useStrategies,
} from './queries';
import { NextSteps, type NextStep } from './NextSteps';
import { StatCard } from './StatCard';

function ActionLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="text-sm font-medium text-primary hover:underline">
      {children} &rarr;
    </Link>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** /app/dashboard - a summary of the user's own workspace. */
export default function DashboardPage() {
  const { state } = useAuth();
  const firstName = state.status === 'authenticated' ? state.user.full_name.split(' ')[0] : '';

  const strategies = useStrategies();
  const portfolios = usePortfolioSummary();
  const brokers = useBrokerAccounts();
  const instruments = useActiveInstruments();

  const strategyList = strategies.data ?? [];
  const activeStrategies = strategyList.filter((s) => s.is_active).length;
  const brokerList = brokers.data ?? [];
  const connectedBrokers = brokerList.filter((b) => b.connection_status === 'CONNECTED').length;

  // Known only once loaded; null (no status shown) while loading or failed.
  const known = (query: { isSuccess: boolean }, has: boolean) => (query.isSuccess ? has : null);
  const steps: NextStep[] = [
    {
      label: 'Create a strategy',
      description: 'Pick a ready-made strategy or define your own rules.',
      to: '/app/builder/new',
      done: known(strategies, strategyList.length > 0),
    },
    {
      label: 'Run a backtest',
      description: 'Test a strategy on historical data.',
      to: '/app/backtests/new',
      // Execution history is not available to the frontend yet (Phase 0), so this
      // step never claims to be done.
      done: false,
    },
    {
      label: 'Create a simulated portfolio',
      description: 'Combine strategies with simulated capital. No real orders.',
      to: '/app/portfolios',
      done: portfolios.count === null || portfolios.isError ? null : portfolios.count > 0,
    },
    {
      label: 'Link a broker account',
      description: 'Store broker details for later. Nothing trades live.',
      to: '/app/brokers',
      done: known(brokers, brokerList.length > 0),
      optional: true,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="page-title text-3xl">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {firstName ? `Welcome back, ${firstName}. ` : ''}A summary of your workspace.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Strategies"
          icon={<Layers className="size-4" />}
          source="GET /strategies -> count, is_active"
          isPending={strategies.isPending}
          error={strategies.error}
          onRetry={() => void strategies.refetch()}
          isEmpty={strategyList.length === 0}
          empty={{
            message: 'No strategies yet.',
            action: <ActionLink to="/app/builder/new">Create a strategy</ActionLink>,
          }}
          value={activeStrategies}
          detail={`active of ${plural(strategyList.length, 'strategy', 'strategies')}`}
        />

        <StatCard
          title="Portfolios"
          icon={<ChartPie className="size-4" />}
          source="GET /portfolio/accounts -> count; GET /portfolio/accounts/{id} -> total_equity (summed)"
          isPending={portfolios.isPending}
          error={portfolios.error}
          onRetry={portfolios.refetch}
          isEmpty={portfolios.count === 0}
          empty={{
            message: 'No portfolios yet.',
            action: <ActionLink to="/app/portfolios">Create a portfolio</ActionLink>,
          }}
          value={formatINR(portfolios.totalEquity)}
          detail={
            <>
              <span className="font-medium text-warning">Simulated</span> equity across{' '}
              {plural(portfolios.count ?? 0, 'portfolio', 'portfolios')}
            </>
          }
        />

        <StatCard
          title="Broker accounts"
          icon={<Landmark className="size-4" />}
          source="GET /brokers/accounts -> count, connection_status"
          isPending={brokers.isPending}
          error={brokers.error}
          onRetry={() => void brokers.refetch()}
          isEmpty={brokerList.length === 0}
          empty={{
            message: 'No broker accounts linked.',
            action: <ActionLink to="/app/brokers">Add a broker account</ActionLink>,
          }}
          value={connectedBrokers}
          detail={`connected of ${plural(brokerList.length, 'account', 'accounts')}`}
        />

        <StatCard
          title="Instruments"
          icon={<ChartCandlestick className="size-4" />}
          source="GET /instruments?active_only=true -> count"
          isPending={instruments.isPending}
          error={instruments.error}
          onRetry={() => void instruments.refetch()}
          isEmpty={(instruments.data ?? []).length === 0}
          empty={{
            message: 'No active instruments in the catalogue yet.',
            action: <ActionLink to="/app/instruments">Open instruments</ActionLink>,
          }}
          value={(instruments.data ?? []).length}
          detail="active instruments available"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RegimeWidget />
        <TopStrategiesWidget />
        <LatestVerdictsWidget />
        <LiveSessionsWidget />
      </div>
      <NextSteps steps={steps} />
    </div>
  );
}
