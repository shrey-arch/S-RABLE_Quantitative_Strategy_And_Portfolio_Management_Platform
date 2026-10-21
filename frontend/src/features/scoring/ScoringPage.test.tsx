import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { istDate } from '@/features/instruments/market-data';
import { SEEDED_TRADES } from '@/features/results/results-fixture';
import { metricText, metricValue, SUMMARY_METRICS } from '@/features/results/results-model';
import { coreInfo } from '@/features/strategies/core-strategies';
import { formatDate, formatNumber, formatPercent } from '@/lib/format';
import ScoringPage from './ScoringPage';
import { SCORES, SCORES_CUSTOM, SCORES_NO_REGIME, SCORING_DEFINITIONS } from './scoring-fixture';
import { DIRECTION_LABELS, rawText, scoreText, type ScoringResult } from './scoring-model';

type Reply = { status: number; body: unknown };
const respond = ({ status, body }: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });
const ok = (body: unknown): Reply => ({ status: 200, body });

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const SCORED = SCORES.rows.filter((r) => r.status === 'SCORED');
const UNSCORED = SCORES.rows.filter((r) => r.status !== 'SCORED');

function setup(options: { path?: string; scores?: ScoringResult } = {}) {
  vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/scoring/definitions') return respond(ok(SCORING_DEFINITIONS));
    if (url === '/executions/{execution_id}/results') return respond(ok(SEEDED_TRADES));
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((
    url: string,
    init: { body: { weights?: unknown } },
  ) => {
    if (url !== '/scoring') throw new Error(`unexpected POST ${url}`);
    return respond(ok(init.body.weights ? SCORES_CUSTOM : (options.scores ?? SCORES)));
  }) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Where() {
    const location = useLocation();
    return <div data-testid="where">{location.pathname + location.search}</div>;
  }
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[options.path ?? '/app/scoring']}>
          <Routes>
            <Route path="/app/scoring" element={<ScoringPage />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { post };
}

const openTab = async (name: string) => {
  fireEvent.mouseDown(await screen.findByRole('tab', { name }), { button: 0 });
  return screen.findByRole('tabpanel', { name });
};
const day = (t: string) => formatDate(istDate(t));

afterEach(() => vi.restoreAllMocks());

describe('ScoringPage', () => {
  it('the ranking shows exactly the API scores, factors and regime verdicts, in its order', async () => {
    setup();
    const table = await screen.findByRole('table', { name: 'Strategy ranking' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(SCORED.length);
    SCORED.forEach((s, i) => {
      const row = rows[i]!;
      expect(row).toHaveTextContent(`${s.rank}${s.name}${coreInfo(s.strategy_key!).name}`);
      expect(row).toHaveTextContent(scoreText(s.composite_score));
      for (const f of s.factors)
        expect(row).toHaveTextContent(`${f.label}${formatNumber(f.normalized, 3)}`);
      expect(row).toHaveTextContent(
        s.regime_compatibility!.status === 'COMPATIBLE' ? 'Compatible' : 'Not compatible',
      );
      expect(row).toHaveTextContent(`as of ${day(s.as_of!)}`);
    });
    expect(screen.getByRole('group', { name: 'Current regime' })).toHaveTextContent(
      SCORES.regime!.name,
    );
  });

  it('the breakdown shows raw, normalised, weight and contribution adding up to the score', async () => {
    setup();
    const first = SCORED[0]!;
    const breakdown = await screen.findByRole('region', { name: `Breakdown: ${first.name}` });
    const rows = within(within(breakdown).getByRole('table', { name: 'Factor breakdown' }))
      .getAllByRole('row')
      .slice(1);
    first.factors.forEach((f, i) => {
      expect(rows[i]).toHaveTextContent(
        `${f.label}${rawText(f.factor, f.raw)}${formatNumber(f.normalized, 3)}${DIRECTION_LABELS[f.direction]}${scoreText(f.suitability)}${formatNumber(f.weight, 2)}${formatPercent(f.weight_share)}${scoreText(f.contribution)}`,
      );
    });
    expect(rows.at(-1)).toHaveTextContent(`Composite score${scoreText(first.composite_score)}`);
    const segments = within(breakdown)
      .getByRole('img', { name: /Contributions of/ })
      .querySelectorAll('[data-factor]');
    expect([...segments].map((s) => Number(s.getAttribute('data-contribution')))).toEqual(
      first.factors.map((f) => f.contribution),
    );
    // Another strategy's breakdown, kept in the address.
    const other = SCORED[2]!;
    fireEvent.click(screen.getByRole('button', { name: `Breakdown of ${other.name}` }));
    expect(
      await screen.findByRole('region', { name: `Breakdown: ${other.name}` }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`strategy=${other.strategy_id}`);
  });

  it('strategies that are not scored are listed with the backend reason', async () => {
    setup();
    const list = await screen.findByRole('region', { name: 'Not scored' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(UNSCORED.length);
    UNSCORED.forEach((s, i) => expect(items[i]).toHaveTextContent(`${s.name}${s.reason}`));
    expect(within(list).getAllByRole('link', { name: /Backtest it/ })).toHaveLength(1);
  });

  it('compares two strategies side by side with their latest backtest metrics', async () => {
    setup();
    await screen.findByRole('table', { name: 'Strategy ranking' });
    fireEvent.click(screen.getByRole('checkbox', { name: `Compare ${SCORED[0]!.name}` }));
    fireEvent.click(screen.getByRole('checkbox', { name: `Compare ${SCORED[2]!.name}` }));
    expect(screen.getByTestId('where')).toHaveTextContent(
      `compare=${SCORED[0]!.strategy_id}%2C${SCORED[2]!.strategy_id}`,
    );
    const panel = await openTab('Compare');
    const table = await within(panel).findByRole('table', { name: 'Strategy comparison' });
    const header = within(table)
      .getAllByRole('columnheader')
      .map((c) => c.textContent);
    expect(header.slice(1)).toEqual([SCORED[0]!.name, SCORED[2]!.name]);
    const row = (label: string) =>
      within(table).getByRole('row', { name: new RegExp(`^${label}`) });
    expect(row('Composite score')).toHaveTextContent(
      `${scoreText(SCORED[0]!.composite_score)}${scoreText(SCORED[2]!.composite_score)}`,
    );
    const sharpe = SUMMARY_METRICS.find((m) => m.key === 'sharpe_ratio')!;
    const text = metricText(sharpe.format, metricValue(SEEDED_TRADES, sharpe));
    expect(
      await within(table).findByRole('row', { name: /^Backtest: Sharpe ratio/ }),
    ).toHaveTextContent(`${text}${text}`);
    // At most three.
    for (const s of SCORED.slice(3, 4))
      fireEvent.click(within(panel).getByRole('checkbox', { name: s.name }));
    expect(within(panel).getByRole('checkbox', { name: SCORED[4]!.name })).toBeDisabled();
  });

  it('custom weights are checked, sent once, and the new scores shown', async () => {
    const { post } = setup({ path: '/app/scoring?tab=weights' });
    const momentum = await screen.findByRole('textbox', {
      name: 'Momentum: Trend strength weight',
    });
    expect(momentum).toHaveValue('1');
    fireEvent.change(momentum, { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Re-score with these weights' }));
    expect(await screen.findByText('Enter a number of 0 or more.')).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1); // only the first, default request

    fireEvent.change(momentum, { target: { value: '3' } });
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Momentum: Volatility suitability weight' }),
      {
        target: { value: '0' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Re-score with these weights' }));
    await vi.waitFor(() =>
      expect(post).toHaveBeenLastCalledWith('/scoring', {
        body: {
          weights: {
            momentum: { trend_strength: 3, relative_momentum: 1, volatility_suitability: 0 },
          },
        },
      }),
    );
    expect(await screen.findByText('Custom weights in use')).toBeInTheDocument();
    const panel = await openTab('Ranking');
    const rows = within(
      within(panel).getByRole('table', { name: 'Strategy ranking' }),
    ).getAllByRole('row');
    const custom = SCORES_CUSTOM.rows.filter((r) => r.status === 'SCORED');
    expect(rows.slice(1).map((r) => r.querySelector('td:nth-child(2)')!.textContent)).toEqual(
      custom.map((r) => String(r.rank)),
    );
    expect(rows[4]).toHaveTextContent(`${custom[3]!.name}`);
    expect(within(panel).getByRole('region', { name: 'Ranking' })).toHaveTextContent(
      'custom weights (not saved)',
    );
  });

  it('factor definitions and regime rules are shown as the API documents them', async () => {
    setup({ path: '/app/scoring?tab=weights' });
    const table = await screen.findByRole('table', { name: 'Factor definitions' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(
      SCORING_DEFINITIONS.factors.map((f) => `${f.label}${f.raw}${f.normalization}`),
    );
    const rules = screen.getByRole('region', { name: 'Regime compatibility rules' });
    for (const s of SCORING_DEFINITIONS.strategies)
      expect(rules).toHaveTextContent(s.regime_rule.rule);
  });

  it('without a regime model compatibility is unknown, not guessed', async () => {
    setup({ scores: SCORES_NO_REGIME });
    expect(await screen.findByRole('group', { name: 'Current regime' })).toHaveTextContent(
      'No regime model has been trained',
    );
    const table = screen.getByRole('table', { name: 'Strategy ranking' });
    for (const row of within(table).getAllByRole('row').slice(1))
      expect(row).toHaveTextContent('Unknown');
  });
});
