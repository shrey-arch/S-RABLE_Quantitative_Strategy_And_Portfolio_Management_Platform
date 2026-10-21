import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import { REGISTRY_FIXTURE } from '@/features/strategies/registry-fixture';
import { POLL_MS } from './backtest-model';
import BacktestStatusPage from './BacktestStatusPage';

type Reply = { status: number; body: unknown };
const respond = ({ status, body }: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

const RELIANCE = INSTRUMENTS_FIXTURE[0]!;
const NIFTYBEES = INSTRUMENTS_FIXTURE[1]!;

const run = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  strategy_id: 's1',
  broker_account_id: null,
  instrument_id: RELIANCE.id,
  execution_type: 'BACKTEST',
  status: 'PENDING',
  timeframe: '1D',
  initial_capital: 100000,
  execution_config: { lookback: 20 },
  execution_metrics: null,
  run_settings: {
    strategy_key: 'momentum',
    start_timestamp: '2025-01-01T00:00:00+05:30',
    end_timestamp: '2025-06-30T23:59:59+05:30',
    quantity: 2,
    other_instrument_ids: [],
    slippage_bps: 5,
    brokerage_rate: 0.0003,
  },
  error_message: null,
  error: null,
  started_at: null,
  completed_at: null,
  created_at: '2026-10-16T09:00:00Z',
  updated_at: '2026-10-16T09:00:00Z',
  ...over,
});

const RUNNING = { status: 'RUNNING', started_at: '2026-10-16T09:00:02Z' };
const COMPLETED = { ...RUNNING, status: 'COMPLETED', completed_at: '2026-10-16T09:00:09Z' };

const STRATEGY = {
  id: 's1',
  user_id: 'u1',
  name: 'Nifty momentum',
  description: null,
  strategy_type: 'PYTHON',
  strategy_config: { parameters: { template: 'momentum' } },
  python_code: null,
  version: 1,
  is_active: true,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
};

/** Each GET /executions/{id} answers the next reply; the last one repeats. */
function setup(replies: Reply[], cancel?: Reply) {
  const queue = [...replies];
  const get = vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/executions/{execution_id}')
      return respond(queue.length > 1 ? queue.shift()! : queue[0]!);
    if (url === '/strategies/{strategy_id}') return respond({ status: 200, body: STRATEGY });
    if (url === '/instruments') return respond({ status: 200, body: INSTRUMENTS_FIXTURE });
    if (url === '/strategy-registry') return respond({ status: 200, body: REGISTRY_FIXTURE });
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation((() => {
    if (cancel?.status === 200) queue.splice(0, queue.length, cancel);
    return respond(cancel ?? { status: 500, body: {} });
  }) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/app/backtests/e1']}>
          <Routes>
            <Route path="/app/backtests/:id" element={<BacktestStatusPage />} />
            <Route path="/app/backtests/new" element={<h1>New backtest page</h1>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const reads = () =>
    (get.mock.calls as unknown[][]).filter(([url]) => url === '/executions/{execution_id}').length;
  return { get, post, reads, view };
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const badge = () => screen.getByRole('heading', { level: 1, name: 'Backtest' }).parentElement!;
const tick = () => act(() => vi.advanceTimersByTimeAsync(POLL_MS));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BacktestStatusPage', () => {
  it('follows PENDING -> RUNNING -> COMPLETED and stops asking at the end', async () => {
    const { reads } = setup([ok(run()), ok(run(RUNNING)), ok(run(COMPLETED))]);
    await screen.findByText('Waiting for the backtest worker');
    expect(badge()).toHaveTextContent('Pending');
    expect(screen.getByText(/checks for updates every 2.5 seconds/)).toBeInTheDocument();

    await tick();
    await screen.findByText('Running on historical data');
    expect(badge()).toHaveTextContent('Running');

    await tick();
    await screen.findByText('Status: Completed. This is final.');
    const steps = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual([
      'Created (done)16 Oct 2026, 14:30 IST',
      'Started (done)16 Oct 2026, 14:30 IST',
      'Completed (done)16 Oct 2026, 14:30 IST',
    ]);
    expect(screen.getByText('Ran for 7 s.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel backtest/ })).not.toBeInTheDocument();

    const seen = reads();
    expect(seen).toBe(3);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    expect(reads()).toBe(seen);
  });

  it('shows how it was configured, with names instead of ids', async () => {
    setup([
      ok(
        run({
          ...COMPLETED,
          run_settings: {
            ...run().run_settings,
            strategy_key: 'statistical_arbitrage',
            other_instrument_ids: [NIFTYBEES.id],
          },
          execution_config: { lookback: 10, entry_threshold: 1.5 },
        }),
      ),
    ]);
    const config = await screen.findByRole('region', { name: 'Configuration' });
    expect(await within(config).findByText('RELIANCE')).toBeInTheDocument();
    expect(config).toHaveTextContent('Instrument A: RELIANCE');
    expect(config).toHaveTextContent('Instrument B: NIFTYBEES');
    expect(config).toHaveTextContent('Daily (1D), historical data');
    expect(config).toHaveTextContent('01 Jan 2025 to 30 Jun 2025');
    expect(config).toHaveTextContent('\u20b91,00,000.00');
    expect(config).toHaveTextContent('lookback = 10, entry_threshold = 1.5');
    expect(config).toHaveTextContent('5.00 bps');
    expect(config).toHaveTextContent('0.0300% of trade value');
    expect(await screen.findByRole('link', { name: 'Nifty momentum' })).toHaveAttribute(
      'href',
      '/app/strategies/s1',
    );
    expect(screen.getByRole('link', { name: /Edit and rerun/ })).toHaveAttribute(
      'href',
      '/app/backtests/new?from=e1',
    );
    expect(screen.getByRole('link', { name: /View results/ })).toHaveAttribute(
      'href',
      '/app/executions/e1/results',
    );
    expect(screen.getByRole('link', { name: 'See its results' })).toHaveAttribute(
      'href',
      '/app/executions/e1/results',
    );
  });

  it('a failure shows the error code and message from the backend', async () => {
    setup([
      ok(
        run({
          status: 'FAILED',
          started_at: '2026-10-16T09:00:02Z',
          completed_at: '2026-10-16T09:00:03Z',
          error_message: 'No market data for the chosen instrument and dates.',
          error: {
            category: 'MARKET_DATA',
            code: 'BACKTEST_MARKET_DATA_UNAVAILABLE',
            message: 'No market data for the chosen instrument and dates.',
            stage: 'data_loading',
          },
        }),
      ),
    ]);
    const why = await screen.findByRole('region', { name: 'Why it failed' });
    expect(why).toHaveTextContent('BACKTEST_MARKET_DATA_UNAVAILABLE');
    expect(why).toHaveTextContent('MARKET_DATA');
    expect(why).toHaveTextContent('Data loading');
    expect(why).toHaveTextContent('No market data for the chosen instrument and dates.');
    expect(badge()).toHaveTextContent('Failed');
  });

  it('cancel asks first, then shows the cancelled run', async () => {
    const { post } = setup(
      [ok(run(RUNNING))],
      ok(run({ ...RUNNING, status: 'CANCELLED', completed_at: '2026-10-16T09:00:05Z' })),
    );
    fireEvent.click(await screen.findByRole('button', { name: /Cancel backtest/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Cancel backtest/ }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Cancel backtest',
      }),
    );
    await screen.findByText('Status: Cancelled. This is final.');
    expect(post).toHaveBeenCalledWith('/executions/{execution_id}/cancel', {
      params: { path: { execution_id: 'e1' } },
    });
    expect(screen.queryByRole('button', { name: /Cancel backtest/ })).not.toBeInTheDocument();
  });

  it('a run that finished before the cancel arrived shows how it really ended', async () => {
    const { get } = setup([ok(run(RUNNING)), ok(run(COMPLETED))], {
      status: 409,
      body: { detail: 'This execution has already finished (COMPLETED).' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Cancel backtest/ }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Cancel backtest',
      }),
    );
    expect(await screen.findByText('Status: Completed. This is final.')).toBeInTheDocument();
    expect(get).toHaveBeenCalled();
  });

  it("someone else's run, or a missing one, is not available", async () => {
    setup([{ status: 404, body: { detail: 'Execution not found.' } }]);
    expect(
      await screen.findByRole('heading', { name: 'Backtest not available' }),
    ).toBeInTheDocument();
  });

  it('stops asking when the page is left', async () => {
    const { reads, view } = setup([ok(run(RUNNING))]);
    await screen.findByText('Running on historical data');
    await tick();
    const seen = reads();
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    expect(reads()).toBe(seen);
  });
});
