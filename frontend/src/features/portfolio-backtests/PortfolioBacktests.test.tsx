import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { POLL_MS } from '@/features/backtests/backtest-model';
import { formatDate, formatINR, formatPercent } from '@/lib/format';
import NewPortfolioBacktestPage from './NewPortfolioBacktestPage';
import {
  PB_BACKTESTS,
  PB_CREATED,
  PB_DETAIL,
  PB_FAILED,
  PB_INSTRUMENTS,
  PB_LIST,
  PB_MODEL,
  PB_MODELS,
  PB_REFUSED,
  PB_RESULTS,
  PB_STRATEGIES,
} from './pb-fixture';
import type { Line } from './PortfolioCharts';
import PortfolioBacktestPage from './PortfolioBacktestPage';
import PortfolioBacktestsPage from './PortfolioBacktestsPage';

// jsdom has no canvas; the stand-ins expose exactly what each chart is given.
vi.mock('./PortfolioCharts', async (original) => ({
  ...(await original<typeof import('./PortfolioCharts')>()),
  LinesChart: (p: { lines: Line[]; label: string }) => (
    <div
      role="img"
      aria-label={p.label}
      data-series={p.lines.map((l) => l.key).join(',')}
      data-lines={JSON.stringify(
        p.lines.map((l) => [l.label, l.points.length, l.points.at(-1)?.value]),
      )}
    />
  ),
  WeightsChart: (p: { rows: unknown[]; strategies: { name: string }[]; label: string }) => (
    <div
      role="img"
      aria-label={p.label}
      data-rows={p.rows.length}
      data-names={p.strategies.map((s) => s.name).join(',')}
    />
  ),
}));

type Reply = { status: number; body: unknown };
const respond = ({ status, body }: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const ID = PB_DETAIL.id;

function setup(
  options: {
    path?: string;
    detail?: () => Reply;
    post?: () => Reply;
    list?: unknown[];
  } = {},
) {
  const get = vi.spyOn(api, 'GET').mockImplementation(((
    url: string,
    init?: { params?: { path?: { run_id?: string } } },
  ) => {
    if (url === '/portfolio-backtests')
      return respond({ status: 200, body: options.list ?? PB_LIST });
    if (url === '/portfolio-backtests/{run_id}') {
      const id = init?.params?.path?.run_id;
      if (options.detail) return respond(options.detail());
      if (id === ID) return respond({ status: 200, body: PB_DETAIL });
      if (id === PB_FAILED.id) return respond({ status: 200, body: PB_FAILED });
      return respond({ status: 404, body: { detail: 'Portfolio backtest not found.' } });
    }
    if (url === '/portfolio-backtests/{run_id}/results')
      return respond({ status: 200, body: PB_RESULTS });
    if (url === '/strategies') return respond({ status: 200, body: PB_STRATEGIES });
    if (url === '/executions') return respond({ status: 200, body: PB_BACKTESTS });
    if (url === '/instruments') return respond({ status: 200, body: PB_INSTRUMENTS });
    if (url === '/regime/models') return respond({ status: 200, body: PB_MODELS });
    if (url === '/regime/models/{model_id}') return respond({ status: 200, body: PB_MODEL });
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi
    .spyOn(api, 'POST')
    .mockImplementation((() =>
      respond(options.post?.() ?? { status: 201, body: PB_CREATED })) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Where() {
    const location = useLocation();
    return <div data-testid="where">{location.pathname + location.search}</div>;
  }
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[options.path ?? `/app/portfolio-backtests/${ID}`]}>
          <Routes>
            <Route path="/app/portfolio-backtests" element={<PortfolioBacktestsPage />} />
            <Route path="/app/portfolio-backtests/new" element={<NewPortfolioBacktestPage />} />
            <Route path="/app/portfolio-backtests/:id" element={<PortfolioBacktestPage />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const detailCalls = () =>
    (get.mock.calls as unknown[][]).filter(([url]) => url === '/portfolio-backtests/{run_id}')
      .length;
  return { post, detailCalls };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const R = PB_RESULTS;

describe('PortfolioBacktestPage', () => {
  it('shows the objectives against Nifty 50 from the API, met or not', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 1, name: PB_DETAIL.name })).toBeVisible();
    expect(screen.getByText('Status: Completed. This is final.')).toBeInTheDocument();
    for (const [key, label] of [
      ['sharpe_improvement', 'Sharpe ratio improvement'],
      ['drawdown_reduction', 'Maximum drawdown reduction'],
    ] as const) {
      const box = await screen.findByRole('group', { name: label });
      const o = R.objectives[key];
      expect(box).toHaveTextContent(`${label}: ${o.met ? 'met' : 'not met'}`);
      expect(box).toHaveTextContent(`Result${formatPercent(o.value)}`);
      expect(box).toHaveTextContent(`Targetat least ${formatPercent(o.target)}`);
      expect(box).toHaveTextContent(o.rule);
    }
    // The left-out strategy and the in-sample flag are said.
    expect(screen.getByRole('note', { name: 'Strategies left out' })).toHaveTextContent(
      `${PB_DETAIL.excluded[0]!.name}: ${PB_DETAIL.excluded[0]!.reason}`,
    );
    expect(screen.getByText(R.regime_in_sample!.flag!)).toBeInTheDocument();
    expect(screen.getByText(R.notes[0]!)).toBeInTheDocument();
    expect(R.notes[0]).toMatch(/price index: dividends are not included/);
  });

  it('draws every line, drawdown and the weights exactly as the API gives them', async () => {
    setup();
    const equity = await screen.findByRole('img', {
      name: 'Portfolio value against the benchmarks',
    });
    expect(equity).toHaveAttribute('data-series', 'portfolio,nifty,equal_weight,sixty_forty');
    expect(JSON.parse(equity.getAttribute('data-lines')!)).toEqual([
      ['Portfolio', R.days.length, R.series.portfolio!.at(-1)],
      ['Nifty 50 (buy and hold)', R.days.length, R.series.nifty!.at(-1)],
      ['Equal weight', R.days.length, R.series.equal_weight!.at(-1)],
      ['60/40 Nifty 50 / debt', R.days.length, R.series.sixty_forty!.at(-1)],
    ]);
    const drawdowns = screen.getByRole('img', { name: 'Drawdowns' });
    expect(JSON.parse(drawdowns.getAttribute('data-lines')!)[1]).toEqual([
      'Nifty 50 (buy and hold)',
      R.days.length,
      R.drawdowns.nifty!.at(-1),
    ]);
    const weights = screen.getByRole('img', { name: 'Weights at each rebalance' });
    expect(weights).toHaveAttribute('data-rows', String(R.rebalance_count));
    expect(weights).toHaveAttribute('data-names', R.sleeves.map((s) => s.name).join(','));
  });

  it('lists the metrics of each line and the relative measures', async () => {
    setup();
    const table = await screen.findByRole('table', { name: 'Performance metrics' });
    const sharpe = within(table).getByRole('row', { name: /^Sharpe ratio/ });
    expect(
      within(sharpe)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(
      ['portfolio', 'nifty', 'equal_weight', 'sixty_forty'].map((k) =>
        R.metrics[k]!.sharpe_ratio!.toFixed(2),
      ),
    );
    const final = within(table).getByRole('row', { name: /^Final value/ });
    expect(within(final).getAllByRole('cell')[0]).toHaveTextContent(
      formatINR(R.metrics.portfolio!.final_value),
    );
    const dd = within(table).getByRole('row', { name: /^Maximum drawdown/ });
    expect(within(dd).getAllByRole('cell')[1]).toHaveTextContent(
      formatPercent(R.metrics.nifty!.max_drawdown),
    );
    const relative = screen.getByRole('table', { name: 'Against Nifty 50' });
    expect(within(relative).getByRole('row', { name: /^Beta/ })).toHaveTextContent(
      R.relative.beta!.toFixed(2),
    );
    expect(within(relative).getByRole('row', { name: /^Tracking error/ })).toHaveTextContent(
      formatPercent(R.relative.tracking_error),
    );
  });

  it('logs every rebalance with its regime, weights, cash, cost and why a strategy got nothing', async () => {
    setup();
    const log = await screen.findByRole('table', { name: 'Rebalance log' });
    const entry = R.rebalances[3]!;
    const excluded = entry.strategies.find((s) => s.excluded)!;
    const row = within(log)
      .getAllByRole('row')
      .find((r) => r.textContent?.startsWith(formatDate(entry.day)))!;
    expect(row).toHaveTextContent(entry.regime!.name);
    expect(row).toHaveTextContent(formatPercent(entry.cash_weight));
    expect(row).toHaveTextContent(formatINR(entry.cost));
    expect(row).toHaveTextContent(`${excluded.name}: ${excluded.excluded}`);
    expect(row).toHaveTextContent('Strategies above 50.00% of capital were cut');
    expect(
      screen.getByText(`1-25 of ${R.rebalances.length}`, { exact: false }),
    ).toBeInTheDocument();
  });

  it('links each sleeve to the backtest it came from', async () => {
    setup();
    const table = await screen.findByRole('table', { name: 'Strategies in the portfolio' });
    const first = PB_DETAIL.strategies[0]!;
    const row = within(table).getByRole('row', { name: new RegExp(first.name) });
    expect(within(row).getByRole('link', { name: 'Results' })).toHaveAttribute(
      'href',
      `/app/executions/${first.source_backtest_id}/results`,
    );
    const trades = R.sleeves.find((s) => s.strategy_id === first.strategy_id)!.trades;
    await waitFor(() => expect(row).toHaveTextContent(`${first.symbol}${trades}Results`));
  });

  it('follows a running job, offers cancel, and stops asking at the end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status = 'RUNNING';
    const { post, detailCalls } = setup({
      detail: () => ({
        status: 200,
        body: {
          ...PB_DETAIL,
          status,
          completed_at: status === 'RUNNING' ? null : PB_DETAIL.completed_at,
          headline: null,
        },
      }),
      post: () => ({ status: 200, body: { id: ID, status: 'CANCELLED' } }),
    });
    expect(await screen.findByText(/^Status: Running\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Job' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Performance metrics' })).toBeNull();
    const before = detailCalls();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 50));
    await waitFor(() => expect(detailCalls()).toBeGreaterThan(before));
    fireEvent.click(screen.getByRole('button', { name: /Cancel run/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0] as unknown as unknown[])[0]).toBe(
      '/executions/{execution_id}/cancel',
    );
    status = 'COMPLETED';
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 50));
    expect(await screen.findByText('Status: Completed. This is final.')).toBeInTheDocument();
    const settled = detailCalls();
    await act(() => vi.advanceTimersByTimeAsync(3 * POLL_MS));
    expect(detailCalls()).toBe(settled);
  });

  it('shows why a run failed', async () => {
    setup({ path: `/app/portfolio-backtests/${PB_FAILED.id}` });
    expect(await screen.findByText('Status: Failed. This is final.')).toBeInTheDocument();
    expect(screen.getByText(PB_FAILED.error_message!)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Objectives against Nifty 50' })).toBeNull();
  });

  it("says when a run does not exist or is another user's", async () => {
    setup({ path: '/app/portfolio-backtests/00000000-0000-4000-8000-000000000000' });
    expect(await screen.findByText('Portfolio backtest not available')).toBeInTheDocument();
  });
});

describe('PortfolioBacktestsPage', () => {
  it('lists the runs with their returns and objectives', async () => {
    setup({ path: '/app/portfolio-backtests' });
    const table = await screen.findByRole('table', { name: 'Portfolio backtests' });
    const done = PB_LIST.find((r) => r.status === 'COMPLETED')!;
    const row = within(table).getByRole('row', { name: new RegExp(done.name) });
    expect(row).toHaveTextContent(
      `${formatPercent(done.headline!.portfolio_return)} (${formatPercent(done.headline!.nifty_return)})`,
    );
    expect(row).toHaveTextContent(`Sharpe ${done.headline!.sharpe_met ? 'met' : 'not met'}`);
    expect(within(row).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      `/app/portfolio-backtests/${done.id}`,
    );
    expect(screen.getByText('2 portfolio backtests.')).toBeInTheDocument();
  });

  it('invites a first run when there is none', async () => {
    setup({ path: '/app/portfolio-backtests', list: [] });
    expect(await screen.findByText('No portfolio backtests yet')).toBeInTheDocument();
  });
});

describe('NewPortfolioBacktestPage', () => {
  const choose = async (name: string) =>
    fireEvent.click(await screen.findByRole('checkbox', { name: new RegExp(name) }));

  it('preselects Nifty 50 and the active model, then submits what was reviewed', async () => {
    const { post } = setup({ path: '/app/portfolio-backtests/new' });
    const nifty = PB_INSTRUMENTS.find((i) => i.symbol === 'NIFTY50')!;
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Benchmark' })).toHaveValue(nifty.id),
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Regime model' })).toHaveValue(PB_MODELS[0]!.id),
    );
    // Each strategy says which backtest it would use.
    expect(await screen.findByText(/Latest backtest: Momentum on RELIANCE/)).toBeInTheDocument();
    expect(screen.getByText('No completed backtest yet: it will be left out.')).toBeInTheDocument();
    await choose('Momentum RELIANCE');
    await choose('Mean reversion INFY');
    fireEvent.change(screen.getByLabelText('From', { exact: true }), {
      target: { value: '2023-01-02' },
    });
    fireEvent.change(screen.getByLabelText('To', { exact: true }), {
      target: { value: '2024-09-30' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Cash reserve (%)' }), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review portfolio backtest' }));
    const review = await screen.findByRole('region', { name: 'Review' });
    expect(review).toHaveTextContent('NIFTY50 (price index, buy and hold), and equal weight');
    expect(review).toHaveTextContent('Cash reserve 5.00%');
    expect(review).toHaveTextContent('On: Model 1');
    fireEvent.click(screen.getByRole('button', { name: /Submit portfolio backtest/ }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        `/app/portfolio-backtests/${PB_CREATED.id}`,
      ),
    );
    const [url, init] = post.mock.calls[0] as unknown as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(url).toBe('/portfolio-backtests');
    expect(init.body).toMatchObject({
      strategy_ids: [PB_STRATEGIES[0]!.id, PB_STRATEGIES[1]!.id],
      benchmark_instrument_id: nifty.id,
      start_date: '2023-01-02',
      end_date: '2024-09-30',
      frequency: 'WEEKLY',
      limits: { cash_reserve: 0.05, max_strategy_weight: 1, max_asset_weight: 1 },
      regime_filter: true,
      regime_model_id: PB_MODELS[0]!.id,
    });
  });

  it('marks what is missing and shows the backend refusal', async () => {
    setup({
      path: '/app/portfolio-backtests/new',
      post: () => ({ status: 422, body: PB_REFUSED }),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Review portfolio backtest' }));
    expect(await screen.findByText('Choose at least one strategy.')).toBeInTheDocument();
    await choose('Not backtested yet');
    fireEvent.click(screen.getByRole('button', { name: 'Review portfolio backtest' }));
    fireEvent.click(await screen.findByRole('button', { name: /Submit portfolio backtest/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The backend did not accept this portfolio backtest');
    expect(alert).toHaveTextContent(PB_REFUSED.detail);
  });

  it('fills the form in from an earlier run', async () => {
    setup({ path: `/app/portfolio-backtests/new?from=${ID}` });
    expect(await screen.findByText(/Filled in from the/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(PB_DETAIL.name);
    for (const s of PB_DETAIL.strategies)
      expect(screen.getByRole('checkbox', { name: new RegExp(s.name) })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Most per strategy (%)' })).toHaveValue('50');
    expect(screen.getByRole('switch', { name: 'Also compare with 60/40' })).toBeChecked();
  });
});
