import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Shell for Login and Register.
 *
 * Two columns on large screens: the brand panel states what the platform is
 * for, and the form sits to its right. Below `lg` the panel is removed and the
 * card is centred, which is exactly what these pages did before - so the
 * narrow-screen behaviour the browser tests check is unchanged.
 *
 * The forms themselves are passed in as children and are not touched here.
 */

const STAGES = ['Backtest', 'Walk-forward', 'Regime stress', 'Monte Carlo', 'Paper trading'];

export function AuthLayout(props: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="app-ground min-h-dvh bg-background lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="paper-grid relative hidden flex-col justify-between overflow-hidden border-r bg-surface-strip p-10 lg:flex xl:p-14">
        {/* Faint candlesticks, as on the home page. */}
        <svg
          aria-hidden
          viewBox="0 0 150 300"
          className="pointer-events-none absolute -bottom-10 -left-6 h-80 w-40 text-border-strong opacity-50"
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

        <p className="micro-label relative">Research platform</p>

        <div className="relative">
          <p className="page-title text-4xl xl:text-5xl">
            Nothing gets capital
            <br />
            until it&rsquo;s <em className="text-primary italic">validated</em>.
          </p>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
            Build a strategy, backtest it on stored NSE data, then put it through five stages of
            evidence. The allocator funds what survives.
          </p>

          <ol className="mt-9 space-y-3">
            {STAGES.map((stage, i) => (
              <li key={stage} className="flex items-center gap-3 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-[11px] font-semibold text-success-ink">
                  {i + 1}
                </span>
                <span className="font-medium">{stage}</span>
              </li>
            ))}
          </ol>
        </div>

        <p className="micro-label relative">Historical simulation only</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-4 py-10 sm:px-6">
        <Link
          to="/"
          className="mb-6 text-lg font-semibold tracking-[0.2em] text-foreground hover:text-primary"
        >
          S-RABLE
        </Link>
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-float sm:p-8">
          <h1 className="page-title text-2xl">{props.title}</h1>
          {props.subtitle && <p className="mt-1 text-sm text-muted-foreground">{props.subtitle}</p>}
          <div className="mt-6">{props.children}</div>
        </div>
        <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground lg:hidden">
          Historical simulation only. S-RABLE does not place live trades.
        </p>
      </main>
    </div>
  );
}
