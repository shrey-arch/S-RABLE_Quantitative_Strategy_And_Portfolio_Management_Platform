import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { AuthRoot } from './AuthRoot';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { APP_ROUTES, PUBLIC_ROUTES, UNAVAILABLE_ROUTES, type AppRoute } from './routes';

/**
 * Lazy routes: each page is downloaded only when it is first opened.
 * Each route has its own error boundary, so one broken page can't blank the app.
 *
 * When a feature page is built, replace its placeholder here, e.g.
 *   '/app/backtests/new': () => import('@/features/backtests/NewBacktestPage'),
 */
const pages: Record<string, () => Promise<{ default: React.ComponentType }>> = {
  '/': () => import('@/features/landing/LandingPage'),
  '/login': () => import('@/features/auth/LoginPage'),
  '/register': () => import('@/features/auth/RegisterPage'),
  '/app/dashboard': () => import('@/features/dashboard/DashboardPage'),
  '/app/strategies': () => import('@/features/strategies/StrategiesPage'),
  '/app/strategies/:id': () => import('@/features/strategies/StrategyDetailPage'),
  '/app/instruments': () => import('@/features/instruments/InstrumentsPage'),
  '/app/instruments/:id': () => import('@/features/instruments/InstrumentDetailPage'),
  '/app/indicators': () => import('@/features/indicators/IndicatorsPage'),
  '/app/builder/new': () => import('@/features/builder/BuilderPage'),
  '/app/builder/:id': () => import('@/features/builder/BuilderPage'),
  '/app/backtests/new': () => import('@/features/backtests/NewBacktestPage'),
  '/app/backtests/:id': () => import('@/features/backtests/BacktestStatusPage'),
  '/app/executions': () => import('@/features/backtests/BacktestHistoryPage'),
  '/app/executions/:id/results': () => import('@/features/results/ResultsPage'),
  '/app/validation': () => import('@/features/validation/ValidationHistoryPage'),
  '/app/validation/new': () => import('@/features/validation/NewValidationPage'),
  '/app/validation/:id': () => import('@/features/validation/ValidationReportPage'),
  '/app/portfolio-backtests': () => import('@/features/portfolio-backtests/PortfolioBacktestsPage'),
  '/app/portfolio-backtests/new': () =>
    import('@/features/portfolio-backtests/NewPortfolioBacktestPage'),
  '/app/portfolio-backtests/:id': () =>
    import('@/features/portfolio-backtests/PortfolioBacktestPage'),
  '/app/regime': () => import('@/features/regime/RegimePage'),
  '/app/scoring': () => import('@/features/scoring/ScoringPage'),
  '/app/records': () => import('@/features/records/RecordsPage'),
  '/app/portfolios': () => import('@/features/portfolios/PortfoliosPage'),
  '/app/portfolios/:id': () => import('@/features/portfolios/PortfolioDetailPage'),
  '/app/live': () => import('@/features/live/LiveTradingPage'),
  '/app/live/new': () => import('@/features/live/NewLiveSessionPage'),
  '/app/live/sessions/:id': () => import('@/features/live/LiveSessionPage'),
  '/app/live/deployments/:id': () => import('@/features/paper/DeploymentDetailPage'),
  '/app/notifications': () => import('@/features/notifications/NotificationsPage'),
  '/app/brokers': () => import('@/features/brokers/BrokersPage'),
  '/app/profile': () => import('@/features/profile/ProfilePage'),
};

function toRoute(route: AppRoute): RouteObject {
  const load = pages[route.path];
  return {
    path: route.path,
    errorElement: <RouteErrorPage />,
    lazy: load
      ? async () => ({ Component: (await load()).default })
      : async () => {
          const { PlaceholderPage } = await import('./pages/PlaceholderPage');
          return { Component: () => <PlaceholderPage title={route.title} phase={route.phase} /> };
        },
  };
}

/** Roadmap areas that are not usable in this version: an honest "not available" page. */
const unavailableRoutes: RouteObject[] = UNAVAILABLE_ROUTES.map((route) => ({
  path: route.path,
  errorElement: <RouteErrorPage />,
  lazy: async () => {
    const { NotAvailablePage } = await import('./pages/NotAvailablePage');
    return { Component: () => <NotAvailablePage title={route.title} reason={route.reason} /> };
  },
}));

const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/api-check',
        errorElement: <RouteErrorPage />,
        lazy: async () => ({ Component: (await import('./pages/ApiCheckPage')).default }),
      },
      {
        path: '/dev/components',
        errorElement: <RouteErrorPage />,
        lazy: async () => ({ Component: (await import('./pages/ComponentsCheckPage')).default }),
      },
      {
        path: '/dev/shared',
        errorElement: <RouteErrorPage />,
        lazy: async () => ({ Component: (await import('./pages/SharedComponentsPage')).default }),
      },
      {
        path: '/dev/table',
        errorElement: <RouteErrorPage />,
        lazy: async () => ({ Component: (await import('./pages/TableCheckPage')).default }),
      },
      {
        path: '/dev/pickers',
        errorElement: <RouteErrorPage />,
        lazy: async () => ({ Component: (await import('./pages/PickersCheckPage')).default }),
      },
      {
        path: '/dev/session',
        errorElement: <RouteErrorPage />,
        lazy: async () => ({ Component: (await import('./pages/SessionCheckPage')).default }),
      },
      {
        path: '/dev/crash',
        errorElement: <RouteErrorPage />,
        Component: () => {
          throw new Error('Deliberate crash to test the error boundary');
        },
      },
    ]
  : [];

const routes: RouteObject[] = [
  {
    // Root: provides the login session to every page.
    element: <AuthRoot />,
    errorElement: <RouteErrorPage />,
    children: [
      ...PUBLIC_ROUTES.map(toRoute),

      // Everything under /app requires a logged-in user and shares the app shell.
      {
        element: <RequireAuth />,
        children: [
          {
            // Loaded on first visit to /app, so public pages stay small.
            lazy: async () => ({
              Component: (await import('@/components/layout/AppShell')).AppShell,
            }),
            children: [
              { path: '/app', element: <Navigate to="/app/dashboard" replace /> },
              ...APP_ROUTES.map(toRoute),
              {
                // Feature 7: Paper Trading lives in Live Trading (Paper) now.
                path: '/app/paper',
                lazy: async () => ({
                  Component: (await import('./pages/PaperRedirect')).default,
                }),
              },
              {
                path: '/app/paper/deployments/:id',
                lazy: async () => ({
                  Component: (await import('./pages/PaperRedirect')).PaperDeploymentRedirect,
                }),
              },
              {
                path: '/app/executions/:id',
                lazy: async () => ({
                  Component: (await import('./pages/ExecutionRedirect')).default,
                }),
              },
              ...unavailableRoutes,
              {
                path: '/app/*',
                lazy: async () => ({
                  Component: (await import('./pages/AppNotFoundPage')).default,
                }),
              },
            ],
          },
        ],
      },

      // Developer-only pages (not included in production builds).
      ...devRoutes,

      {
        path: '*',
        lazy: async () => ({ Component: (await import('./pages/NotFoundPage')).default }),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
