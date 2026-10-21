import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { formatINR, formatNumber, formatPercent } from '@/lib/format';
import PortfolioDetailPage from './PortfolioDetailPage';
import {
  PORTFOLIO_ACCOUNT_EMPTY,
  PORTFOLIO_ACCOUNT_SAVED,
  PORTFOLIO_CURRENT_REGIME,
  PORTFOLIO_PRICES,
  PORTFOLIO_REBALANCE,
  PORTFOLIO_REBALANCE_HELD,
  PORTFOLIO_SCORES,
  PORTFOLIO_TARGET_LIMITS,
} from './portfolio-fixture';
import { CALCULATION_ONLY, LIMIT_LABELS, MESSAGES, type PortfolioAccount } from './portfolio-model';

const respond = (status: number, body: unknown) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

const SCORED = PORTFOLIO_SCORES.rows.filter((r) => r.status === 'SCORED');

function setup(options: { account?: PortfolioAccount | null; tab?: string } = {}) {
  const account = options.account === undefined ? PORTFOLIO_ACCOUNT_SAVED : options.account;
  let saved = account;
  vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/portfolio/accounts/{portfolio_id}')
      return saved ? respond(200, saved) : respond(404, { detail: 'Portfolio not found.' });
    if (url === '/portfolio/prices') return respond(200, PORTFOLIO_PRICES);
    if (url === '/regime/current') return respond(200, PORTFOLIO_CURRENT_REGIME);
    if (url === '/portfolio/accounts') return respond(200, []);
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((url: string) => {
    if (url === '/scoring') return respond(200, PORTFOLIO_SCORES);
    if (url === '/portfolio/target') return respond(200, PORTFOLIO_TARGET_LIMITS);
    if (url === '/portfolio/rebalance')
      return respond(
        200,
        account?.holdings.length ? PORTFOLIO_REBALANCE_HELD : PORTFOLIO_REBALANCE,
      );
    throw new Error(`unexpected POST ${url}`);
  }) as never);
  const put = vi.spyOn(api, 'PUT').mockImplementation((() => {
    saved = PORTFOLIO_ACCOUNT_SAVED;
    return respond(200, PORTFOLIO_ACCOUNT_SAVED);
  }) as never);
  const id = account?.id ?? 'not-mine';
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <MemoryRouter
          initialEntries={[`/app/portfolios/${id}${options.tab ? `?tab=${options.tab}` : ''}`]}
        >
          <Routes>
            <Route path="/app/portfolios/:id" element={<PortfolioDetailPage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const calls = (url: string) => post.mock.calls.filter((c) => c[0] === url);
  return { post, put, calls };
}

const openTab = async (name: string) => {
  fireEvent.mouseDown(await screen.findByRole('tab', { name }), { button: 0 });
  return screen.findByRole('tabpanel', { name });
};

afterEach(() => vi.restoreAllMocks());

describe('PortfolioDetailPage', () => {
  it('shows the saved state: cash, equity, weights donut and holdings as returned', async () => {
    setup();
    const a = PORTFOLIO_ACCOUNT_SAVED;
    expect(await screen.findByRole('heading', { level: 1, name: a.name })).toBeInTheDocument();
    const stats = screen.getByRole('group', { name: 'Saved state' });
    for (const v of [a.cash, a.invested_value, a.total_equity])
      expect(stats).toHaveTextContent(formatINR(v));
    expect(stats).toHaveTextContent('Simulated');
    const donut = screen.getByRole('img', { name: 'Allocation weights of holdings and cash' });
    const slices = [...donut.querySelectorAll('[data-slice]')].map((s) => [
      s.getAttribute('data-slice'),
      s.getAttribute('data-weight'),
    ]);
    expect(slices).toEqual([
      ...a.holdings.map((h) => [h.asset, h.weight]),
      ['Cash', a.cash_weight],
    ]);
    const rows = within(screen.getByRole('table', { name: 'Holdings' }))
      .getAllByRole('row')
      .slice(1);
    a.holdings.forEach((h, i) =>
      expect(rows[i]).toHaveTextContent(
        `${h.asset}${formatNumber(h.quantity, 0)}${formatINR(h.average_price)}${formatINR(h.price)}${formatINR(h.market_value)}${formatPercent(h.weight)}`,
      ),
    );
  });

  it("another user's portfolio id is not available, with no data", async () => {
    setup({ account: null });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Portfolio not available' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('target: prefilled from the saved equity, scores and current regime; shows the API result', async () => {
    const { calls, put } = setup({ tab: 'target' });
    const panel = await screen.findByRole('tabpanel', { name: 'Target allocation' });
    expect(within(panel).getByRole('note')).toHaveTextContent(CALCULATION_ONLY);
    const capital = within(panel).getByRole('textbox', { name: /Capital to allocate/ });
    expect(capital).toHaveValue(PORTFOLIO_ACCOUNT_SAVED.total_equity);
    const regime = await within(panel).findByRole('combobox', { name: 'Regime' });
    await waitFor(() => expect(regime).toHaveValue(PORTFOLIO_CURRENT_REGIME.regime.code));
    for (const s of SCORED)
      expect(
        await within(panel).findByRole('checkbox', { name: new RegExp(s.name) }),
      ).toBeChecked();

    fireEvent.change(within(panel).getByRole('textbox', { name: /Max strategy weight/ }), {
      target: { value: '130' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Calculate target' }));
    expect(await within(panel).findByText(MESSAGES.percent)).toBeInTheDocument();
    expect(calls('/portfolio/target')).toHaveLength(0);

    fireEvent.change(within(panel).getByRole('textbox', { name: /Max strategy weight/ }), {
      target: { value: '30' },
    });
    fireEvent.change(within(panel).getByRole('textbox', { name: /Cash reserve/ }), {
      target: { value: '100000' },
    });
    fireEvent.change(within(panel).getByRole('textbox', { name: /Max asset weight/ }), {
      target: { value: '45' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Calculate target' }));
    const t = PORTFOLIO_TARGET_LIMITS;
    const table = await within(panel).findByRole('table', { name: 'Selected strategies' });
    expect(calls('/portfolio/target')).toEqual([
      [
        '/portfolio/target',
        {
          body: {
            capital: PORTFOLIO_ACCOUNT_SAVED.total_equity,
            strategy_ids: SCORED.map((s) => s.strategy_id),
            regime: PORTFOLIO_CURRENT_REGIME.regime.code,
            limits: {
              cash_reserve: '100000',
              max_strategy_weight: '0.3',
              max_asset_weight: '0.45',
              max_invested_capital: null,
            },
            require_validated: true,
          },
        },
      ],
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    t.positions.forEach((p, i) => {
      expect(rows[i]).toHaveTextContent(`${p.name}`);
      expect(rows[i]).toHaveTextContent(
        `${p.asset}${formatNumber(p.score, 3)}${formatINR(p.amount)}${formatPercent(p.weight)}`,
      );
    });
    expect(rows[t.positions.length]).toHaveTextContent(
      `Cash${formatINR(t.cash_reserve)}${formatPercent(t.cash_weight)}`,
    );
    const donut = within(panel).getByRole('img', { name: 'Target asset weights and cash' });
    expect(
      [...donut.querySelectorAll('[data-slice]')].map((s) => s.getAttribute('data-weight')),
    ).toEqual([...Object.values(t.asset_weights), t.cash_weight]);
    const bound = within(panel).getByRole('list', { name: 'Binding limits' });
    for (const b of t.binding_limits) {
      expect(bound).toHaveTextContent(LIMIT_LABELS[b.limit]!);
      expect(bound).toHaveTextContent(b.detail);
    }
    expect(bound).toHaveTextContent(
      `Max strategy weight: 30.00% (${t.positions.find((p) => p.strategy === t.binding_limits[1]!.affected[0])!.name})`,
    );
    const excluded = within(panel).getByRole('list', { name: 'Not allocated' });
    for (const e of t.excluded) expect(excluded).toHaveTextContent(`${e.name}${e.reason}`);
    expect(put).not.toHaveBeenCalled();
  });

  it('rebalance: prices prefilled from the latest close, plan shown as returned, nothing saved', async () => {
    const { put, calls } = setup({ tab: 'rebalance' });
    const panel = await screen.findByRole('tabpanel', { name: 'Rebalance plan' });
    for (const p of PORTFOLIO_PRICES)
      await waitFor(() =>
        expect(within(panel).getByRole('textbox', { name: `Price of ${p.asset}` })).toHaveValue(
          p.price,
        ),
      );
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Price of RELIANCE-EQ' }), {
      target: { value: '125.50' },
    });
    fireEvent.change(within(panel).getByRole('textbox', { name: /Minimum trade value/ }), {
      target: { value: '1000' },
    });
    await within(panel).findByRole('checkbox', { name: new RegExp(SCORED[0]!.name) });
    fireEvent.click(within(panel).getByRole('button', { name: 'Calculate rebalance plan' }));
    const table = await within(panel).findByRole('table', { name: 'Rebalance plan by asset' });
    const body = (calls('/portfolio/rebalance')[0]![1] as { body: Record<string, never> }).body;
    const a = PORTFOLIO_ACCOUNT_SAVED;
    expect(body.cash).toBe(a.cash);
    expect(body.prices).toEqual({
      'RELIANCE-EQ': '125.50',
      'NIFTYBEES-EQ': PORTFOLIO_PRICES[1]!.price,
    });
    expect(body.holdings!['RELIANCE-EQ']).toEqual({
      quantity: a.holdings[0]!.quantity,
      price: '125.50',
    });
    expect(body.minimum_trade_value).toBe('1000');
    const plan = PORTFOLIO_REBALANCE_HELD;
    const rows = within(table).getAllByRole('row').slice(1);
    plan.assets.forEach((r, i) => {
      expect(rows[i]).toHaveTextContent(
        `${r.asset}${formatINR(r.price)}${formatINR(r.current_value)}`,
      );
      expect(rows[i]).toHaveTextContent(
        `${formatPercent(r.current_weight)}${formatINR(r.target_value)}${formatPercent(r.target_weight)}${r.action}${formatNumber(r.trade_quantity, 0)}${formatINR(r.trade_value)}`,
      );
    });
    expect(put).not.toHaveBeenCalled();
  });

  it('applying a plan fills the editor; saving needs a confirmation and sends it once', async () => {
    const { put } = setup({ account: PORTFOLIO_ACCOUNT_EMPTY, tab: 'rebalance' });
    const panel = await screen.findByRole('tabpanel', { name: 'Rebalance plan' });
    await within(panel).findByRole('checkbox', { name: new RegExp(SCORED[0]!.name) });
    fireEvent.click(within(panel).getByRole('button', { name: 'Calculate rebalance plan' }));
    fireEvent.click(
      await within(panel).findByRole('button', { name: 'Use this result to edit and save' }),
    );
    const editor = await screen.findByRole('tabpanel', { name: 'Edit and save' });
    const ending = PORTFOLIO_REBALANCE.ending_state!;
    expect(within(editor).getByRole('textbox', { name: /Cash/ })).toHaveValue(ending.cash);
    ending.holdings.forEach((h, i) => {
      expect(within(editor).getByRole('textbox', { name: `Holding ${i + 1} asset` })).toHaveValue(
        h.asset,
      );
      expect(
        within(editor).getByRole('textbox', { name: `Holding ${i + 1} quantity` }),
      ).toHaveValue(String(h.quantity));
    });
    expect(put).not.toHaveBeenCalled();

    fireEvent.click(within(editor).getByRole('button', { name: /Save state/ }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent(
      `Cash ${formatINR(ending.cash)} and ${ending.holdings.length} holding(s)`,
    );
    const yes = within(confirm).getByRole('button', { name: 'Save' });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/portfolio/accounts/{portfolio_id}/state', {
      params: { path: { portfolio_id: PORTFOLIO_ACCOUNT_EMPTY.id } },
      body: {
        cash: ending.cash,
        holdings: Object.fromEntries(
          ending.holdings.map((h) => [h.asset, { quantity: h.quantity, price: h.price }]),
        ),
      },
    });
    // Back on the overview with the saved state.
    const overview = await screen.findByRole('tabpanel', { name: 'Overview' });
    expect(await within(overview).findByRole('table', { name: 'Holdings' })).toHaveTextContent(
      'RELIANCE-EQ',
    );
  });

  it('edited holdings are checked before anything is sent', async () => {
    const { put } = setup({ tab: 'state' });
    const editor = await screen.findByRole('tabpanel', { name: 'Edit and save' });
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Holding 2 asset' }), {
      target: { value: 'RELIANCE-EQ' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: /Save state/ }));
    expect(await within(editor).findByText(MESSAGES.duplicate)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(within(editor).getByRole('button', { name: /Reset to saved/ }));
    expect(within(editor).getByRole('textbox', { name: 'Holding 2 asset' })).toHaveValue(
      'NIFTYBEES-EQ',
    );
    fireEvent.click(within(editor).getByRole('button', { name: /Add holding/ }));
    expect(within(editor).getByRole('textbox', { name: 'Holding 3 asset' })).toHaveValue('');
    await openTab('Overview');
    expect(put).not.toHaveBeenCalled();
  });
});
