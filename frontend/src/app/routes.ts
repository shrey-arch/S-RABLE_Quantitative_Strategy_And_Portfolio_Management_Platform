/**
 * Every page address in the app, in one place.
 * `phase` = the roadmap phase that builds the page. Until then it shows a placeholder.
 *
 * Only areas cleared by Phase 0 are real pages. Roadmap addresses for deferred or
 * blocked areas are listed in UNAVAILABLE_ROUTES and show a "not available" page.
 */
export interface AppRoute {
  path: string;
  title: string;
  phase: number;
}

export const PUBLIC_ROUTES: AppRoute[] = [
  { path: '/', title: 'Welcome', phase: 2 },
  { path: '/login', title: 'Log in', phase: 2 },
  { path: '/register', title: 'Create account', phase: 2 },
];

export const APP_ROUTES: AppRoute[] = [
  { path: '/app/dashboard', title: 'Dashboard', phase: 4 },
  { path: '/app/strategies', title: 'Strategies', phase: 5 },
  { path: '/app/strategies/:id', title: 'Strategy', phase: 5 },
  { path: '/app/builder/new', title: 'Strategy Builder', phase: 8 },
  { path: '/app/builder/:id', title: 'Edit strategy', phase: 8 },
  { path: '/app/instruments', title: 'Instruments', phase: 6 },
  { path: '/app/instruments/:id', title: 'Instrument', phase: 6 },
  { path: '/app/indicators', title: 'Indicators', phase: 7 },
  { path: '/app/backtests/new', title: 'New backtest', phase: 9 },
  { path: '/app/backtests/:id', title: 'Backtest', phase: 9 },
  { path: '/app/executions', title: 'Backtest history', phase: 9 },
  { path: '/app/executions/:id/results', title: 'Backtest results', phase: 10 },
  { path: '/app/validation', title: 'Validation', phase: 11 },
  { path: '/app/validation/new', title: 'New validation', phase: 11 },
  { path: '/app/validation/:id', title: 'Validation report', phase: 11 },
  { path: '/app/portfolio-backtests', title: 'Portfolio backtests', phase: 21 },
  { path: '/app/portfolio-backtests/new', title: 'New portfolio backtest', phase: 21 },
  { path: '/app/portfolio-backtests/:id', title: 'Portfolio backtest', phase: 21 },
  { path: '/app/regime', title: 'Market Regime', phase: 12 },
  { path: '/app/scoring', title: 'Scoring', phase: 13 },
  { path: '/app/records', title: 'Trading Records', phase: 15 },
  { path: '/app/portfolios', title: 'Portfolios', phase: 14 },
  { path: '/app/portfolios/:id', title: 'Portfolio', phase: 14 },
  { path: '/app/live', title: 'Live Trading (Paper)', phase: 23 },
  { path: '/app/live/new', title: 'New live session', phase: 23 },
  { path: '/app/live/sessions/:id', title: 'Live session', phase: 23 },
  { path: '/app/live/deployments/:id', title: 'Paper deployment', phase: 17 },
  { path: '/app/notifications', title: 'Notifications', phase: 16 },
  { path: '/app/brokers', title: 'Brokers', phase: 16 },
  { path: '/app/profile', title: 'Profile', phase: 16 },
];

/**
 * Roadmap addresses (Section 9) whose backend is not ready. Opening one shows a
 * "not available" page instead of "not found"; nothing in the app links to them.
 * - planned:  deferred by Phase 0 (no backend route yet)
 * - disabled: blocked by Phase 0 (backend route exists but is not safe to use yet)
 */
export interface UnavailableRoute {
  path: string;
  title: string;
  reason: 'planned' | 'disabled';
}

export const UNAVAILABLE_ROUTES: UnavailableRoute[] = [];
