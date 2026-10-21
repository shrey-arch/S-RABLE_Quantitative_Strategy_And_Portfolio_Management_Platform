import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { CURRENT_REGIME } from '@/features/regime/regime-fixture';
import { SCORES } from '@/features/scoring/scoring-fixture';
import { VS_VALIDATIONS } from '@/features/validation/validation-status-fixture';
import { VERDICT_LABELS } from '@/features/validation/validation-model';
import { formatDateTime, formatNumber } from '@/lib/format';
import DashboardPage from './DashboardPage';

type Reply = { status: number; body: unknown };
type Routes = Record<string, Reply>;

const ok = (body: unknown): Reply => ({ status: 200, body });
const fail = (status = 500): Reply => ({ status, body: { detail: 'boom' } });

const STRATEGIES = [
  { id: 's1', is_active: true },
  { id: 's2', is_active: false },
  { id: 's3', is_active: true },
];
const BROKERS = [
  { id: 'b1', connection_status: 'CONNECTED' },
  { id: 'b2', connection_status: 'DISCONNECTED' },
];
const PORTFOLIOS = [{ id: 'p1' }, { id: 'p2' }];

function defaults(): Routes {
  return {
    '/strategies': ok(STRATEGIES),
    '/brokers/accounts': ok(BROKERS),
    '/instruments': ok([{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }, { id: 'i4' }]),
    '/portfolio/accounts': ok(PORTFOLIOS),
    p1: ok({ total_equity: '100000.10' }),
    p2: ok({ total_equity: '2500.20' }),
    '/regime/current': ok(CURRENT_REGIME),
    '/validations': ok(VS_VALIDATIONS),
  };
}

/** Fakes api.GET by path; portfolio detail calls are keyed by portfolio id. */
function mockApi(routes: Routes) {
  return vi.spyOn(api, 'GET').mockImplementation(((
    path: string,
    init?: { params: { path: { portfolio_id: string } } },
  ) => {
    const key =
      path === '/portfolio/accounts/{portfolio_id}' ? init!.params.path.portfolio_id : path;
    const reply = routes[key];
    if (!reply) throw new Error(`unmocked ${key}`);
    return Promise.resolve({
      ...(reply.status < 300 ? { data: reply.body } : { error: reply.body }),
      response: new Response(null, { status: reply.status }),
    });
  }) as never);
}

function renderDashboard(routes: Partial<Routes> = {}, scores: Reply = ok(SCORES)) {
  const spy = mockApi({ ...defaults(), ...routes } as Routes);
  // POST /scoring is a read (the weights travel in the body).
  vi.spyOn(api, 'POST').mockImplementation((() =>
    Promise.resolve({
      ...(scores.status < 300 ? { data: scores.body } : { error: scores.body }),
      response: new Response(null, { status: scores.status }),
    })) as never);
  const auth: AuthContextValue = {
    state: { status: 'authenticated', user: { full_name: 'Asha Rao' } as never },
    login: vi.fn(),
    logout: vi.fn(),
    expiresAt: null,
    endReason: null,
    updateUser: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AuthContext.Provider value={auth}>
          <MemoryRouter>
            <DashboardPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return spy;
}

const card = (name: string) => screen.getByRole('region', { name });

afterEach(() => vi.restoreAllMocks());

describe('DashboardPage', () => {
  it('shows each number from its endpoint', async () => {
    renderDashboard();
    await waitFor(() => expect(within(card('Strategies')).getByText('2')).toBeInTheDocument());
    expect(card('Strategies')).toHaveTextContent('active of 3 strategies');
    expect(card('Broker accounts')).toHaveTextContent('1connected of 2 accounts');
    expect(card('Instruments')).toHaveTextContent('4active instruments available');
    // 100000.10 + 2500.20, added exactly
    await waitFor(() => expect(card('Portfolios')).toHaveTextContent('1,02,500.30'));
    expect(card('Portfolios')).toHaveTextContent('Simulated equity across 2 portfolios');
  });

  it('one failing widget leaves the others usable', async () => {
    const spy = renderDashboard({ '/brokers/accounts': fail() });
    const brokers = card('Broker accounts');
    expect(await within(brokers).findByRole('alert')).toHaveTextContent(/Couldn.t load/);
    // The other widgets still show their numbers.
    await waitFor(() => expect(card('Strategies')).toHaveTextContent('active of 3'));
    expect(card('Instruments')).toHaveTextContent('4');
    expect(within(card('Strategies')).queryByRole('alert')).not.toBeInTheDocument();

    // Retry reloads only the failed widget.
    spy.mockClear();
    fireEvent.click(within(brokers).getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/brokers/accounts'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('never shows a partial portfolio total when one portfolio fails', async () => {
    renderDashboard({ p2: fail() });
    const portfolios = card('Portfolios');
    expect(await within(portfolios).findByRole('alert')).toBeInTheDocument();
    expect(portfolios).not.toHaveTextContent('1,00,000.10');
  });

  it('empty, zero and failed look different', async () => {
    renderDashboard({
      '/strategies': ok([]), // empty: no records
      '/brokers/accounts': ok([{ id: 'b1', connection_status: 'DISCONNECTED' }]), // zero
      '/instruments': fail(), // failed
    });
    const strategies = card('Strategies');
    await waitFor(() => expect(strategies).toHaveTextContent('No strategies yet.'));
    expect(within(strategies).getByRole('link', { name: /Create a strategy/ })).toHaveAttribute(
      'href',
      '/app/builder/new',
    );
    await waitFor(() =>
      expect(card('Broker accounts')).toHaveTextContent('0connected of 1 account'),
    );
    expect(await within(card('Instruments')).findByRole('alert')).toBeInTheDocument();
  });

  it('shows loading placeholders first', () => {
    renderDashboard();
    expect(within(card('Strategies')).getByRole('status')).toHaveAccessibleName(
      'Loading Strategies',
    );
  });

  it('greets the user and labels portfolio equity as simulated', async () => {
    renderDashboard();
    expect(screen.getByText(/Welcome back, Asha/)).toBeInTheDocument();
    await waitFor(() => expect(card('Portfolios')).toHaveTextContent(/Simulated equity/));
  });

  it('next steps follow the real counts and never guess', async () => {
    renderDashboard({ '/strategies': ok([]), '/brokers/accounts': fail() });
    const steps = screen.getByRole('region', { name: 'Next steps' });
    // No strategies: the step offers a link.
    await waitFor(() =>
      expect(within(steps).getByRole('link', { name: 'Create a strategy' })).toHaveAttribute(
        'href',
        '/app/builder/new',
      ),
    );
    // Portfolios exist: that step is marked done and has no link.
    await waitFor(() =>
      expect(within(steps).getByText(/Create a simulated portfolio/)).toHaveTextContent('(done)'),
    );
    expect(
      within(steps).queryByRole('link', { name: 'Create a simulated portfolio' }),
    ).not.toBeInTheDocument();
    // Backtests are never claimed as done.
    expect(within(steps).getByRole('link', { name: 'Run a backtest' })).toHaveAttribute(
      'href',
      '/app/backtests/new',
    );
    // Brokers failed: no done/not-done claim, but the link is still offered.
    await within(card('Broker accounts')).findByRole('alert');
    expect(within(steps).getByText(/Link a broker account/)).not.toHaveTextContent('(done)');
  });

  it('the market regime widget shows the API values, or says there is no model', async () => {
    renderDashboard();
    const widget = screen.getByRole('region', { name: 'Market regime' });
    expect(await within(widget).findByText(CURRENT_REGIME.regime.name)).toBeInTheDocument();
    expect(widget).toHaveTextContent(
      `Confidence 100.00% \u00b7 NIFTYBEES \u00b7 as of 19 Apr 2024`,
    );
    expect(widget).toHaveTextContent('Model classification, not a forecast');
    expect(within(widget).getByRole('link', { name: /Open market regime/ })).toHaveAttribute(
      'href',
      '/app/regime',
    );
  });

  it('without a trained model the regime widget shows no regime', async () => {
    renderDashboard({ '/regime/current': fail(404) });
    const widget = screen.getByRole('region', { name: 'Market regime' });
    expect(await within(widget).findByText(/No regime model yet/)).toBeInTheDocument();
    expect(widget.textContent).not.toMatch(/\d/);
  });

  it('the top strategies widget lists the three best-ranked, as scored by the API', async () => {
    renderDashboard();
    const widget = screen.getByRole('region', { name: 'Top strategies by score' });
    const items = await within(widget).findAllByRole('listitem');
    const top = SCORES.rows.filter((r) => r.status === 'SCORED').slice(0, 3);
    expect(items).toHaveLength(3);
    items.forEach((item, i) => {
      expect(item).toHaveTextContent(
        `${top[i]!.rank}.${top[i]!.name}Score ${formatNumber(top[i]!.composite_score, 3)}`,
      );
    });
    expect(within(widget).getByRole('link', { name: /Open scoring/ })).toHaveAttribute(
      'href',
      '/app/scoring',
    );
  });

  it('with nothing scored the widget says so and shows no score', async () => {
    renderDashboard({}, ok({ ...SCORES, rows: SCORES.rows.filter((r) => r.status !== 'SCORED') }));
    const widget = screen.getByRole('region', { name: 'Top strategies by score' });
    expect(await within(widget).findByText(/No scored strategies yet/)).toBeInTheDocument();
    expect(widget.textContent).not.toMatch(/\d/);
  });

  it('the latest validation verdicts widget lists them as GET /validations returns them', async () => {
    renderDashboard();
    const widget = screen.getByRole('region', { name: 'Latest validation verdicts' });
    const items = await within(widget).findAllByRole('listitem');
    const latest = VS_VALIDATIONS.slice(0, 5);
    expect(items).toHaveLength(latest.length);
    items.forEach((item, i) => {
      const v = latest[i]!;
      expect(item).toHaveTextContent(
        `${v.strategy_name}${VERDICT_LABELS[v.verdict.status]}${formatDateTime(v.completed_at!)}`,
      );
      expect(within(item).getByRole('link')).toHaveAttribute('href', `/app/validation/${v.id}`);
    });
    expect(screen.queryByRole('region', { name: 'Coming later' })).toBeNull();
  });

  it('without validations the widget invites one and shows no number', async () => {
    renderDashboard({ '/validations': ok([]) });
    const widget = screen.getByRole('region', { name: 'Latest validation verdicts' });
    expect(await within(widget).findByText(/No validations yet/)).toBeInTheDocument();
    expect(widget.textContent).not.toMatch(/\d/);
  });
});
