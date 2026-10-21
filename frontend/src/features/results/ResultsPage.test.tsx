import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import type { Bar } from '@/features/instruments/market-data';
import type { TradeMarker } from '@/features/instruments/PriceChart';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatINR, formatNumber, formatPercent } from '@/lib/format';
import { SEEDED_NO_TRADES, SEEDED_TRADES } from './results-fixture';
import {
  metricText,
  metricValue,
  SUMMARY_METRICS,
  TRADE_METRICS,
  type ChartPoint,
  type ExecutionResults,
} from './results-model';
import ResultsPage from './ResultsPage';

// jsdom has no canvas; the stand-ins expose exactly what the page gives each chart.
vi.mock('./ResultsCharts', () => ({
  EquityChart: (p: { strategy: ChartPoint[]; benchmark: ChartPoint[] | null; label: string }) => (
    <div
      role="img"
      aria-label={p.label}
      data-testid="equity"
      data-strategy={JSON.stringify(p.strategy)}
      data-benchmark={JSON.stringify(p.benchmark)}
    />
  ),
  DrawdownChart: (p: { points: ChartPoint[]; label: string }) => (
    <div
      role="img"
      aria-label={p.label}
      data-testid="drawdown"
      data-points={JSON.stringify(p.points)}
    />
  ),
  MonthlyReturnsChart: (p: { months: unknown[]; label: string }) => (
    <div
      role="img"
      aria-label={p.label}
      data-testid="monthly"
      data-months={JSON.stringify(p.months)}
    />
  ),
}));
vi.mock('@/features/instruments/PriceChart', () => ({
  PriceChart: (p: { bars: Bar[]; markers?: TradeMarker[]; label: string }) => (
    <div
      role="img"
      aria-label={p.label}
      data-testid="price"
      data-bars={p.bars.length}
      data-markers={JSON.stringify(p.markers ?? [])}
    />
  ),
}));
vi.mock('@/lib/csv', async (original) => ({
  ...(await original<typeof import('@/lib/csv')>()),
  downloadCsv: vi.fn(),
}));

type Reply = { status: number; body: unknown };
const ok = (body: unknown): Reply => ({ status: 200, body });
const respond = ({ status, body }: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

const RELIANCE = INSTRUMENTS_FIXTURE[0]!;

const execution = (results: ExecutionResults, status = 'COMPLETED') => ({
  id: results.execution_id,
  strategy_id: results.configuration.strategy_id,
  broker_account_id: null,
  instrument_id: RELIANCE.id,
  execution_type: 'BACKTEST',
  status,
  timeframe: '1D',
  initial_capital: results.summary.initial_capital,
  execution_config: {},
  execution_metrics: null,
  run_settings: {},
  error_message: null,
  error: null,
  started_at: '2026-10-16T09:00:02Z',
  completed_at: status === 'COMPLETED' ? '2026-10-16T09:00:09Z' : null,
  created_at: '2026-10-16T09:00:00Z',
  updated_at: '2026-10-16T09:00:00Z',
});

const BARS = SEEDED_TRADES.equity_curve.map((p, i) => ({
  timestamp: p.timestamp,
  open: 100,
  high: 121,
  low: 89,
  close: [100, 110, 90, 120][i]!,
  volume: 1000,
}));

function setup(options: {
  results?: ExecutionResults;
  reply?: Reply;
  status?: string;
  path?: string;
}) {
  const results = options.results ?? SEEDED_TRADES;
  const get = vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/executions/{execution_id}')
      return respond(ok(execution(results, options.status)));
    if (url === '/executions/{execution_id}/results') return respond(options.reply ?? ok(results));
    if (url === '/instruments') return respond(ok(INSTRUMENTS_FIXTURE));
    if (url === '/indicators') return respond(ok([]));
    if (url === '/instruments/{instrument_id}/market-data') return respond(ok(BARS));
    // Phase 15: the Records tab asks whether the run's trading records are stored.
    if (url === '/executions/{execution_id}/records')
      return respond(
        ok({
          execution_id: results.execution_id,
          stored: false,
          orders: 0,
          trades: 0,
          positions: 0,
        }),
      );
    if (url === '/executions' || url === '/strategies') return respond(ok([]));
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Where() {
    const location = useLocation();
    return <div data-testid="where">{location.pathname + location.search}</div>;
  }
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter
          initialEntries={[options.path ?? `/app/executions/${results.execution_id}/results`]}
        >
          <Routes>
            <Route path="/app/executions/:id/results" element={<ResultsPage />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const calls = (path: string) =>
    (get.mock.calls as unknown[][]).filter(([url]) => url === path).length;
  return { get, calls };
}

const tile = (label: string) => screen.getByRole('group', { name: label });
const openTab = async (name: string) => {
  // Radix tabs switch on mouse down (keyboard: arrows), not on click.
  fireEvent.mouseDown(await screen.findByRole('tab', { name }), { button: 0 });
  return screen.findByRole('tabpanel', { name });
};

// Radix positions tooltips with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(downloadCsv).mockClear();
});

describe('ResultsPage: seeded result with trades', () => {
  it('header: historical-simulation label, run facts, and only real actions', async () => {
    setup({});
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Backtest results' }),
    ).toBeVisible();
    expect(screen.getByText('Historical simulation')).toBeInTheDocument();
    expect(await screen.findByText(/Momentum \u00b7 RELIANCE/)).toHaveTextContent(
      'Nifty momentum \u00b7 Momentum \u00b7 RELIANCE \u00b7 06 Jan 2025 to 09 Jan 2025 \u00b7 4 daily bars',
    );
    const actions = screen.getByRole('group', { name: 'Actions' });
    expect(within(actions).getByRole('link', { name: /Re-run with changes/ })).toHaveAttribute(
      'href',
      `/app/backtests/new?from=${SEEDED_TRADES.execution_id}`,
    );
    // Phase 11: validation starts from this run.
    expect(within(actions).getByRole('link', { name: /Validate this strategy/ })).toHaveAttribute(
      'href',
      `/app/validation/new?from=${SEEDED_TRADES.execution_id}`,
    );
    expect(within(actions).getByRole('button', { name: /Use in portfolio/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The strategy has changed since this run (it is now v2). These results are for v1.',
    );
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Summary',
      'Charts',
      'Trades',
      'Records',
      'Configuration',
    ]);
  });

  it('summary: every number equals the API value; final capital = last equity point', async () => {
    setup({});
    await screen.findByRole('heading', { name: 'Return and risk' });
    for (const metric of [...SUMMARY_METRICS, ...TRADE_METRICS]) {
      const value = metricValue(SEEDED_TRADES, metric);
      const shown = within(tile(metric.label)).getByText(metricText(metric.format, value));
      expect(shown, metric.key).toHaveAttribute('data-metric', metric.key);
    }
    const last = SEEDED_TRADES.equity_curve[SEEDED_TRADES.equity_curve.length - 1]!;
    expect(SEEDED_TRADES.summary.final_capital).toBe(last.portfolio_value);
    expect(tile('Final capital')).toHaveTextContent(formatINR(last.portfolio_value));
    // Spelled out for a few, so a formatting change cannot hide a wrong number.
    expect(tile('Net profit')).toHaveTextContent(formatINR(-400.84));
    expect(tile('Total return')).toHaveTextContent('-4.01%');
    expect(tile('Sharpe ratio')).toHaveTextContent('-10.35');
    expect(tile('Sortino ratio')).toHaveTextContent('-10.25');
    expect(tile('Calmar ratio')).toHaveTextContent('-20.04');
    expect(tile('Max drawdown')).toHaveTextContent('4.96%');
    expect(tile('Max drawdown')).toHaveTextContent('Peak 07 Jan 2025, low 09 Jan 2025');
    expect(tile('Max drawdown duration')).toHaveTextContent('2 bars');
    expect(tile('Win rate')).toHaveTextContent('0.00%');
    expect(tile('Average loss')).toHaveTextContent(formatINR(-100.57));
    expect(tile('Total charges')).toHaveTextContent(formatINR(0.84));
    // A null metric: an em dash and the backend's reason.
    expect(tile('Average gain')).toHaveTextContent('\u2014');
    expect(tile('Average gain')).toHaveTextContent('No closed trade made a profit.');
    expect(screen.getByRole('group', { name: 'Buy and hold return' })).toHaveTextContent('20.00%');
  });

  it('every metric explains itself with its definition and basis', async () => {
    setup({});
    await screen.findByRole('heading', { name: 'Return and risk' });
    for (const metric of [...SUMMARY_METRICS, ...TRADE_METRICS]) {
      expect(screen.getByRole('button', { name: `About ${metric.label}` })).toBeInTheDocument();
    }
    act(() => screen.getByRole('button', { name: 'About Sharpe ratio' }).focus());
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('standard deviation of excess returns');
    expect(tip).toHaveTextContent('252 bars a year');
    expect(tip).toHaveTextContent('Risk-free rate 6.50% a year');
    const how = screen.getByText('How these are calculated').closest('details')!;
    expect(how).toHaveTextContent('Sortino ratio');
    expect(how).toHaveTextContent('365.2425-day years');
  });

  it('charts get the API series: equity vs buy-and-hold, drawdown, months, fills on prices', async () => {
    setup({});
    const panel = await openTab('Charts');
    const equity = within(panel).getByTestId('equity');
    const strategy = JSON.parse(equity.dataset.strategy!) as ChartPoint[];
    expect(strategy.map((p) => p.value)).toEqual(
      SEEDED_TRADES.equity_curve.map((p) => p.portfolio_value),
    );
    expect(strategy[strategy.length - 1]!.value).toBe(SEEDED_TRADES.summary.final_capital);
    expect((JSON.parse(equity.dataset.benchmark!) as ChartPoint[]).map((p) => p.value)).toEqual(
      SEEDED_TRADES.benchmark!.equity_curve.map((p) => p.portfolio_value),
    );
    expect(equity).toHaveAccessibleName(/with Buy and hold RELIANCE/);
    const drawdown = JSON.parse(
      within(panel).getByTestId('drawdown').dataset.points!,
    ) as ChartPoint[];
    expect(drawdown.map((p) => p.value)).toEqual(SEEDED_TRADES.equity_curve.map((p) => p.drawdown));
    const months = within(panel).getByRole('table', { name: 'Monthly returns' });
    expect(within(months).getAllByRole('row')[1]).toHaveTextContent(
      `2025${formatPercent(SEEDED_TRADES.monthly_returns[0]!.value)}`,
    );
    const price = await within(panel).findByTestId('price');
    expect(price.dataset.bars).toBe('4');
    expect(JSON.parse(price.dataset.markers!)).toEqual([
      { time: '2025-01-06', side: 'BUY', text: 'BUY 10' },
      { time: '2025-01-08', side: 'SELL', text: 'SELL 20' },
    ]);
    expect(within(panel).getByText(/1 BUY and 1 SELL fills/)).toBeInTheDocument();
  });

  it('trades: the log shows the API values and exports the displayed rows as CSV', async () => {
    setup({});
    const panel = await openTab('Trades');
    const table = within(panel).getByRole('table', { name: 'Trade log' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const [closed, open] = SEEDED_TRADES.round_trips;
    expect(rows[1]).toHaveTextContent(
      [
        '1',
        'RELIANCE',
        'Long',
        '10',
        formatDate('2025-01-06'),
        formatNumber(closed!.entry_price),
        formatDate('2025-01-08'),
        formatNumber(closed!.exit_price),
        formatINR(closed!.gross_pnl),
        formatINR(closed!.charges),
        formatINR(closed!.net_pnl),
        formatPercent(closed!.return),
      ].join(''),
    );
    expect(rows[2]).toHaveTextContent('Short');
    expect(rows[2]).toHaveTextContent('Still open');
    expect(rows[2]).toHaveTextContent(formatINR(open!.net_pnl));

    fireEvent.click(within(panel).getByRole('button', { name: /Export CSV/ }));
    const [name, text] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(name).toBe('backtest-e0000000-trades.csv');
    expect(text.split('\r\n')).toEqual([
      'trade,Instrument,direction,Quantity,entry_time,Entry price,exit_time,Exit price,Gross P&L,Charges,Net P&L,Return',
      `1,RELIANCE,LONG,10,${closed!.entry_timestamp},100,${closed!.exit_timestamp},90,-100,${closed!.charges},${closed!.net_pnl},${closed!.return}`,
      `2,RELIANCE,SHORT,10,${open!.entry_timestamp},90,,,${open!.gross_pnl},${open!.charges},${open!.net_pnl},${open!.return}`,
      '',
    ]);

    // Only what is displayed: search, then export again.
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Search trades' }), {
      target: { value: 'short' },
    });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(within(panel).getByRole('button', { name: /Export CSV/ }));
    const filtered = vi.mocked(downloadCsv).mock.calls[1]![1].trim().split('\r\n');
    expect(filtered).toHaveLength(2);
    expect(filtered[1]).toMatch(/^2,RELIANCE,SHORT,/);
  });

  it('records: simulated orders, fills, end positions and cash, labelled as simulated', async () => {
    setup({});
    const panel = await openTab('Records');
    expect(within(panel).getByText(/no real orders/)).toBeInTheDocument();
    expect(panel).toHaveTextContent('No order was sent to a broker');
    const orders = within(panel).getByRole('table', { name: 'Simulated orders' });
    expect(within(orders).getAllByRole('row')[2]).toHaveTextContent(
      `${formatDate('2025-01-08')}RELIANCESELLMarket20Filled90.0090.00`,
    );
    const fills = within(panel).getByRole('table', { name: 'Simulated fills' });
    expect(within(fills).getAllByRole('row')[2]).toHaveTextContent(
      `${formatDate('2025-01-08')}RELIANCESELL2090.00${formatINR(0.54)}${formatINR(0.54)}${formatINR(-100)}10 / 10`,
    );
    const positions = within(panel).getByRole('table', { name: 'Positions at the end' });
    expect(within(positions).getAllByRole('row')[1]).toHaveTextContent(
      `RELIANCEShort1090.00120.00${formatINR(-1200)}${formatINR(-300)}`,
    );
    expect(panel).toHaveTextContent(
      `Cash at the end: ${formatINR(SEEDED_TRADES.records.ending_cash)}`,
    );
    // Phase 15: the stored trading records of this run (here: not stored yet).
    const stored = within(panel).getByRole('region', { name: 'Trading records' });
    expect(await within(stored).findByRole('button', { name: 'Store records' })).toBeEnabled();
  });

  it('configuration and provenance show what the backend recorded', async () => {
    setup({});
    const panel = await openTab('Configuration');
    const config = within(panel).getByRole('region', { name: 'Configuration' });
    expect(config).toHaveTextContent('Strategy versionv1 at the run, v2 now');
    expect(config).toHaveTextContent('Engine version1.1');
    expect(config).toHaveTextContent('lookback = 2');
    expect(config).toHaveTextContent('Bars used4 daily bars, 06 Jan 2025 to 09 Jan 2025');
    expect(config).toHaveTextContent(`Initial capital${formatINR(10000)}`);
    expect(config).toHaveTextContent('Slippage5.00 bps');
    expect(config).toHaveTextContent('Brokerage0.0300% of trade value');
    const provenance = within(panel).getByRole('region', { name: 'Data provenance' });
    const dataset = SEEDED_TRADES.provenance.datasets[0]!;
    expect(provenance).toHaveTextContent('ProviderYahoo Finance');
    expect(provenance).toHaveTextContent('FrequencyDaily (1D)');
    expect(provenance).toHaveTextContent('Requested dates (UTC)05 Jan 2025 to 09 Jan 2025');
    expect(provenance).toHaveTextContent('Rows4');
    expect(provenance).toHaveTextContent('Cache hitNo');
    expect(provenance).toHaveTextContent(`Data fingerprint${dataset.data_fingerprint}`);
    expect(provenance).toHaveTextContent('Acquired at16 Oct 2026, 21:45 IST');
  });

  it('a no-code run shows the rules it ran with', async () => {
    setup({
      results: {
        ...SEEDED_TRADES,
        configuration: {
          ...SEEDED_TRADES.configuration,
          strategy_key: 'no_code_rules',
          parameters: {},
          rules: {
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
          },
        },
      },
    });
    const panel = await openTab('Configuration');
    const config = within(panel).getByRole('region', { name: 'Configuration' });
    expect(config).toHaveTextContent('TemplateNo-code rules');
    expect(config).toHaveTextContent('Rules (at the run)Indicators: sma3 = SMA(window 3).');
    expect(config).toHaveTextContent('Buy when close > sma3.');
    expect(config).toHaveTextContent('No exit conditions: the position is held to the end.');
    expect(config).not.toHaveTextContent('Template defaults');
  });

  it('the tab lives in the address', async () => {
    setup({ path: `/app/executions/${SEEDED_TRADES.execution_id}/results?tab=configuration` });
    expect(await screen.findByRole('tabpanel', { name: 'Configuration' })).toBeVisible();
    await openTab('Charts');
    expect(screen.getByTestId('where')).toHaveTextContent(/\?tab=charts$/);
    await openTab('Summary');
    expect(screen.getByTestId('where')).toHaveTextContent(/\/results$/);
  });
});

describe('ResultsPage: seeded result without trades', () => {
  it('is a valid result: zeros where defined, reasons where not, no error', async () => {
    setup({ results: SEEDED_NO_TRADES });
    await screen.findByRole('heading', { name: 'Return and risk' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The strategy made no trades in this run. That is a valid result',
    );
    for (const metric of [...SUMMARY_METRICS, ...TRADE_METRICS]) {
      const value = metricValue(SEEDED_NO_TRADES, metric);
      expect(within(tile(metric.label)).getByText(metricText(metric.format, value))).toBeVisible();
      if (value === null)
        expect(tile(metric.label), metric.key).toHaveTextContent(
          SEEDED_NO_TRADES.null_reasons[metric.key]!,
        );
    }
    expect(tile('Final capital')).toHaveTextContent(formatINR(5000));
    expect(tile('Sharpe ratio')).toHaveTextContent(
      'Returns did not vary, so the ratio is not defined.',
    );
    expect(tile('Win rate')).toHaveTextContent('The strategy made no trades.');

    const trades = await openTab('Trades');
    expect(within(trades).getByText('No trades')).toBeVisible();
    expect(within(trades).queryByRole('table')).toBeNull();

    const config = await openTab('Configuration');
    expect(config).toHaveTextContent(
      'Strategy version\u2014Not recorded for runs made before results were added (Phase 10).',
    );
    expect(config).toHaveTextContent('Engine version\u2014Not recorded');
    expect(within(config).getByRole('region', { name: 'Data provenance' })).toHaveTextContent(
      'did not record where its data came from',
    );
  });
});

describe('ResultsPage: other states', () => {
  it('a failed load is an error with a retry, not "no trades"', async () => {
    setup({ reply: { status: 500, body: { detail: 'Database unavailable.' } } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(within(alert).getByRole('button', { name: /Try again/ })).toBeInTheDocument();
    expect(screen.queryByText(/made no trades/)).toBeNull();
  });

  it('a run without a stored result says so (409)', async () => {
    setup({ reply: { status: 409, body: { detail: 'This run has no stored result.' } } });
    expect(await screen.findByRole('alert')).toHaveTextContent('This run has no stored result.');
  });

  it('a running backtest has no results yet and they are not asked for', async () => {
    const { calls } = setup({ status: 'RUNNING' });
    expect(await screen.findByText(/Results appear here when it completes/)).toBeVisible();
    expect(calls('/executions/{execution_id}/results')).toBe(0);
  });

  it('a failed backtest has no results', async () => {
    const { calls } = setup({ status: 'FAILED' });
    expect(await screen.findByText(/ended failed, so it has no results/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'See why it failed' })).toHaveAttribute(
      'href',
      `/app/backtests/${SEEDED_TRADES.execution_id}`,
    );
    await waitFor(() => expect(calls('/executions/{execution_id}')).toBeGreaterThan(0));
    expect(calls('/executions/{execution_id}/results')).toBe(0);
  });

  it('another user\'s run is "not available"', async () => {
    vi.spyOn(api, 'GET').mockImplementation((() =>
      respond({ status: 404, body: { detail: 'Execution not found.' } })) as never);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/app/executions/x/results']}>
          <Routes>
            <Route path="/app/executions/:id/results" element={<ResultsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Results not available')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Backtest results' })).toBeVisible();
  });
});
