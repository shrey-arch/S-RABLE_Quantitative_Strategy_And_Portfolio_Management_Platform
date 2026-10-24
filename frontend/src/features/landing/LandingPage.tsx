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
 * described as available. All five validation stages now have one - walk-forward,
 * regime stress, Monte Carlo and paper trading shipped with Features 1 to 7 - so
 * they are no longer listed as planned. Nothing here claims live trading.
 *
 * The decorations (candlesticks, globe, handwritten notes) are hidden below `lg`
 * and the page clips its own overflow, so narrow screens never scroll sideways.
 */

const STAGES: { name: string; status: Availability }[] = [
  { name: 'Backtest', status: 'available' },
  { name: 'Walk-forward', status: 'available' },
  { name: 'Regime stress', status: 'available' },
  { name: 'Monte Carlo', status: 'available' },
  { name: 'Paper trading', status: 'available' },
];

function Pillar(props: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border bg-card p-6 text-card-foreground shadow-card">
      <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
        {props.icon}
      </div>
      <h2 className="text-lg font-semibold tracking-tight">{props.title}</h2>
      <div className="mt-2 flex flex-1 flex-col gap-3 text-sm text-muted-foreground">
        {props.children}
      </div>
    </section>
  );
}

/** A handwritten margin note. Decorative: hidden from assistive tech and on narrow screens. */
function Note(props: { className: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute hidden font-hand text-xl leading-tight text-hand lg:block',
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}

/** A hand-drawn arrow, pointing from a note to the thing it is about. */
function Arrow(props: { className: string; d: string; head: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 120"
      className={cn('pointer-events-none absolute hidden text-hand lg:block', props.className)}
    >
      <path
        d={props.d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d={props.head}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function LandingPage() {
  const { state } = useAuth();
  const loggedIn = state.status === 'authenticated';

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* Floating pill navigation. */}
      <div className="px-4 pt-5 sm:px-6">
        <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-2.5 shadow-raised">
          <Link to="/" className="flex items-center gap-2.5 text-base font-semibold tracking-[0.2em]">
            S-RABLE
          </Link>
          <nav aria-label="Sections" className="ml-4 hidden items-center gap-1 md:flex">
            <a href="#how" className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-primary-tint hover:text-foreground">
              How it works
            </a>
            <a href="#validation" className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-primary-tint hover:text-foreground">
              The five stages
            </a>
            <a href="#portfolio" className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-primary-tint hover:text-foreground">
              Portfolio
            </a>
          </nav>
          <nav aria-label="Account" className="ml-auto flex items-center gap-1 sm:gap-2">
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
        </header>
      </div>

      <main className="flex-1">
        {/* Hero, on plotting paper. */}
        <section className="paper-grid relative px-4 pt-14 pb-10 text-center sm:px-6 sm:pt-20">
          {/* Faint candlesticks, left margin. */}
          <svg
            aria-hidden
            viewBox="0 0 150 300"
            className="pointer-events-none absolute top-24 left-4 hidden h-72 w-36 text-border-strong opacity-60 xl:block"
          >
            <g stroke="currentColor" strokeWidth="1.4" fill="none">
              <path d="M14 40v70" />
              <rect x="8" y="55" width="12" height="38" />
              <path d="M38 70v80" />
              <rect x="32" y="88" width="12" height="44" />
              <path d="M62 30v86" />
              <rect x="56" y="48" width="12" height="52" />
              <path d="M86 96v92" />
              <rect x="80" y="116" width="12" height="50" />
              <path d="M110 120v96" />
              <rect x="104" y="142" width="12" height="54" />
            </g>
          </svg>

          {/* Globe, right margin. */}
          <svg
            aria-hidden
            viewBox="0 0 120 120"
            className="pointer-events-none absolute top-28 right-8 hidden size-32 text-border-strong opacity-70 xl:block"
          >
            <g stroke="currentColor" strokeWidth="1.2" fill="none">
              <circle cx="60" cy="60" r="44" />
              <ellipse cx="60" cy="60" rx="44" ry="18" />
              <ellipse cx="60" cy="60" rx="18" ry="44" />
              <path d="M16 60h88M60 16v88" />
            </g>
          </svg>

          <Note className="top-10 left-[12%] w-36 -rotate-6 text-center">
            Data
            <br />+<br />
            Strategy
            <br />=<br />
            Evidence
          </Note>
          <Arrow
            className="top-28 left-[22%] size-24"
            d="M8 104 C28 84, 58 48, 100 14"
            head="M100 14 L83 20 M100 14 L95 32"
          />

          <Note className="top-12 right-[12%] w-44 rotate-3 text-center">
            Five stages.
            <br />
            Then capital.
          </Note>
          <Arrow
            className="top-28 right-[20%] size-24"
            d="M10 12 C36 30, 60 58, 78 92"
            head="M78 92 L64 84 M78 92 L80 76"
          />

          <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-ink">
            <FlaskConical aria-hidden className="size-3.5" />
            Historical simulation
          </span>

          <h1 className="page-title mx-auto mt-6 max-w-4xl text-[2.6rem] text-balance sm:text-6xl lg:text-7xl">
            Nothing gets capital
            <br />
            until it&rsquo;s <em className="text-primary italic">validated</em>.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Build a strategy, backtest it on stored NSE data, then put it through five stages of
            evidence. Nothing here places real orders.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
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

          <p className="micro-label mt-7">
            Real NSE data &nbsp;&bull;&nbsp; Five-stage validation &nbsp;&bull;&nbsp; One platform
          </p>
        </section>

        {/* A look at the app: the validation pipeline, with no invented figures. */}
        <section id="how" className="px-4 pb-16 sm:px-6">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-t-2xl border bg-card shadow-float">
            <div className="flex flex-wrap items-center gap-3 border-b bg-surface-strip px-4 py-3">
              <span className="text-xs font-semibold tracking-[0.2em]">S-RABLE</span>
              <Link
                to="/app/validation"
                className="rounded-md bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary-ink hover:bg-primary hover:text-primary-foreground"
              >
                Validation
              </Link>
              <Link
                to="/app/executions"
                className="hidden rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-primary-tint hover:text-foreground sm:inline-block"
              >
                Backtests
              </Link>
              <Link
                to="/app/regime"
                className="hidden rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-primary-tint hover:text-foreground sm:inline-block"
              >
                Regime
              </Link>
              <Link
                to="/app/portfolios"
                className="hidden rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-primary-tint hover:text-foreground sm:inline-block"
              >
                Portfolios
              </Link>
              <span className="ml-auto text-xs text-muted-foreground">Example view</span>
            </div>

            <ol className="grid gap-px bg-border sm:grid-cols-5">
              {STAGES.map((stage, i) => (
                <li key={stage.name} className="bg-card p-4">
                  <span className="micro-label">Stage {i + 1}</span>
                  <p className="mt-1.5 text-sm font-semibold">{stage.name}</p>
                  <span className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-success-soft px-2 py-0.5 text-xs font-medium text-success-ink">
                    Judged against a threshold
                  </span>
                </li>
              ))}
            </ol>

            <p className="border-t bg-surface-strip px-4 py-3 text-xs text-muted-foreground">
              Every stage is scored by the backend against its own threshold. A strategy that fails
              one does not reach the allocator.{' '}
              <Link to="/app/validation" className="font-medium text-primary hover:underline">
                Open validation
              </Link>{' '}
              to see a real report.
            </p>
          </div>
        </section>

        {/* The three pillars. */}
        <div className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:px-6 md:grid-cols-3">
          <Pillar icon={<Layers className="size-5" />} title="Strategy library and builder">
            <p>
              Start from ready-made strategies, build your own rules without code, or write Python
              that runs in a sandbox with real limits.
            </p>
            <div className="mt-auto">
              <AvailabilityTag value="available" />
            </div>
          </Pillar>

          <Pillar icon={<Workflow className="size-5" />} title="Five-stage validation">
            <p>Each strategy moves through five checks, every one judged by the backend.</p>
            <ol id="validation" className="mt-auto space-y-2">
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
              Combine strategies in a simulated portfolio, weighted by score and market regime,
              measured against Nifty 50. No broker orders are placed.
            </p>
            <ul id="portfolio" className="mt-auto space-y-2">
              <li className="flex items-center justify-between gap-2">
                <span className="text-foreground">Simulated portfolio</span>
                <AvailabilityTag value="available" />
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-foreground">Regime-aware allocation</span>
                <AvailabilityTag value="available" />
              </li>
            </ul>
          </Pillar>
        </div>
      </main>

      <footer className="border-t bg-surface-strip">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground sm:px-6">
          S-RABLE shows historical simulations only. It does not place live trades or stream
          real-time prices. Past results do not guarantee future performance.
        </p>
      </footer>
    </div>
  );
}
