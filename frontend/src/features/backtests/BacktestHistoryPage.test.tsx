import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import { POLL_MS } from './backtest-model';
import BacktestHistoryPage from './BacktestHistoryPage';

const respond = (status: number, body: unknown) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

const RELIANCE = INSTRUMENTS_FIXTURE[0]!;
const NIFTYBEES = INSTRUMENTS_FIXTURE[1]!;

const run = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  strategy_id: 's1',
  broker_account_id: null,
  instrument_id: RELIANCE.id,
  execution_type: 'BACKTEST',
  status: 'COMPLETED',
  timeframe: '1D',
  initial_capital: 100000,
  execution_config: { lookback: 20 },
  execution_metrics: null,
  run_settings: {
    strategy_key: 'momentum',
    start_timestamp: '2025-01-01T00:00:00+05:30',
    end_timestamp: '2025-06-30T23:59:59+05:30',
    quantity: 1,
    other_instrument_ids: [],
    slippage_bps: 0,
    brokerage_rate: 0,
  },
  error_message: null,
  error: null,
  started_at: '2026-10-16T09:00:02Z',
  completed_at: '2026-10-16T09:00:09Z',
  created_at: '2026-10-16T09:00:00Z',
  updated_at: '2026-10-16T09:00:09Z',
  ...over,
});

const RUNS = [
  run('e3', {
    status: 'FAILED',
    error: { code: 'BACKTEST_MARKET_DATA_UNAVAILABLE', category: 'MARKET_DATA' },
    created_at: '2026-10-16T11:00:00Z',
  }),
  run('e2', {
    strategy_id: 's2',
    run_settings: {
      ...run('x').run_settings,
      strategy_key: 'statistical_arbitrage',
      other_instrument_ids: [NIFTYBEES.id],
    },
    created_at: '2026-10-16T10:00:00Z',
  }),
  run('e1', { strategy_id: 'gone' }),
];

const STRATEGIES = [
  { id: 's1', name: 'Nifty momentum' },
  { id: 's2', name: 'Pairs RIL/NIFTYBEES' },
].map((s) => ({
  ...s,
  user_id: 'u1',
  description: null,
  strategy_type: 'PYTHON',
  strategy_config: {},
  python_code: null,
  version: 1,
  is_active: true,
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
}));

function Where() {
  const { search } = useLocation();
  return <output aria-label="address">{search}</output>;
}

function setup(list: (query: Record<string, unknown>) => unknown[], path = '/app/executions') {
  const get = vi.spyOn(api, 'GET').mockImplementation(((
    url: string,
    init?: { params?: { query?: Record<string, unknown> } },
  ) => {
    if (url === '/executions') return respond(200, list(init?.params?.query ?? {}));
    if (url === '/strategies') return respond(200, STRATEGIES);
    if (url === '/instruments') return respond(200, INSTRUMENTS_FIXTURE);
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/app/executions"
              element={
                <>
                  <BacktestHistoryPage />
                  <Where />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const listCalls = () =>
    (get.mock.calls as unknown[][])
      .filter(([url]) => url === '/executions')
      .map(([, init]) => (init as { params: { query: Record<string, unknown> } }).params.query);
  return { listCalls };
}

const table = () => screen.findByRole('table', { name: 'Backtests' });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BacktestHistoryPage', () => {
  it('lists the runs with names, instruments, status, and a link to each', async () => {
    setup(() => RUNS);
    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(4);
    await within(rows[2]!).findByText('Pairs RIL/NIFTYBEES');
    expect(rows[1]).toHaveTextContent('Nifty momentum');
    expect(rows[1]).toHaveTextContent('Failed');
    expect(rows[1]).toHaveTextContent('BACKTEST_MARKET_DATA_UNAVAILABLE');
    expect(rows[2]).toHaveTextContent('Statistical Arbitrage');
    expect(rows[2]).toHaveTextContent('RELIANCE, NIFTYBEES');
    expect(rows[2]).toHaveTextContent('01 Jan 2025 to 30 Jun 2025');
    expect(rows[2]).toHaveTextContent('Completed');
    expect(rows[2]).toHaveTextContent('7 s');
    expect(within(rows[2]!).getByRole('link', { name: /View results/ })).toHaveAttribute(
      'href',
      '/app/executions/e2/results',
    );
    expect(within(rows[1]!).queryByRole('link', { name: /View results/ })).toBeNull();
    expect(rows[3]).toHaveTextContent('Deleted strategy');
    expect(within(rows[2]!).getByRole('link', { name: '16 Oct 2026, 15:30 IST' })).toHaveAttribute(
      'href',
      '/app/backtests/e2',
    );
    expect(screen.getByText('3 backtests.')).toBeInTheDocument();
  });

  it('sends the filters to the backend and keeps them in the address', async () => {
    const { listCalls } = setup(() => RUNS);
    await table();
    expect(listCalls().at(-1)).toEqual({ execution_type: 'BACKTEST', limit: 500 });

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
      target: { value: 'FAILED' },
    });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Strategy' }), {
      target: { value: 's1' },
    });
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Created to'), { target: { value: '2026-10-16' } });
    await screen.findByRole('table', { name: 'Backtests' });
    expect(listCalls().at(-1)).toEqual({
      status: 'FAILED',
      execution_type: 'BACKTEST',
      strategy_id: 's1',
      created_from: '2026-10-01T00:00:00+05:30',
      created_to: '2026-10-16T23:59:59+05:30',
      limit: 500,
    });
    expect(screen.getByRole('status', { name: 'address' })).toHaveTextContent(
      '?status=FAILED&strategy=s1&from=2026-10-01&to=2026-10-16',
    );
  });

  it('filters from the address are applied on first load', async () => {
    const { listCalls } = setup(
      () => [],
      '/app/executions?status=CANCELLED&instrument=' + RELIANCE.id,
    );
    expect(await screen.findByText('No backtests match these filters')).toBeInTheDocument();
    expect(listCalls()[0]).toEqual({
      status: 'CANCELLED',
      execution_type: 'BACKTEST',
      instrument_id: RELIANCE.id,
      limit: 500,
    });
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('CANCELLED');
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(await screen.findByText('No backtests yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /New backtest/ })).toHaveLength(2);
  });

  it('lists backtests only: validation runs are on the Validation page', async () => {
    const { listCalls } = setup(() => RUNS);
    await table();
    expect(listCalls().every((q) => q.execution_type === 'BACKTEST')).toBe(true);
    expect(screen.queryByRole('combobox', { name: 'Type' })).toBeNull();
  });

  it('asks again while a run is in progress, and stops when all are finished', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    const { listCalls } = setup(() => {
      reads += 1;
      return reads < 2 ? [run('e9', { status: 'RUNNING', completed_at: null })] : [run('e9')];
    });
    expect(await screen.findByText(/Some are still running/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText('1 backtest.')).toBeInTheDocument();
    const seen = listCalls().length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    expect(listCalls().length).toBe(seen);
  });
});
