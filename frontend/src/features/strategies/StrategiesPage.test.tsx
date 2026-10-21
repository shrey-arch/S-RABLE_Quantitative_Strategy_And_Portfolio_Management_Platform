import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { REGISTRY_FIXTURE } from './registry-fixture';
import StrategiesPage from './StrategiesPage';

type Reply = { status: number; body: unknown };
const ok = (body: unknown): Reply => ({ status: 200, body });
const fail = (status = 500): Reply => ({ status, body: { detail: 'boom' } });
const respond = (reply: Reply) =>
  Promise.resolve({
    ...(reply.status < 300 ? { data: reply.body } : { error: reply.body }),
    response: new Response(null, { status: reply.status }),
  });

const strategy = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  user_id: 'u1',
  name: 'My momentum',
  description: null,
  strategy_type: 'NO_CODE',
  strategy_config: {},
  version: 2,
  is_active: true,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-02T04:30:00+00:00',
  ...over,
});

function setup(gets: Record<string, Reply | (() => Reply)>, patch?: () => Reply) {
  const get = vi.spyOn(api, 'GET').mockImplementation(((path: string) => {
    const reply = gets[path];
    if (!reply) throw new Error(`unmocked ${path}`);
    return respond(typeof reply === 'function' ? reply() : reply);
  }) as never);
  const patchSpy = vi
    .spyOn(api, 'PATCH')
    .mockImplementation((() => respond(patch ? patch() : fail())) as never);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter>
          <StrategiesPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { get, patch: patchSpy };
}

/** How many GET calls went to a path. */
const callsTo = (spy: { mock: { calls: unknown[][] } }, path: string) =>
  spy.mock.calls.filter((args) => args[0] === path);

const myTable = () => screen.getByRole('table', { name: 'My strategies' });

afterEach(() => vi.restoreAllMocks());

describe('StrategiesPage - core library', () => {
  it('renders all five core strategies from the registry, in order', async () => {
    setup({ '/strategy-registry': ok(REGISTRY_FIXTURE), '/strategies': ok([]) });
    const cards = await screen.findAllByRole('article');
    expect(cards.map((c) => within(c).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Momentum',
      'Mean Reversion',
      'Volatility Arbitrage',
      'Statistical Arbitrage',
      'Tactical Asset Allocation',
    ]);
  });

  it('shows parameters and defaults from the API, and backtest support', async () => {
    setup({ '/strategy-registry': ok(REGISTRY_FIXTURE), '/strategies': ok([]) });
    const meanRev = await screen.findByRole('article', { name: 'Mean Reversion' });
    const params = within(meanRev).getByRole('table', { name: /default parameters/ });
    expect(params).toHaveTextContent('lookback');
    expect(params).toHaveTextContent('entry_threshold');
    expect(params).toHaveTextContent('2.0');
    expect(meanRev).toHaveTextContent('Can be backtested');

    const pair = screen.getByRole('article', { name: 'Statistical Arbitrage' });
    expect(pair).toHaveTextContent('Can be backtested. Runs on two instruments (A and B).');
    expect(pair).toHaveTextContent('instrument_a, instrument_b');
    expect(screen.getByRole('article', { name: 'Tactical Asset Allocation' })).toHaveTextContent(
      'Runs on a group of instruments',
    );
  });

  it('only uses the API data: a changed default shows as sent', async () => {
    const changed = structuredClone(REGISTRY_FIXTURE);
    changed[0]!.parameters[0]!.default = 55;
    setup({ '/strategy-registry': ok(changed), '/strategies': ok([]) });
    const momentum = await screen.findByRole('article', { name: 'Momentum' });
    expect(within(momentum).getByRole('table')).toHaveTextContent('55');
  });

  it('shows an error with retry when the registry fails', async () => {
    const { get } = setup({ '/strategy-registry': fail(), '/strategies': ok([]) });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    fireEvent.click(within(alert).getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(callsTo(get, '/strategy-registry')).toHaveLength(2));
  });
});

describe('StrategiesPage - my strategies', () => {
  it('lists the user strategies with type, version, status and a detail link', async () => {
    setup({
      '/strategy-registry': ok(REGISTRY_FIXTURE),
      '/strategies': ok([
        strategy(),
        strategy({
          id: 's2',
          name: 'Py rev',
          strategy_type: 'PYTHON',
          version: 1,
          is_active: false,
        }),
      ]),
    });
    const table = await screen.findByRole('table', { name: 'My strategies' });
    const [first, second, ...rest] = within(table).getAllByRole('row').slice(1);
    expect(rest).toHaveLength(0);
    expect(first!).toHaveTextContent('No code');
    expect(first!).toHaveTextContent('v2');
    expect(first!).toHaveTextContent('02 Oct 2026, 10:00 IST');
    expect(within(first!).getByRole('link', { name: 'My momentum' })).toHaveAttribute(
      'href',
      '/app/strategies/s1',
    );
    expect(within(first!).getByRole('switch', { name: 'Active: My momentum' })).toBeChecked();
    expect(within(second!).getByRole('switch', { name: 'Active: Py rev' })).not.toBeChecked();
    expect(second!).toHaveTextContent('Python');
  });

  it('links to the no-code builder and the Python editor next to New strategy', async () => {
    setup({ '/strategy-registry': ok(REGISTRY_FIXTURE), '/strategies': ok([]) });
    expect(await screen.findByRole('link', { name: /Build without code/ })).toHaveAttribute(
      'href',
      '/app/builder/new',
    );
    expect(screen.getByRole('link', { name: /Write Python/ })).toHaveAttribute(
      'href',
      '/app/builder/new?type=python',
    );
    expect(screen.getByRole('button', { name: /New strategy/ })).toBeInTheDocument();
  });

  it('shows an empty state when the user has none', async () => {
    setup({ '/strategy-registry': ok(REGISTRY_FIXTURE), '/strategies': ok([]) });
    expect(await screen.findByText('No strategies yet')).toBeInTheDocument();
  });

  it('shows an error when the list fails', async () => {
    setup({ '/strategy-registry': ok(REGISTRY_FIXTURE), '/strategies': fail() });
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('toggling sends only is_active and refreshes the list from the server', async () => {
    let saved = true;
    const { get, patch } = setup(
      {
        '/strategy-registry': ok(REGISTRY_FIXTURE),
        '/strategies': () => ok([strategy({ is_active: saved })]),
      },
      () => {
        saved = false;
        return ok(strategy({ is_active: false, version: 3 }));
      },
    );
    const toggle = await screen.findByRole('switch', { name: 'Active: My momentum' });
    fireEvent.click(toggle);

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/strategies/{strategy_id}', {
      params: { path: { strategy_id: 's1' } },
      body: { is_active: false },
    });
    await waitFor(() => expect(callsTo(get, '/strategies')).toHaveLength(2));
    await waitFor(() =>
      expect(
        within(myTable()).getByRole('switch', { name: 'Active: My momentum' }),
      ).not.toBeChecked(),
    );
  });

  it('a failed toggle goes back to the saved value', async () => {
    const { patch } = setup(
      { '/strategy-registry': ok(REGISTRY_FIXTURE), '/strategies': ok([strategy()]) },
      () => fail(500),
    );
    fireEvent.click(await screen.findByRole('switch', { name: 'Active: My momentum' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Active: My momentum' })).toBeEnabled(),
    );
    expect(screen.getByRole('switch', { name: 'Active: My momentum' })).toBeChecked();
  });
});
