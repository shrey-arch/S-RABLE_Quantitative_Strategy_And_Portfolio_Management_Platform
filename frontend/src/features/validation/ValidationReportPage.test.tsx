import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { POLL_MS } from '@/features/backtests/backtest-model';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import {
  DEPLOY_CAPITAL_REFUSED,
  DEPLOY_STAGE5_DONE,
  DEPLOY_STAGE5_READY,
  DEPLOY_STAGE5_RUNNING,
  DEPLOY_STAGE5_STARTED,
} from '@/features/paper/deploy-fixture';
import type { ChartPoint } from '@/features/results/results-model';
import { formatINR, formatNumber, formatPercent } from '@/lib/format';
import { MR_REPORT_GMM, MR_REPORT_SUP } from './model-regime-fixture';
import { VALIDATION_REPORT, VALIDATION_SUMMARY } from './validation-fixture';
import { ruleText, unitText, type RegimePeriod, type ValidationReport } from './validation-model';
import ValidationHistoryPage from './ValidationHistoryPage';
import ValidationReportPage from './ValidationReportPage';

// jsdom has no canvas; the stand-ins expose exactly what each chart is given.
vi.mock('@/features/results/ResultsCharts', () => ({
  EquityChart: (p: { strategy: ChartPoint[]; label: string }) => (
    <div role="img" aria-label={p.label} data-points={p.strategy.length} />
  ),
}));
vi.mock('./ValidationCharts', async (original) => ({
  ...(await original<typeof import('./ValidationCharts')>()),
  RegimeEquityChart: (p: { equity: ChartPoint[]; periods: RegimePeriod[]; label: string }) => (
    <div
      role="img"
      aria-label={p.label}
      data-points={p.equity.length}
      data-periods={JSON.stringify(p.periods)}
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

const ID = VALIDATION_REPORT.id;

function setup(
  options: { reports?: () => Reply; path?: string; list?: unknown[]; post?: () => Reply } = {},
) {
  const get = vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/validations/{execution_id}')
      return respond(options.reports?.() ?? { status: 200, body: VALIDATION_REPORT });
    if (url === '/validations')
      return respond({ status: 200, body: options.list ?? [VALIDATION_SUMMARY] });
    if (url === '/instruments') return respond({ status: 200, body: INSTRUMENTS_FIXTURE });
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi
    .spyOn(api, 'POST')
    .mockImplementation((() =>
      respond(
        options.post?.() ?? { status: 200, body: { id: ID, status: 'CANCELLED' } },
      )) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Where() {
    const location = useLocation();
    return <div data-testid="where">{location.pathname + location.search}</div>;
  }
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[options.path ?? `/app/validation/${ID}`]}>
          <Routes>
            <Route path="/app/validation" element={<ValidationHistoryPage />} />
            <Route path="/app/validation/:id" element={<ValidationReportPage />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const calls = () =>
    (get.mock.calls as unknown[][]).filter(([url]) => url === '/validations/{execution_id}').length;
  return { calls, post };
}

const openTab = async (name: string) => {
  fireEvent.mouseDown(await screen.findByRole('tab', { name }), { button: 0 });
  return screen.findByRole('tabpanel', { name });
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const R = VALIDATION_REPORT;
const S = R.stages;

describe('ValidationReportPage', () => {
  it('shows the pipeline, each stage status and the overall verdict from the API', async () => {
    setup();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Validation report' }),
    ).toBeVisible();
    // The heading is there while loading too; the pipeline only once the report is in.
    const pipeline = await screen.findByRole('navigation', { name: 'Validation pipeline' });
    expect(screen.getByText('Historical simulation')).toBeInTheDocument();
    expect(
      within(pipeline)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Stage 1, Backtest: Fail',
      'Stage 2, Walk-forward: Pass',
      'Stage 3, Regime stress: Pass',
      'Stage 4, Monte Carlo: Pass',
      'Stage 5, Paper trading: Not run',
    ]);
    const verdict = screen.getByRole('group', { name: 'Overall verdict' });
    expect(verdict).toHaveTextContent('Overall: Failed');
    expect(verdict).toHaveTextContent(R.verdict.reason);
    expect(verdict).toHaveTextContent(R.thresholds_source);
    expect(await screen.findByText(/RELIANCE/)).toHaveTextContent('Nifty momentum');
    expect(screen.getByText('Status: Completed. This is final.')).toBeInTheDocument();
    // Finished: no cancel, and the run can be repeated with changes.
    expect(screen.queryByRole('button', { name: /Cancel validation/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Edit and rerun/ })).toHaveAttribute(
      'href',
      `/app/validation/new?from=${ID}`,
    );
  });

  it('every check shows the backend rule, value and result; the UI decides nothing', async () => {
    setup();
    for (const [tab, stage] of [
      ['Backtest', S.backtest],
      ['Walk-forward', S.walk_forward],
      ['Regime stress', S.regime_stress],
      ['Monte Carlo', S.monte_carlo],
    ] as const) {
      const panel = await openTab(tab);
      const table = within(panel).getByRole('table', { name: `${stage.name} checks` });
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(stage.checks.length);
      stage.checks.forEach((check, i) => {
        expect(rows[i]).toHaveTextContent(check.label);
        expect(rows[i]).toHaveTextContent(ruleText(check));
        expect(rows[i]).toHaveTextContent(unitText(check.unit, check.value));
        expect(rows[i]).toHaveTextContent(check.passed ? 'Pass' : 'Fail');
      });
      expect(
        within(panel).getByRole('region', { name: `${stage.name}: verdict` }),
      ).toHaveTextContent(stage.reason!);
    }
  });

  it('backtest: the metrics and years the backend computed', async () => {
    setup();
    const panel = await openTab('Backtest');
    const m = S.backtest.metrics!;
    expect(within(panel).getByRole('group', { name: 'Final capital' })).toHaveTextContent(
      formatINR(m.final_capital),
    );
    expect(within(panel).getByRole('group', { name: 'Sharpe ratio' })).toHaveTextContent(
      formatNumber(m.sharpe_ratio, 2),
    );
    expect(within(panel).getByRole('group', { name: 'Max drawdown' })).toHaveTextContent(
      formatPercent(m.max_drawdown),
    );
    expect(within(panel).getByRole('img', { name: /Equity curve/ })).toHaveAttribute(
      'data-points',
      String(S.backtest.equity_curve.length),
    );
    const years = within(panel).getByRole('table', { name: 'Return of each calendar year' });
    expect(within(years).getAllByRole('row')).toHaveLength(S.backtest.yearly_returns.length + 1);
  });

  it('walk-forward: windows, timeline, in-sample against out-of-sample, stability', async () => {
    setup();
    const panel = await openTab('Walk-forward');
    const windows = S.walk_forward.windows;
    const table = within(panel).getByRole('table', { name: 'Walk-forward windows' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(windows.length);
    expect(rows[0]).toHaveTextContent(`lookback = ${String(windows[0]!.parameters.lookback)}`);
    expect(rows[0]).toHaveTextContent(formatPercent(windows[0]!.in_sample.annualized_mean_return));
    expect(rows[0]).toHaveTextContent(
      formatPercent(windows[0]!.out_of_sample.annualized_mean_return),
    );
    expect(within(panel).getByRole('img', { name: /Walk-forward windows/ })).toHaveAttribute(
      'data-windows',
      String(windows.length),
    );
    const bars = within(panel).getByRole('img', { name: /Annualised mean return by window/ });
    expect(bars).toHaveAttribute('data-categories', String(windows.length));
    expect(bars).toHaveAttribute('data-series', 'In-sample return|Out-of-sample return');
    expect(within(panel).getByRole('img', { name: /Sharpe ratio by window/ })).toBeInTheDocument();
    const summary = S.walk_forward.summary!;
    expect(within(panel).getByRole('group', { name: 'Retention' })).toHaveTextContent(
      formatPercent(summary.retention),
    );
    const stability = within(panel).getByRole('table', {
      name: 'How often each parameter value was chosen',
    });
    expect(within(stability).getAllByRole('row')).toHaveLength(
      summary.parameter_stability.length + 1,
    );
  });

  it('regime stress: one row per regime, the method, and shaded periods', async () => {
    setup();
    const panel = await openTab('Regime stress');
    const table = within(panel).getByRole('table', { name: 'Performance by regime' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.firstChild?.textContent)).toEqual(
      S.regime_stress.regimes.map((r) => r.name),
    );
    const first = S.regime_stress.regimes[0]!;
    expect(rows[0]).toHaveTextContent(formatNumber(first.days, 0));
    expect(rows[0]).toHaveTextContent(formatPercent(first.max_drawdown));
    expect(panel).toHaveTextContent(S.regime_stress.method!.method);
    const chart = within(panel).getByRole('img', { name: /regime periods shaded/ });
    expect(JSON.parse(chart.getAttribute('data-periods')!)).toEqual(S.regime_stress.periods);
    expect(
      within(panel).getByRole('img', { name: 'Return and maximum drawdown by regime' }),
    ).toBeInTheDocument();
  });

  it('regime stress with a supervised regime model: the model, in-sample flag, dimensions and unclassified days', async () => {
    const r = MR_REPORT_SUP;
    const stage = r.stages.regime_stress;
    const model = stage.method!.model!;
    setup({
      reports: () => ({ status: 200, body: r }),
      path: `/app/validation/${r.id}?tab=regime_stress`,
    });
    const panel = await screen.findByRole('tabpanel', { name: 'Regime stress' });
    expect(panel).toHaveTextContent(stage.method!.method);
    expect(
      within(panel).getByRole('link', { name: `${model.name} (${model.version})` }),
    ).toHaveAttribute('href', `/app/regime?tab=model&model=${model.id}`);
    expect(within(panel).getByRole('note')).toHaveTextContent(stage.in_sample!.flag!);
    const combined = within(panel).getByRole('table', { name: 'Performance by regime' });
    expect(within(combined).getAllByRole('row')).toHaveLength(stage.regimes.length + 1);
    expect(combined).toHaveTextContent('Shown only (judged by dimension)');
    for (const d of stage.dimensions!) {
      const table = within(panel).getByRole('table', {
        name: `Performance by ${d.name.toLowerCase()}`,
      });
      const rows = within(table).getAllByRole('row').slice(1);
      d.rows.forEach((row, i) => {
        expect(rows[i]).toHaveTextContent(`${row.name}${formatNumber(row.days, 0)}`);
        expect(rows[i]).toHaveTextContent(
          row.days === 0 ? 'Not observed' : row.judged ? 'Judged' : 'Insufficient data',
        );
      });
    }
    const reasons = within(panel).getByRole('list', { name: 'Unclassified days' });
    for (const reason of stage.unclassified!.reasons)
      expect(reasons).toHaveTextContent(
        `${formatNumber(reason.days, 0)} days: ${reason.description}`,
      );
    const chart = within(panel).getByRole('img', { name: /regime periods shaded/ });
    expect(JSON.parse(chart.getAttribute('data-periods')!)).toEqual(stage.periods);
    const config = await openTab('Configuration');
    expect(config).toHaveTextContent(
      `RegimesMarket regime model: ${model.name} (${model.version}), ${model.kind_name}, on NIFTY50`,
    );
  });

  it('regime stress with a Gaussian mixture: clusters judged, days without a reference bar listed', async () => {
    const stage = MR_REPORT_GMM.stages.regime_stress;
    setup({
      reports: () => ({ status: 200, body: MR_REPORT_GMM }),
      path: `/app/validation/${MR_REPORT_GMM.id}?tab=regime_stress`,
    });
    const panel = await screen.findByRole('tabpanel', { name: 'Regime stress' });
    const table = within(panel).getByRole('table', { name: 'Performance by regime' });
    const rows = within(table).getAllByRole('row').slice(1);
    stage.regimes.forEach((row, i) => {
      expect(rows[i]).toHaveTextContent(`${row.code}${row.name}`);
      expect(rows[i]).toHaveTextContent(formatPercent(row.share));
    });
    expect(within(panel).queryByRole('table', { name: /Performance by volatility/ })).toBeNull();
    expect(within(panel).getByRole('list', { name: 'Unclassified days' })).toHaveTextContent(
      '3 days: The reference instrument has no stored bar on that day.',
    );
    expect(panel).toHaveTextContent('No observed regime has fewer than 20 days.');
  });

  it('Monte Carlo: seed, simulations, percentiles, histograms and the test', async () => {
    setup();
    const panel = await openTab('Monte Carlo');
    const b = S.monte_carlo.bootstrap!;
    const s = S.monte_carlo.significance!;
    expect(panel).toHaveTextContent(`200 simulations of ${b.periods} days, seed 11.`);
    expect(within(panel).getByRole('group', { name: 'Probability of loss' })).toHaveTextContent(
      formatPercent(b.cumulative_return.probability_of_loss),
    );
    const histogram = within(panel).getByRole('img', { name: /200 simulated returns/ });
    expect(histogram).toHaveAttribute('data-total', '200');
    expect(histogram).toHaveAttribute(
      'data-bins',
      String(b.histograms.cumulative_return.counts.length),
    );
    expect(
      within(panel).getByRole('img', { name: /200 simulated maximum drawdowns/ }),
    ).toHaveAttribute('data-total', '200');
    const significance = within(panel).getByRole('region', { name: 'Statistical significance' });
    expect(significance).toHaveTextContent('one sided sign flip permutation test');
    expect(significance).toHaveTextContent(`p-value${formatNumber(s.p_value, 4)}`);
    expect(significance).toHaveTextContent(`Seed${s.seed}`);
  });

  it('paper trading waits for stages 1 to 4 to pass', async () => {
    setup();
    const panel = await openTab('Paper trading');
    expect(panel).toHaveTextContent(S.paper_trading.reason!);
    expect(panel).toHaveTextContent('It can start once stages 1 to 4 have passed.');
    expect(within(panel).queryByRole('button', { name: /Start paper trading/ })).toBeNull();
  });

  it('starts paper trading (stage 5) with the capital and loss limit', async () => {
    const ready = DEPLOY_STAGE5_READY;
    let replies: Reply[] = [
      { status: 422, body: DEPLOY_CAPITAL_REFUSED },
      { status: 201, body: DEPLOY_STAGE5_STARTED },
    ];
    const { post } = setup({
      reports: () => ({ status: 200, body: ready }),
      path: `/app/validation/${ready.id}`,
      post: () => {
        const [next, ...rest] = replies;
        replies = rest;
        return next!;
      },
    });
    const panel = await openTab('Paper trading');
    expect(panel).toHaveTextContent(ready.stages.paper_trading.reason!);
    fireEvent.change(within(panel).getByLabelText(/Capital/), { target: { value: '0' } });
    fireEvent.change(within(panel).getByLabelText(/Loss limit/), { target: { value: '120' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Start paper trading' }));
    expect(await within(panel).findByText('Enter an amount above 0.')).toBeInTheDocument();
    expect(within(panel).getByText('A percent above 0 and below 100, or empty.')).toBeVisible();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(within(panel).getByLabelText(/Capital/), { target: { value: '9000000' } });
    fireEvent.change(within(panel).getByLabelText(/Loss limit/), { target: { value: '20' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Start paper trading' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      DEPLOY_CAPITAL_REFUSED.detail,
    );
    expect(post).toHaveBeenLastCalledWith('/paper/deployments/from-validation/{validation_id}', {
      params: { path: { validation_id: ready.id } },
      body: { capital: 9000000, loss_limit: 0.2 },
    });
    fireEvent.change(within(panel).getByLabelText(/Capital/), { target: { value: '100000' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Start paper trading' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post).toHaveBeenLastCalledWith('/paper/deployments/from-validation/{validation_id}', {
      params: { path: { validation_id: ready.id } },
      body: { capital: 100000, loss_limit: 0.2 },
    });
  });

  it('a running paper stage shows its progress from the API', async () => {
    const running = DEPLOY_STAGE5_RUNNING;
    const paper = running.stages.paper_trading.paper!;
    setup({
      reports: () => ({ status: 200, body: running }),
      path: `/app/validation/${running.id}?tab=paper_trading`,
    });
    const panel = await screen.findByRole('tabpanel', { name: 'Paper trading' });
    expect(panel).toHaveTextContent(running.stages.paper_trading.reason!);
    expect(within(panel).getByRole('group', { name: 'Trading days' })).toHaveTextContent(
      `${paper.days_done} of ${paper.days_planned}`,
    );
    expect(within(panel).getByRole('group', { name: 'Return retained' })).toHaveTextContent(
      formatPercent(paper.retention),
    );
    expect(within(panel).getByRole('link', { name: 'Open the paper deployment' })).toHaveAttribute(
      'href',
      `/app/live/deployments/${paper.deployment_id}`,
    );
    expect(within(panel).queryByRole('button', { name: /Start paper trading/ })).toBeNull();
    expect(screen.getByRole('group', { name: 'Overall verdict' })).toHaveTextContent(
      running.verdict.reason,
    );
  });

  it('a finished paper stage shows its checks and the Validated verdict', async () => {
    const done = DEPLOY_STAGE5_DONE;
    const stage = done.stages.paper_trading;
    setup({
      reports: () => ({ status: 200, body: done }),
      path: `/app/validation/${done.id}?tab=paper_trading`,
    });
    const panel = await screen.findByRole('tabpanel', { name: 'Paper trading' });
    const table = within(panel).getByRole('table', { name: 'Paper trading checks' });
    for (const check of stage.checks) {
      const row = within(table).getByRole('row', { name: new RegExp(check.label) });
      expect(row).toHaveTextContent(ruleText(check));
      expect(row).toHaveTextContent(unitText(check.unit, check.value));
    }
    expect(screen.getByRole('group', { name: 'Overall verdict' })).toHaveTextContent(
      'Overall: Validated',
    );
  });

  it('configuration shows what makes the run reproducible', async () => {
    setup();
    const panel = await openTab('Configuration');
    const repro = within(panel).getByRole('region', { name: 'Reproducibility' });
    expect(repro).toHaveTextContent('Monte Carlo seed11');
    expect(repro).toHaveTextContent('Simulations200');
    expect(repro).toHaveTextContent(String(R.data_provenance!.data_fingerprint));
    expect(repro).toHaveTextContent('Validation version1.0');
    const config = within(panel).getByRole('region', { name: 'Configuration' });
    expect(config).toHaveTextContent('Parameter searchlookback in {5, 10}');
    expect(config).toHaveTextContent('Train 40 + validation 20 + test 20 bars, moving 20');
    const thresholds = within(panel).getByRole('region', { name: 'Thresholds' });
    for (const t of R.thresholds) expect(thresholds).toHaveTextContent(ruleText(t));
  });

  it('the tab lives in the address', async () => {
    setup({ path: `/app/validation/${ID}?tab=monte_carlo` });
    expect(await screen.findByRole('tabpanel', { name: 'Monte Carlo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stage 2, Walk-forward: Pass' }));
    expect(await screen.findByRole('tabpanel', { name: 'Walk-forward' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('?tab=walk_forward');
  });

  it('a running validation fills in stage by stage, and polling stops at the end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running: ValidationReport = {
      ...R,
      status: 'RUNNING',
      completed_at: null,
      verdict: { status: 'PENDING', reason: 'The validation has not finished.' },
      stages: {
        ...S,
        walk_forward: {
          ...S.walk_forward,
          status: 'RUNNING',
          checks: [],
          windows: [],
          summary: null,
          settings: null,
        },
        regime_stress: {
          ...S.regime_stress,
          status: 'NOT_RUN',
          checks: [],
          regimes: [],
          method: null,
          reason: null,
        },
        monte_carlo: {
          ...S.monte_carlo,
          status: 'NOT_RUN',
          checks: [],
          bootstrap: null,
          significance: null,
          reason: null,
        },
      },
    };
    let reads = 0;
    const { calls } = setup({
      reports: () => {
        reads += 1;
        return { status: 200, body: reads < 2 ? running : R };
      },
    });
    expect(await screen.findByText(/stages fill in as they finish/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Stage 2, Walk-forward: Running' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel validation/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Timeline' })).toBeInTheDocument();
    const panel = await openTab('Walk-forward');
    expect(panel).toHaveTextContent('This stage is running.');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await screen.findByText('Status: Completed. This is final.')).toBeInTheDocument();
    const seen = calls();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    expect(calls()).toBe(seen);
  });

  it('cancel asks first, then calls the backend', async () => {
    const running = { ...R, status: 'RUNNING' as const, completed_at: null };
    const { post } = setup({ reports: () => ({ status: 200, body: running }) });
    fireEvent.click(await screen.findByRole('button', { name: /Cancel validation/ }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel validation' }),
    );
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith('/executions/{execution_id}/cancel', {
        params: { path: { execution_id: ID } },
      }),
    );
  });

  it('another account or a missing id: not available, with no data', async () => {
    setup({ reports: () => ({ status: 404, body: { detail: 'Validation not found.' } }) });
    expect(await screen.findByText('Validation not available')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Validation pipeline' })).toBeNull();
  });
});

describe('ValidationHistoryPage', () => {
  it('lists the runs with their verdicts and stage statuses, linked to each report', async () => {
    setup({ path: '/app/validation' });
    const table = await screen.findByRole('table', { name: 'Validations' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('Nifty momentum');
    expect(row).toHaveTextContent('RELIANCE');
    expect(row).toHaveTextContent('Completed');
    expect(row).toHaveTextContent('Failed');
    expect(within(row).getByLabelText('Backtest: FAIL')).toBeInTheDocument();
    expect(within(row).getByLabelText('Paper trading: NOT_RUN')).toBeInTheDocument();
    expect(within(row).getAllByRole('link')[0]).toHaveAttribute('href', `/app/validation/${ID}`);
    expect(screen.getByText('1 validation.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New validation/ })).toHaveAttribute(
      'href',
      '/app/validation/new',
    );
  });

  it('an empty history says so and offers a new validation', async () => {
    setup({ path: '/app/validation', list: [] });
    expect(await screen.findByText('No validations yet')).toBeInTheDocument();
  });
});
