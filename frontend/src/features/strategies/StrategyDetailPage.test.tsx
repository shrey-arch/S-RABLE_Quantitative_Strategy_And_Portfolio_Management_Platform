import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import StrategyDetailPage from './StrategyDetailPage';

type Reply = { status: number; body: unknown };
const ok = (body: unknown): Reply => ({ status: 200, body });
const fail = (status: number): Reply => ({ status, body: { detail: 'Strategy not found.' } });
const respond = (reply: Reply) =>
  Promise.resolve({
    ...(reply.status < 300 ? { data: reply.body } : { error: reply.body }),
    response: new Response(null, { status: reply.status }),
  });

const STRATEGY = {
  id: 's1',
  user_id: 'u1',
  name: 'Nifty momentum',
  description: 'Trend following on Nifty 50.',
  strategy_type: 'NO_CODE',
  strategy_config: {
    parameters: { template: 'momentum', lookback: 50 },
    indicators: [{ name: 'sma_50', type: 'SMA', parameters: { period: 50 } }],
    entry_conditions: [
      {
        left: { type: 'indicator', name: 'sma_50' },
        operator: '<',
        right: { type: 'value', value: 101.5 },
      },
    ],
    exit_conditions: [],
  },
  version: 3,
  is_active: true,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-02T04:30:00+00:00',
};

function setup(get: Reply, del: Reply = { status: 204, body: undefined }) {
  const getSpy = vi.spyOn(api, 'GET').mockImplementation((() => respond(get)) as never);
  const delSpy = vi.spyOn(api, 'DELETE').mockImplementation((() => respond(del)) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/app/strategies/s1']}>
          <Routes>
            <Route path="/app/strategies/:id" element={<StrategyDetailPage />} />
            <Route path="/app/strategies" element={<h1>Strategy list</h1>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { getSpy, delSpy };
}

afterEach(() => vi.restoreAllMocks());

describe('StrategyDetailPage', () => {
  it('loads the strategy by the id in the address', async () => {
    const { getSpy } = setup(ok(STRATEGY));
    await screen.findByRole('heading', { level: 1, name: 'Nifty momentum' });
    expect(getSpy).toHaveBeenCalledWith('/strategies/{strategy_id}', {
      params: { path: { strategy_id: 's1' } },
    });
  });

  it('shows details and the configuration read-only', async () => {
    setup(ok(STRATEGY));
    await screen.findByRole('heading', { level: 1, name: 'Nifty momentum' });
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('No code')).toBeInTheDocument();
    expect(screen.getByText('Version 3')).toBeInTheDocument();
    expect(screen.getByText('Trend following on Nifty 50.')).toBeInTheDocument();
    expect(screen.getByText('01 Oct 2026, 15:30 IST')).toBeInTheDocument();

    const params = screen.getByRole('table', { name: 'Parameters' });
    expect(params).toHaveTextContent('template');
    expect(params).toHaveTextContent('momentum');
    expect(params).toHaveTextContent('50');
    expect(screen.getByText('sma_50 < 101.5')).toBeInTheDocument();
    expect(screen.getByText('No exit conditions.')).toBeInTheDocument();
    expect(screen.getByText(/"lookback": 50/)).toBeInTheDocument();
    // Read-only: nothing to type into.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('offers Backtest and Validate for this strategy', async () => {
    setup(ok(STRATEGY));
    const backtest = await screen.findByRole('link', { name: /Backtest/ });
    expect(backtest).toHaveAttribute('href', '/app/backtests/new?strategy=s1');
    expect(screen.getByRole('link', { name: /Validate/ })).toHaveAttribute(
      'href',
      '/app/validation/new?strategy=s1',
    );
    expect(screen.queryByText('Planned')).not.toBeInTheDocument();
  });

  it('a no-code strategy is edited in the builder and can be backtested', async () => {
    setup(
      ok({
        ...STRATEGY,
        strategy_config: { ...STRATEGY.strategy_config, parameters: { quantity: 10 } },
      }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Nifty momentum' });
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute('href', '/app/builder/s1');
    expect(screen.getByRole('link', { name: /Backtest/ })).toHaveAttribute(
      'href',
      '/app/backtests/new?strategy=s1',
    );
  });

  it('a Python strategy shows its code, is edited in the editor and can be backtested', async () => {
    setup(
      ok({
        ...STRATEGY,
        strategy_type: 'PYTHON',
        strategy_config: {
          parameters: {},
          indicators: [],
          entry_conditions: [],
          exit_conditions: [],
        },
        python_code: 'def generate_signal(context):\n    return None\n',
      }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Nifty momentum' });
    expect(screen.getByLabelText('Saved Python code')).toHaveTextContent(
      'def generate_signal(context):',
    );
    expect(screen.queryByRole('heading', { name: 'Configuration' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute('href', '/app/builder/s1');
    // Feature 6: the backend runs the saved code in its isolated sandbox.
    expect(screen.getByRole('link', { name: /Backtest/ })).toHaveAttribute(
      'href',
      '/app/backtests/new?strategy=s1',
    );
    expect(screen.getByText(/isolated sandbox/)).toBeVisible();
    expect(
      screen.getByText(/cannot be deployed to the paper account or run live yet/),
    ).toBeVisible();
  });

  it.each([404, 422])('a %s (not yours, missing or bad id) shows not available', async (status) => {
    setup(fail(status));
    await screen.findByRole('heading', { level: 1, name: 'Strategy not available' });
    expect(
      screen.getByText(/does not exist, or it belongs to another account/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
  });

  it('a server error offers retry', async () => {
    setup(fail(500));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });

  it('delete asks first; Cancel sends nothing', async () => {
    const { delSpy } = setup(ok(STRATEGY));
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete Nifty momentum?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(delSpy).not.toHaveBeenCalled();
  });

  it('confirming deletes and returns to the list', async () => {
    const { delSpy } = setup(ok(STRATEGY));
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete strategy' }));
    await screen.findByRole('heading', { name: 'Strategy list' });
    expect(delSpy).toHaveBeenCalledWith('/strategies/{strategy_id}', {
      params: { path: { strategy_id: 's1' } },
    });
  });

  it('a failed delete stays on the page', async () => {
    const { delSpy } = setup(ok(STRATEGY), fail(500));
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete strategy' }));
    await waitFor(() => expect(delSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Nifty momentum' })).toBeInTheDocument();
  });
});
