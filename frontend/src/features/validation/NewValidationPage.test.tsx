import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import { coverage } from '@/features/instruments/market-data-fixture';
import { REGISTRY_FIXTURE } from '@/features/strategies/registry-fixture';
import { MR_MODEL_GMM, MR_MODEL_SUP, MR_MODELS } from './model-regime-fixture';
import NewValidationPage from './NewValidationPage';

type Reply = { status: number; body: unknown };
const respond = ({ status, body }: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

const RELIANCE = INSTRUMENTS_FIXTURE[0]!;

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
  exit_conditions: [],
};

const strategy = (id: string, config: Record<string, unknown>, type = 'PYTHON') => ({
  id,
  user_id: 'u1',
  name: `Strategy ${id}`,
  description: null,
  strategy_type: type,
  strategy_config: { indicators: [], entry_conditions: [], exit_conditions: [], ...config },
  python_code: null,
  version: 1,
  is_active: true,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
});

const STRATEGIES = [
  strategy('mom', { parameters: { template: 'momentum', lookback: 20 } }),
  strategy('rl', RULES, 'NO_CODE'),
];

const run = (id: string, type: 'BACKTEST' | 'VALIDATION', extra: Record<string, unknown> = {}) => ({
  id,
  strategy_id: 'mom',
  broker_account_id: null,
  instrument_id: RELIANCE.id,
  execution_type: type,
  status: 'COMPLETED',
  timeframe: '1D',
  initial_capital: 50000,
  execution_config: { lookback: 15 },
  execution_metrics: null,
  run_settings: {
    strategy_key: 'momentum',
    start_timestamp: '2025-01-01T00:00:00+05:30',
    end_timestamp: '2025-06-30T23:59:59+05:30',
    quantity: 3,
    other_instrument_ids: [],
    slippage_bps: 5,
    brokerage_rate: 0.0003,
    ...extra,
  },
  error_message: null,
  error: null,
  started_at: '2026-10-16T09:00:01Z',
  completed_at: '2026-10-16T09:00:09Z',
  created_at: '2026-10-16T09:00:00Z',
  updated_at: '2026-10-16T09:00:09Z',
});

function Report() {
  return <h1>Report {useParams().id}</h1>;
}

function setup(path: string, opts: { previous?: unknown; submit?: Reply } = {}) {
  vi.spyOn(api, 'GET').mockImplementation(((
    url: string,
    init?: { params?: { path?: Record<string, string>; query?: Record<string, string> } },
  ) => {
    if (url === '/strategies') return respond({ status: 200, body: STRATEGIES });
    if (url === '/strategy-registry') return respond({ status: 200, body: REGISTRY_FIXTURE });
    if (url === '/instruments') return respond({ status: 200, body: INSTRUMENTS_FIXTURE });
    if (url === '/regime/models') return respond({ status: 200, body: MR_MODELS });
    if (url === '/regime/models/{model_id}')
      return respond({
        status: 200,
        body: init!.params!.path!.model_id === MR_MODEL_GMM.id ? MR_MODEL_GMM : MR_MODEL_SUP,
      });
    if (url === '/executions/{execution_id}')
      return respond(
        opts.previous
          ? { status: 200, body: opts.previous }
          : { status: 404, body: { detail: 'Execution not found.' } },
      );
    if (url.endsWith('/coverage')) {
      const q = init!.params!.query ?? {};
      return respond({
        status: 200,
        body: coverage({
          instrument_id: init!.params!.path!.instrument_id!,
          row_count: q.start_date ? 120 : 250,
          first_timestamp: `${q.start_date ?? '2025-01-01'}T00:00:00Z`,
          last_timestamp: `${q.end_date ?? '2025-12-31'}T00:00:00Z`,
          trading_days: { ...coverage().trading_days, missing_days: 0, missing_periods: [] },
        }),
      });
    }
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((url: string) => {
    if (url === '/strategy-registry/{strategy_key}/validate')
      return respond({ status: 200, body: {} });
    if (url === '/validations')
      return respond(opts.submit ?? { status: 201, body: run('v-new', 'VALIDATION') });
    throw new Error(`unexpected POST ${url}`);
  }) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app/validation/new" element={<NewValidationPage />} />
            <Route path="/app/validation/:id" element={<Report />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return {
    sent: () =>
      (post.mock.calls as unknown[][])
        .filter(([url]) => url === '/validations')
        .map(([, init]) => (init as { body: Record<string, unknown> }).body),
  };
}

const field = (name: string | RegExp) => screen.getByRole('textbox', { name });
const type = (name: string | RegExp, value: string) =>
  fireEvent.change(field(name), { target: { value } });

async function fillMomentum() {
  fireEvent.change(await screen.findByRole('combobox', { name: 'Instrument' }), {
    target: { value: RELIANCE.id },
  });
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-01' } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2025-06-30' } });
  await screen.findByText(/120 daily bars, 01 Jan 2025 to 30 Jun 2025/);
}

afterEach(() => vi.restoreAllMocks());

describe('NewValidationPage', () => {
  it('starts from a backtest, adds the stage settings, and submits exactly what it reviewed', async () => {
    const { sent } = setup('/app/validation/new?from=e-old', {
      previous: run('e-old', 'BACKTEST'),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'New validation' })).toBeVisible();
    expect(await screen.findByText(/Filled in from the/)).toHaveTextContent(
      'The validation runs its own backtest with these settings',
    );
    expect(await screen.findByRole('combobox', { name: 'Strategy' })).toHaveValue('mom');
    expect(field('lookback')).toHaveValue('15');
    await screen.findByText(/120 daily bars/);

    // The stage settings, with the backend's defaults.
    expect(screen.getByRole('region', { name: 'Walk-forward' })).toBeInTheDocument();
    expect(field('Train span (bars)')).toHaveValue('252');
    expect(screen.getByText(/With 120 daily bars in the range: 0 windows/)).toBeInTheDocument();
    type('Train span (bars)', '20');
    type('Validation span (bars)', '20');
    type('Test span (bars)', '20');
    expect(screen.getByText(/With 120 daily bars in the range: 4 windows/)).toBeInTheDocument();
    type('lookback candidates', '10, 20');
    expect(
      screen.getByText(/2 combinations are tried on each validation span/),
    ).toBeInTheDocument();
    const regimes = screen.getByRole('region', { name: 'Regime stress' });
    expect(within(regimes).getByRole('combobox', { name: 'Regime source' })).toHaveValue(
      'rule_based',
    );
    expect(within(regimes).getByRole('option', { name: 'Market regime model' })).toBeEnabled();
    type('Seed', '7');

    fireEvent.click(screen.getByRole('button', { name: /Review validation/ }));
    const review = await screen.findByRole('region', { name: 'Review' });
    expect(review).toHaveTextContent(
      'Walk-forwardTrain 20 + validation 20 + test 20 bars, moving 20 bars per window',
    );
    expect(review).toHaveTextContent('Parameter searchlookback in {10, 20}');
    expect(review).toHaveTextContent(
      'Regime stressRule-based: 200-day trend average, 20-day volatility',
    );
    expect(review).toHaveTextContent('Monte Carlo1,000 simulations, seed 7');
    fireEvent.click(screen.getByRole('button', { name: /Submit validation/ }));

    await screen.findByRole('heading', { name: 'Report v-new' });
    expect(sent()).toEqual([
      {
        strategy_id: 'mom',
        strategy_key: 'momentum',
        instrument_id: RELIANCE.id,
        other_instrument_ids: [],
        timeframe: '1D',
        initial_capital: 50000,
        start_timestamp: '2025-01-01T00:00:00+05:30',
        end_timestamp: '2025-06-30T23:59:59+05:30',
        execution_config: { lookback: 15 },
        quantity: 3,
        slippage_bps: 5,
        brokerage_rate: 0.0003,
        walk_forward: {
          train_bars: 20,
          validation_bars: 20,
          test_bars: 20,
          step_bars: null,
          parameter_grid: { lookback: [10, 20] },
        },
        regimes: { source: 'rule_based', trend_window: 200, volatility_window: 20 },
        monte_carlo: { simulations: 1000, seed: 7 },
        source_execution_id: 'e-old',
      },
    ]);
  });

  it('the market regime model can be the regime source: active model first, overlap warned', async () => {
    const { sent } = setup('/app/validation/new?strategy=mom');
    await fillMomentum();
    const regimes = screen.getByRole('region', { name: 'Regime stress' });
    fireEvent.change(within(regimes).getByRole('combobox', { name: 'Regime source' }), {
      target: { value: 'model' },
    });
    expect(within(regimes).queryByRole('textbox', { name: /Trend average/ })).toBeNull();
    const picker = await within(regimes).findByRole('combobox', { name: 'Regime model' });
    const active = MR_MODELS.find((m) => m.is_active)!;
    await vi.waitFor(() => expect(picker).toHaveValue(active.id));
    expect(within(picker).getAllByRole('option')).toHaveLength(MR_MODELS.length);
    expect(await within(regimes).findByText(/was trained on NIFTY50 from/)).toBeVisible();
    // 2025 is after the model's training period: no warning.
    expect(within(regimes).queryByRole('note')).toBeNull();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2021-01-01' } });
    expect(await within(regimes).findByRole('note')).toHaveTextContent(
      'The dates overlap its training period',
    );
    fireEvent.change(picker, { target: { value: MR_MODEL_GMM.id } });
    expect(
      await within(regimes).findByText(
        /Model 1 \(gmm-regime-v1\) \(Gaussian mixture\) was trained/,
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Review validation/ }));
    const review = await screen.findByRole('region', { name: 'Review' });
    expect(review).toHaveTextContent('Regime stressMarket regime model');
    expect(within(review).getByRole('note')).toHaveTextContent('overlap its training period');
    fireEvent.click(screen.getByRole('button', { name: /Submit validation/ }));
    await screen.findByRole('heading', { name: 'Report v-new' });
    expect(sent()[0]!.regimes).toEqual({
      source: 'model',
      model_id: MR_MODEL_GMM.id,
      trend_window: 200,
      volatility_window: 20,
    });
  });

  it('mistakes in the stage settings are shown before anything is sent', async () => {
    const { sent } = setup('/app/validation/new?strategy=mom');
    await fillMomentum();
    type('lookback candidates', '10, abc');
    type('Simulations', '50');
    fireEvent.click(screen.getByRole('button', { name: /Review validation/ }));
    expect(await screen.findByText('"abc" is not a whole number.')).toBeInTheDocument();
    expect(screen.getByText('Enter 100 to 10,000.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Review' })).toBeNull();
    expect(sent()).toHaveLength(0);
  });

  it('a no-code strategy is validated with its saved rules: nothing to search', async () => {
    const { sent } = setup('/app/validation/new?strategy=rl');
    await fillMomentum();
    expect(
      screen.getByText(/A no-code strategy is validated with its saved rules/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /candidates/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Review validation/ }));
    expect(await screen.findByRole('region', { name: 'Review' })).toHaveTextContent(
      'Parameter searchNone',
    );
    fireEvent.click(screen.getByRole('button', { name: /Submit validation/ }));
    await screen.findByRole('heading', { name: 'Report v-new' });
    expect(sent()[0]).toMatchObject({
      strategy_key: 'no_code_rules',
      execution_config: {},
      walk_forward: { parameter_grid: {} },
      source_execution_id: null,
    });
  });

  it('shows the backend reason when it refuses, and the busy worker', async () => {
    setup('/app/validation/new?strategy=mom', {
      submit: {
        status: 422,
        body: {
          detail:
            'Walk-forward needs at least 5 windows. With 120 daily bars, windows of 252 + 63 + 63 bars, moving 63 bars at a time, give 0.',
        },
      },
    });
    await fillMomentum();
    fireEvent.click(screen.getByRole('button', { name: /Review validation/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Submit validation/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The backend did not accept this validation');
    expect(alert).toHaveTextContent('Walk-forward needs at least 5 windows. With 120 daily bars');
  });

  it('a busy worker (409) says another run is going', async () => {
    setup('/app/validation/new?strategy=mom', {
      submit: {
        status: 409,
        body: {
          detail:
            'Another backtest or validation is running. Wait for it to finish, then submit again.',
        },
      },
    });
    await fillMomentum();
    fireEvent.click(screen.getByRole('button', { name: /Review validation/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Submit validation/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another backtest or validation is running',
    );
  });

  it('edit and rerun of a validation keeps its stage settings and its source', async () => {
    const { sent } = setup('/app/validation/new?from=v-old', {
      previous: run('v-old', 'VALIDATION', {
        walk_forward: {
          train_bars: 40,
          validation_bars: 20,
          test_bars: 20,
          step_bars: 20,
          parameter_grid: { lookback: [5, 10] },
        },
        regimes: { source: 'rule_based', trend_window: 50, volatility_window: 10 },
        monte_carlo: { simulations: 200, seed: 11 },
        source_execution_id: 'e-src',
      }),
    });
    expect(await screen.findByText(/Filled in from the/)).toHaveTextContent('validation created');
    await screen.findByText(/120 daily bars/);
    expect(field('Train span (bars)')).toHaveValue('40');
    expect(field('lookback candidates')).toHaveValue('5, 10');
    expect(field('Trend average (days)')).toHaveValue('50');
    expect(field('Seed')).toHaveValue('11');
    fireEvent.click(screen.getByRole('button', { name: /Review validation/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Submit validation/ }));
    await screen.findByRole('heading', { name: 'Report v-new' });
    expect(sent()[0]).toMatchObject({
      walk_forward: { train_bars: 40, parameter_grid: { lookback: [5, 10] } },
      regimes: { trend_window: 50, volatility_window: 10 },
      monte_carlo: { simulations: 200, seed: 11 },
      source_execution_id: 'e-src',
    });
  });
});
