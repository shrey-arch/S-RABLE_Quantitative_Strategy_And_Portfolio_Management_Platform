import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import { coverage } from '@/features/instruments/market-data-fixture';
import { REGISTRY_FIXTURE } from '@/features/strategies/registry-fixture';
import NewBacktestPage from './NewBacktestPage';

type Reply = { status: number; body: unknown };
const respond = ({ status, body }: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

const [RELIANCE, NIFTYBEES] = INSTRUMENTS_FIXTURE as [
  (typeof INSTRUMENTS_FIXTURE)[0],
  (typeof INSTRUMENTS_FIXTURE)[0],
];
const TCS = { ...RELIANCE, id: 'b2c1f0aa-0000-4000-8000-000000000004', symbol: 'TCS', name: 'TCS' };
const INSTRUMENTS = [...INSTRUMENTS_FIXTURE, TCS];

const RULES = {
  parameters: {},
  indicators: [{ name: 'sma3', type: 'SMA', parameters: { window: 3 } }],
  entry_conditions: [
    {
      left: { type: 'price', field: 'close' },
      operator: '>',
      right: { type: 'indicator', name: 'sma3', output: 'value' },
    },
  ],
  exit_conditions: [
    {
      left: { type: 'price', field: 'close' },
      operator: '<',
      right: { type: 'indicator', name: 'sma3', output: 'value' },
    },
  ],
};

const strategy = (id: string, template: string | null, over: Record<string, unknown> = {}) => ({
  id,
  user_id: 'u1',
  name: `Strategy ${id}`,
  description: null,
  strategy_type: template ? 'PYTHON' : 'NO_CODE',
  strategy_config: {
    parameters: template ? { template, lookback: 20 } : {},
    indicators: [],
    entry_conditions: [],
    exit_conditions: [],
  },
  python_code: null,
  version: 1,
  is_active: true,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
  ...over,
});

const STRATEGIES = [
  strategy('mom', 'momentum'),
  strategy('pair', 'statistical_arbitrage'),
  strategy('taa', 'tactical_asset_allocation', {
    strategy_config: { parameters: { template: 'tactical_asset_allocation', top_k: 3 } },
  }),
  strategy('nc', null),
  strategy('off', 'momentum', { is_active: false }),
  strategy('rl', null, { strategy_config: RULES }),
];

const EXECUTION = {
  id: 'e-new',
  strategy_id: 'mom',
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
    quantity: 4,
    other_instrument_ids: [],
    slippage_bps: 10,
    brokerage_rate: 0.0005,
  },
  error_message: null,
  error: null,
  started_at: null,
  completed_at: null,
  created_at: '2026-10-16T09:00:00Z',
  updated_at: '2026-10-16T09:00:00Z',
};

/** Stored data: every instrument has 2025; `bars` rows fall in any chosen range. */
function coverageFor(id: string, query: { start_date?: string; end_date?: string }, bars: number) {
  return coverage({
    instrument_id: id,
    row_count: query.start_date ? bars : 250,
    first_timestamp: query.start_date ? `${query.start_date}T00:00:00Z` : '2025-01-01T00:00:00Z',
    last_timestamp: query.end_date ? `${query.end_date}T00:00:00Z` : '2025-12-31T00:00:00Z',
    trading_days: { ...coverage().trading_days, missing_days: 0, missing_periods: [] },
  });
}

function Status() {
  return <h1>Status {useParams().id}</h1>;
}

function setup(
  path: string,
  opts: { submit?: Reply[]; validate?: Reply; bars?: number; previous?: unknown } = {},
) {
  const submits = [...(opts.submit ?? [{ status: 201, body: EXECUTION }])];
  vi.spyOn(api, 'GET').mockImplementation(((
    url: string,
    init?: { params?: { path?: Record<string, string>; query?: Record<string, string> } },
  ) => {
    if (url === '/strategies') return respond({ status: 200, body: STRATEGIES });
    if (url === '/strategy-registry') return respond({ status: 200, body: REGISTRY_FIXTURE });
    if (url === '/instruments') return respond({ status: 200, body: INSTRUMENTS });
    if (url === '/executions/{execution_id}')
      return respond(
        opts.previous
          ? { status: 200, body: opts.previous }
          : { status: 404, body: { detail: 'Execution not found.' } },
      );
    if (url.endsWith('/coverage')) {
      return respond({
        status: 200,
        body: coverageFor(
          init!.params!.path!.instrument_id!,
          init!.params!.query ?? {},
          opts.bars ?? 120,
        ),
      });
    }
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((url: string) => {
    if (url === '/strategy-registry/{strategy_key}/validate')
      return respond(opts.validate ?? { status: 200, body: {} });
    if (url === '/backtests')
      // Answers slowly, so a second click arrives while the first is still in flight.
      return new Promise((resolve) =>
        setTimeout(() => resolve(respond(submits.shift() ?? { status: 201, body: EXECUTION })), 30),
      );
    throw new Error(`unexpected POST ${url}`);
  }) as never);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app/backtests/new" element={<NewBacktestPage />} />
            <Route path="/app/backtests/:id" element={<Status />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return {
    post,
    backtests: () => (post.mock.calls as unknown[][]).filter(([url]) => url === '/backtests'),
  };
}

const select = (name: string | RegExp) => screen.findByRole('combobox', { name });
const text = (name: string | RegExp) => screen.getByRole('textbox', { name });

async function chooseDates(start = '2025-01-01', end = '2025-06-30') {
  fireEvent.change(screen.getByLabelText('From'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: end } });
}

async function fillMomentum() {
  fireEvent.change(await select('Instrument'), { target: { value: RELIANCE.id } });
  await chooseDates();
  await screen.findByText(/120 daily bars, 01 Jan 2025 to 30 Jun 2025/);
}

afterEach(() => vi.restoreAllMocks());

describe('NewBacktestPage', () => {
  it('lists only strategies that can be backtested and preselects the one in the link', async () => {
    setup('/app/backtests/new?strategy=mom');
    const strategySelect = await select('Strategy');
    const options = within(strategySelect)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual([
      'Choose a strategy',
      'Strategy mom (Momentum, v1)',
      'Strategy pair (Statistical Arbitrage, v1)',
      'Strategy taa (Tactical Asset Allocation, v1)',
      'Strategy rl (No-code rules, v1)',
    ]);
    expect(strategySelect).toHaveValue('mom');
    expect(
      screen.getByText(/2 of your strategies are not listed: only active strategies/),
    ).toBeInTheDocument();
    expect(text('lookback')).toHaveValue('20');
    expect(screen.getByText(/Daily \(1D\) bars of stored historical data/)).toBeInTheDocument();
  });

  it('a no-code strategy runs its saved rules: no parameters, sent as no_code_rules', async () => {
    const { backtests, post } = setup('/app/backtests/new?strategy=rl');
    expect(await select('Strategy')).toHaveValue('rl');
    const rules = screen.getByRole('region', { name: 'Rules' });
    expect(rules).toHaveTextContent('Indicators: sma3 = SMA(window 3).');
    expect(rules).toHaveTextContent('Buy when close > sma3.');
    expect(rules).toHaveTextContent('Sell back to flat when close < sma3.');
    expect(rules).toHaveTextContent('Backtests run these rules long only');
    expect(within(rules).getByRole('link', { name: /Edit the rules/ })).toHaveAttribute(
      'href',
      '/app/builder/rl',
    );
    expect(screen.queryByRole('region', { name: 'Parameters' })).toBeNull();
    await fillMomentum();
    expect(
      screen.getByText(
        'Warm-up: nothing is traded until every indicator in the rules has a value.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Review backtest/ }));

    const review = await screen.findByRole('region', { name: 'Review' });
    expect(review).toHaveTextContent('TemplateNo-code rules');
    expect(review).toHaveTextContent('RulesIndicators: sma3 = SMA(window 3).');
    fireEvent.click(screen.getByRole('button', { name: /Submit backtest/ }));
    await screen.findByRole('heading', { name: 'Status e-new' });
    expect(backtests()[0]![1]).toMatchObject({
      body: { strategy_id: 'rl', strategy_key: 'no_code_rules', execution_config: {} },
    });
    // The rule engine has no parameters to check.
    expect(
      (post.mock.calls as unknown[][]).filter(([url]) => String(url).includes('/validate')),
    ).toHaveLength(0);
  });

  it('a no-code strategy without entry conditions is not offered, with the reason', async () => {
    setup('/app/backtests/new?strategy=nc');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Strategy nc has no entry conditions, so it would never trade. Add one in the builder.',
    );
  });

  it('explains why a linked strategy cannot be backtested', async () => {
    setup('/app/backtests/new?strategy=off');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Strategy off is inactive. Turn it on to backtest it. Choose another strategy below.',
    );
    expect(await select('Strategy')).toHaveValue('');
  });

  it('reviews, then submits exactly what it showed, once, and opens the status page', async () => {
    const { backtests } = setup('/app/backtests/new?strategy=mom');
    await fillMomentum();
    expect(
      screen.getByText(
        'The first 19 bars are warm-up: the strategy needs 20 bars before its first signal. 101 of 120 bars can produce signals.',
      ),
    ).toBeInTheDocument();
    fireEvent.change(text('Initial capital (\u20b9)'), { target: { value: '250000' } });
    fireEvent.change(text('Quantity per trade'), { target: { value: '3' } });
    fireEvent.change(text('Slippage (bps)'), { target: { value: '5' } });
    fireEvent.change(text('Brokerage (%)'), { target: { value: '0.03' } });
    fireEvent.click(screen.getByRole('button', { name: /Review backtest/ }));

    const review = await screen.findByRole('region', { name: 'Review' });
    expect(review).toHaveTextContent('Strategy mom (version 1)');
    expect(review).toHaveTextContent('RELIANCE');
    expect(review).toHaveTextContent('01 Jan 2025 to 30 Jun 2025 (IST, inclusive)');
    expect(review).toHaveTextContent('\u20b92,50,000.00');
    expect(review).toHaveTextContent('lookback = 20');
    expect(review).toHaveTextContent('0.0300% of trade value');
    expect(backtests()).toHaveLength(0);

    const submit = screen.getByRole('button', { name: /Submit backtest/ });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);
    await screen.findByRole('heading', { name: 'Status e-new' });
    expect(backtests()).toHaveLength(1);
    expect(backtests()[0]![1]).toEqual({
      body: {
        strategy_id: 'mom',
        strategy_key: 'momentum',
        instrument_id: RELIANCE.id,
        other_instrument_ids: [],
        timeframe: '1D',
        initial_capital: 250000,
        start_timestamp: '2025-01-01T00:00:00+05:30',
        end_timestamp: '2025-06-30T23:59:59+05:30',
        execution_config: { lookback: 20 },
        quantity: 3,
        slippage_bps: 5,
        brokerage_rate: 0.0003,
      },
    });
  });

  it('nothing is sent while fields are wrong or the dates have no data', async () => {
    const { post } = setup('/app/backtests/new?strategy=mom');
    await select('Strategy');
    fireEvent.change(text('lookback'), { target: { value: 'x' } });
    fireEvent.change(text('Initial capital (\u20b9)'), { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: /Review backtest/ }));
    expect(
      await screen.findByText('Some fields need attention. They are marked below.'),
    ).toBeVisible();
    expect(screen.getByText('Choose an instrument.')).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number.')).toBeInTheDocument();
    expect(screen.getByText('Enter a number.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("shows the backend's parameter check under the parameter", async () => {
    setup('/app/backtests/new?strategy=mom', {
      validate: { status: 422, body: { detail: 'lookback must be greater than 0.' } },
    });
    await fillMomentum();
    fireEvent.change(text('lookback'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Review backtest/ }));
    expect(await screen.findByText('lookback must be greater than 0.')).toBeInTheDocument();
    expect(text('lookback')).toHaveAccessibleDescription(/lookback must be greater than 0/);
    expect(screen.queryByRole('region', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('warns when the range is shorter than the warm-up', async () => {
    setup('/app/backtests/new?strategy=mom', { bars: 12 });
    fireEvent.change(await select('Instrument'), { target: { value: RELIANCE.id } });
    await chooseDates('2025-01-01', '2025-01-17');
    expect(
      await screen.findByText(/Not enough data: 12 bars in this range, but the strategy needs 20/),
    ).toBeInTheDocument();
  });

  it('a busy worker (409) keeps the review open with the reason, and a retry works', async () => {
    const busy = 'Another backtest is running. Wait for it to finish, then submit again.';
    const { backtests } = setup('/app/backtests/new?strategy=mom', {
      submit: [
        { status: 409, body: { detail: busy } },
        { status: 201, body: EXECUTION },
      ],
    });
    await fillMomentum();
    fireEvent.click(screen.getByRole('button', { name: /Review backtest/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Submit backtest/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Another backtest is running');
    expect(alert).toHaveTextContent(busy);
    fireEvent.click(screen.getByRole('button', { name: /Submit backtest/ }));
    await screen.findByRole('heading', { name: 'Status e-new' });
    expect(backtests()).toHaveLength(2);
  });

  it('a pair asks for instruments A and B, and checks data for both', async () => {
    const { backtests } = setup('/app/backtests/new?strategy=pair');
    fireEvent.change(await select('Instrument A'), { target: { value: RELIANCE.id } });
    const b = await select('Instrument B');
    expect(within(b).queryByRole('option', { name: /RELIANCE/ })).not.toBeInTheDocument();
    fireEvent.change(b, { target: { value: NIFTYBEES.id } });
    await chooseDates();
    const preview = screen.getByRole('region', { name: 'Dataset preview' });
    await waitFor(() =>
      expect(
        within(preview).getByText(/Instrument B \(NIFTYBEES\)/).parentElement,
      ).toHaveTextContent('120 daily bars'),
    );
    expect(preview).toHaveTextContent('Only dates that every instrument has are used');
    fireEvent.click(screen.getByRole('button', { name: /Review backtest/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Submit backtest/ }));
    await screen.findByRole('heading', { name: 'Status e-new' });
    expect(backtests()[0]![1]).toMatchObject({
      body: { instrument_id: RELIANCE.id, other_instrument_ids: [NIFTYBEES.id] },
    });
  });

  it('a universe needs at least top_k assets; more can be added and removed', async () => {
    setup('/app/backtests/new?strategy=taa');
    await select('Asset 1');
    expect(screen.getAllByRole('combobox', { name: /^Asset \d$/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Remove Asset/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add asset/ }));
    expect(screen.getAllByRole('combobox', { name: /^Asset \d$/ })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Asset 4' }));
    expect(screen.getAllByRole('combobox', { name: /^Asset \d$/ })).toHaveLength(3);
    fireEvent.change(text('top_k'), { target: { value: '4' } });
    expect(screen.getAllByRole('combobox', { name: /^Asset \d$/ })).toHaveLength(4);
  });

  it('"Edit and rerun" fills in everything from the earlier run', async () => {
    setup('/app/backtests/new?from=e-old', { previous: { ...EXECUTION, id: 'e-old' } });
    expect(await select('Strategy')).toHaveValue('mom');
    expect(screen.getByText(/Filled in from the/)).toBeInTheDocument();
    expect(await select('Instrument')).toHaveValue(RELIANCE.id);
    expect(screen.getByLabelText('From')).toHaveValue('2025-01-01');
    expect(screen.getByLabelText('To')).toHaveValue('2025-06-30');
    expect(text('Quantity per trade')).toHaveValue('4');
    expect(text('Slippage (bps)')).toHaveValue('10');
    expect(text('Brokerage (%)')).toHaveValue('0.05');
    expect(text('lookback')).toHaveValue('20');
  });

  it('a run to repeat that is not the user\u2019s is not shown', async () => {
    setup('/app/backtests/new?from=someone-else');
    expect(await screen.findByText('This run is not available')).toBeInTheDocument();
  });
});
