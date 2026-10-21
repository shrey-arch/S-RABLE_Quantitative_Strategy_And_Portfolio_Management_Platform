import { ArrowRight, FlaskConical, Layers, PieChart, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { AvailabilityTag, type Availability } from '@/components/ui/availability-tag';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';

/**
 * Public landing page (/).
 *
 * Honesty rule (Phase 0): only capabilities with a confirmed backend route are
 * described as available. Deferred ones (walk-forward, regime stress, Monte Carlo,
 * paper trading, regime-aware allocation) appear only as "Planned".
 */

const STAGES: { name: string; status: Availability }[] = [
  { name: 'Backtest', status: 'available' },
  { name: 'Walk-forward', status: 'planned' },
  { name: 'Regime stress', status: 'planned' },
  { name: 'Monte Carlo', status: 'planned' },
  { name: 'Paper trading', status: 'planned' },
];

function Pillar(props: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
      <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        {props.icon}
      </div>
      <h2 className="text-lg font-semibold tracking-tight">{props.title}</h2>
      <div className="mt-2 flex flex-1 flex-col gap-3 text-sm text-muted-foreground">
        {props.children}
      </div>
    </section>
  );
}

export default function LandingPage() {
  const { state } = useAuth();
  const loggedIn = state.status === 'authenticated';

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            S-RABLE
          </Link>
          <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            {loggedIn ? (
              <Button asChild size="sm">
                <Link to="/app/dashboard">Open dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">Log in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/register">Get started</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:pt-24">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
            <FlaskConical aria-hidden className="size-3.5" />
            Historical simulation
          </span>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Test a trading strategy on history before you trust it.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            S-RABLE lets you build rule-based strategies, run them against past market data and read
            the results, all as a simulation. Nothing here places real orders.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {loggedIn ? (
              <Button asChild size="lg">
                <Link to="/app/dashboard">
                  Open dashboard <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link to="/register">
                    Get started <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/login">Log in</Link>
                </Button>
              </>
            )}
          </div>
        </section>

        <div className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 md:grid-cols-3">
          <Pillar icon={<Layers className="size-5" />} title="Strategy library and builder">
            <p>
              Start from ready-made strategies or define your own: indicators, entry and exit rules,
              and risk settings.
            </p>
            <div className="mt-auto">
              <AvailabilityTag value="available" />
            </div>
          </Pillar>

          <Pillar icon={<Workflow className="size-5" />} title="Five-stage validation">
            <p>Each strategy moves through five checks. The first stage is ready today.</p>
            <ol className="mt-auto space-y-2">
              {STAGES.map((stage, i) => (
                <li key={stage.name} className="flex items-center justify-between gap-2">
                  <span className={cn(stage.status === 'available' && 'text-foreground')}>
                    {i + 1}. {stage.name}
                  </span>
                  <AvailabilityTag value={stage.status} />
                </li>
              ))}
            </ol>
          </Pillar>

          <Pillar icon={<PieChart className="size-5" />} title="Regime-aware portfolio">
            <p>
              Combine strategies in a simulated portfolio with target allocations and rebalancing.
              No broker orders are placed.
            </p>
            <ul className="mt-auto space-y-2">
              <li className="flex items-center justify-between gap-2">
                <span className="text-foreground">Simulated portfolio</span>
                <AvailabilityTag value="available" />
              </li>
              <li className="flex items-center justify-between gap-2">
                <span>Regime-aware allocation</span>
                <AvailabilityTag value="planned" />
              </li>
            </ul>
          </Pillar>
        </div>
      </main>

      <footer className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground">
          S-RABLE shows historical simulations only. It does not place live trades or stream
          real-time prices. Past results do not guarantee future performance.
        </p>
      </footer>
    </div>
  );
}
