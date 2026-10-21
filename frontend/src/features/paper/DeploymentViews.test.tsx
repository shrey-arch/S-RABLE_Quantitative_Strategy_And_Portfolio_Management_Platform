import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import { notificationLink } from '@/features/notifications/notification-model';
import type { ChartPoint } from '@/features/results/results-model';
import { REGISTRY_FIXTURE } from '@/features/strategies/registry-fixture';
import { formatDate, formatINR, formatPercent } from '@/lib/format';
import DeploymentDetailPage from './DeploymentDetailPage';
import {
  DEPLOY_CAPITAL_REFUSED,
  DEPLOY_DEPLOYMENT,
  DEPLOY_DEPLOYMENTS,
  DEPLOY_PERFORMANCE,
  DEPLOY_RUN_DUE,
} from './deploy-fixture';
import LiveTradingPage from '@/features/live/LiveTradingPage';
import {
  PAPER_ACCOUNT,
  PAPER_CHARGES,
  PAPER_FILLS,
  PAPER_HOLDINGS,
  PAPER_ORDERS,
  PAPER_QUOTES,
} from './paper-fixture';
import {
  buildDeployBody,
  dayOrderText,
  deploymentActions,
  emptyDeploy,
  lossLimitFraction,
  parseTags,
} from './paper-model';

// jsdom has no canvas; the stand-in exposes what the chart is given.
vi.mock('@/features/results/ResultsCharts', () => ({
  EquityChart: (p: { strategy: ChartPoint[]; label: string; seriesLabel?: string }) => (
    <div
      role="img"
      aria-label={p.label}
      data-points={p.strategy.length}
      data-last={p.strategy.at(-1)?.value}
      data-series={p.seriesLabel}
    />
  ),
}));

const respond = (status: number, body: unknown) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const RELIANCE = INSTRUMENTS_FIXTURE[0]!;
const NIFTYBEES = INSTRUMENTS_FIXTURE[1]!;

const RULES = {
  parameters: {},
  indicators: [{ name: 'sma3', type: 'SMA', parameters: { window: 3 } }],
  entry_conditions: [
    {
      left: { type: 'price', field: 'close' },
      operator: '>',
      right: { type: 'indicator', name: 'sma3' },
    },
  ],
  exit_conditions: [],
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
  strategy('taa', 'tactical_asset_allocation'),
  strategy('nc', null),
  strategy('off', 'momentum', { is_active: false }),
  strategy('rl', null, { strategy_config: RULES }),
];

const DEP = DEPLOY_DEPLOYMENT;

function setup(
  path: string,
  opts: { deploy?: () => [number, unknown]; detail?: () => [number, unknown] } = {},
) {
  vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    const answers: Record<string, unknown> = {
      '/paper/account': PAPER_ACCOUNT,
      '/paper/quotes': PAPER_QUOTES,
      '/paper/orders': PAPER_ORDERS,
      '/paper/holdings': PAPER_HOLDINGS,
      '/paper/fills': PAPER_FILLS,
      '/paper/charges': PAPER_CHARGES,
      '/paper/deployments': DEPLOY_DEPLOYMENTS,
      '/paper/performance': DEPLOY_PERFORMANCE,
      '/instruments': INSTRUMENTS_FIXTURE,
      '/strategies': STRATEGIES,
      '/strategy-registry': REGISTRY_FIXTURE,
      '/live/sessions': [],
    };
    if (url === '/paper/deployments/{deployment_id}')
      return respond(...(opts.detail?.() ?? [200, DEP]));
    if (url in answers) return respond(200, answers[url]);
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((url: string) => {
    if (url === '/paper/deployments') return respond(...(opts.deploy?.() ?? [201, DEP]));
    if (url === '/paper/deployments/run-due') return respond(200, DEPLOY_RUN_DUE);
    if (url.startsWith('/paper/deployments/{deployment_id}/'))
      return respond(200, { ...DEP, status: url.endsWith('pause') ? 'PAUSED' : 'STOPPED' });
    throw new Error(`unexpected POST ${url}`);
  }) as never);
  const patch = vi
    .spyOn(api, 'PATCH')
    .mockImplementation((() => respond(200, { ...PAPER_ORDERS[0], note: 'n' })) as never);
  function Where() {
    const l = useLocation();
    return <div data-testid="where">{l.pathname + l.search}</div>;
  }
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app/live" element={<LiveTradingPage />} />
            <Route path="/app/live/deployments/:id" element={<DeploymentDetailPage />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { post, patch };
}

afterEach(() => vi.restoreAllMocks());

describe('Strategy deployments on the paper account', () => {
  it('the Deployments tab lists the deployments as returned; run due days now', async () => {
    const { post } = setup('/app/live?tab=deployments');
    const table = await screen.findByRole('table', { name: 'Strategy deployments' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(DEPLOY_DEPLOYMENTS.length);
    const done = DEPLOY_DEPLOYMENTS.find((d) => d.status === 'COMPLETED')!;
    const row = rows.find((r) => r.textContent!.includes('Completed'))!;
    expect(row).toHaveTextContent('Validation stage 5');
    expect(row).toHaveTextContent(done.status_reason!);
    expect(row).toHaveTextContent(formatINR(done.performance.end_value));
    expect(row).toHaveTextContent(formatPercent(done.performance.total_return));
    expect(row).toHaveTextContent(formatDate(done.last_processed_date));
    expect(within(row).getByRole('link', { name: done.name })).toHaveAttribute(
      'href',
      `/app/live/deployments/${done.id}`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run due days now' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/paper/deployments/run-due'));
  });

  it('deploy offers only strategies the daily job can trade and sends the exact body', async () => {
    let replies: [number, unknown][] = [
      [422, DEPLOY_CAPITAL_REFUSED],
      [201, DEP],
    ];
    const { post } = setup('/app/live?tab=deployments', {
      deploy: () => {
        const [next, ...rest] = replies;
        replies = rest;
        return next!;
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Deploy strategy/ }));
    const dialog = await screen.findByRole('dialog');
    const select = await within(dialog).findByRole('combobox', { name: /Strategy/ });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a strategy', 'Strategy mom', 'Strategy taa', 'Strategy rl']);

    fireEvent.change(within(dialog).getByLabelText(/Capital/), { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText(/Loss limit/), { target: { value: '100' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
    expect(await within(dialog).findByText('Choose a strategy.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose every instrument.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter an amount above 0.')).toBeInTheDocument();
    expect(within(dialog).getByText('A percent above 0 and below 100, or empty.')).toBeVisible();
    expect(post).not.toHaveBeenCalled();

    // A universe strategy needs at least two assets and takes no quantity.
    fireEvent.change(select, { target: { value: 'taa' } });
    expect(within(dialog).getByRole('combobox', { name: /Asset 2/ })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Quantity/)).toBeNull();
    fireEvent.change(select, { target: { value: 'rl' } });
    expect(within(dialog).queryByRole('combobox', { name: /Asset 2/ })).toBeNull();

    const picker = within(dialog).getByRole('combobox', { name: /^Instrument/ });
    await waitFor(() => expect(picker).not.toBeDisabled());
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).not.toContain(expect.stringContaining('GOLDM'));
    fireEvent.change(picker, { target: { value: RELIANCE.id } });
    fireEvent.change(within(dialog).getByLabelText(/Quantity/), { target: { value: '20' } });
    fireEvent.change(within(dialog).getByLabelText(/Capital/), { target: { value: '9000000' } });
    fireEvent.change(within(dialog).getByLabelText(/Loss limit/), { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      DEPLOY_CAPITAL_REFUSED.detail,
    );
    expect(post).toHaveBeenLastCalledWith('/paper/deployments', {
      body: {
        strategy_id: 'rl',
        instrument_id: RELIANCE.id,
        other_instrument_ids: [],
        quantity: 20,
        capital: 9000000,
        loss_limit: 0.1,
        duration_days: 30,
      },
    });
    fireEvent.change(within(dialog).getByLabelText(/Capital/), { target: { value: '200000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deploy' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`/app/live/deployments/${DEP.id}`),
    );
  });

  it('the Performance tab shows the backend metrics and the value at each close', async () => {
    setup('/app/live?tab=performance');
    const p = DEPLOY_PERFORMANCE.performance;
    const tiles = await screen.findByRole('region', { name: 'Account performance' });
    expect(tiles).toHaveTextContent(`Value${formatINR(p.end_value)}`);
    expect(tiles).toHaveTextContent(`Total return${formatPercent(p.total_return)}`);
    expect(tiles).toHaveTextContent(`Max drawdown${formatPercent(p.max_drawdown)}`);
    expect(tiles).toHaveTextContent(`Win rate${formatPercent(p.win_rate)}`);
    const chart = screen.getByRole('img', { name: /Account value at each close/ });
    expect(chart).toHaveAttribute('data-points', String(DEPLOY_PERFORMANCE.snapshots.length));
    expect(chart).toHaveAttribute('data-series', 'Account');
    expect(chart).toHaveAttribute('data-last', String(DEPLOY_PERFORMANCE.snapshots.at(-1)!.equity));
    for (const b of DEPLOY_PERFORMANCE.basis) expect(screen.getByText(b)).toBeInTheDocument();
  });

  it('the journal saves a note and tags on an order', async () => {
    const { patch } = setup('/app/live?tab=account&view=book');
    const book = await screen.findByRole('table', { name: 'Order book' });
    const order = PAPER_ORDERS[0]!;
    expect(within(book).getAllByText('Manual').length).toBe(PAPER_ORDERS.length);
    fireEvent.click(
      within(book).getAllByRole('button', {
        name: `Journal for ${order.side} ${order.quantity} ${order.symbol}`,
      })[0]!,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Trade journal' });
    fireEvent.change(within(dialog).getByLabelText(/Note/), {
      target: { value: 'Breakout above resistance' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Tags/), {
      target: { value: 'breakout, swing, breakout' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save journal' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/paper/orders/{order_id}/journal', {
        params: { path: { order_id: order.id } },
        body: { note: 'Breakout above resistance', tags: ['breakout', 'swing'] },
      }),
    );
  });

  it('the deployment page shows its log, performance and controls; stop asks first', async () => {
    const { post } = setup(`/app/live/deployments/${DEP.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: DEP.name })).toBeVisible();
    const tiles = screen.getByRole('region', { name: 'Deployment performance' });
    expect(tiles).toHaveTextContent(`Value${formatINR(DEP.performance.end_value)}`);
    const chart = screen.getByRole('img', { name: /Deployment value at each close/ });
    expect(chart).toHaveAttribute('data-points', String(DEP.days.length));
    expect(chart).toHaveAttribute('data-last', String(DEP.days[0]!.equity));
    const log = screen.getByRole('table', { name: 'Daily log' });
    expect(within(log).getAllByRole('row').slice(1)).toHaveLength(DEP.days.length);
    const buy = DEP.days.find((d) => d.orders.length > 0 && d.signal === 'BUY')!;
    expect(log).toHaveTextContent(dayOrderText(buy.orders[0]!));
    const config = screen.getByRole('region', { name: 'Configuration' });
    expect(config).toHaveTextContent(`Capital${formatINR(DEP.capital)}`);
    expect(config).toHaveTextContent(`Loss limit${formatPercent(DEP.loss_limit)}`);
    expect(config).toHaveTextContent('close > sma3');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/paper/deployments/{deployment_id}/pause', {
        params: { path: { deployment_id: DEP.id } },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(post).not.toHaveBeenCalledWith(
      '/paper/deployments/{deployment_id}/stop',
      expect.anything(),
    );
    fireEvent.click(within(confirm).getByRole('button', { name: 'Stop deployment' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/paper/deployments/{deployment_id}/stop', {
        params: { path: { deployment_id: DEP.id } },
      }),
    );
  });

  it("another account's deployment is not available", async () => {
    setup('/app/live/deployments/nope', {
      detail: () => [404, { detail: 'Deployment not found.' }],
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Paper deployment not available' }),
    ).toBeVisible();
  });
});

describe('deployment helpers', () => {
  it('checks the deploy form the way the backend does', () => {
    expect(buildDeployBody(emptyDeploy(), true)).toEqual({
      ok: false,
      errors: { strategy_id: 'Choose a strategy.', instrument_id: 'Choose every instrument.' },
    });
    expect(
      buildDeployBody(
        {
          ...emptyDeploy(),
          strategyId: 'taa',
          instrumentIds: [RELIANCE.id, RELIANCE.id],
          durationDays: '400',
        },
        false,
      ),
    ).toEqual({
      ok: false,
      errors: {
        instrument_id: 'Choose different instruments.',
        duration_days: 'Whole number of days from 1 to 365, or empty to run until stopped.',
      },
    });
    expect(
      buildDeployBody(
        {
          strategyId: 'taa',
          instrumentIds: [RELIANCE.id, NIFTYBEES.id],
          quantity: 'x',
          capital: '50000.5',
          lossLimitPct: '',
          durationDays: '',
        },
        false,
      ),
    ).toEqual({
      ok: true,
      body: {
        strategy_id: 'taa',
        instrument_id: RELIANCE.id,
        other_instrument_ids: [NIFTYBEES.id],
        quantity: 1,
        capital: 50000.5,
        loss_limit: null,
        duration_days: null,
      },
    });
    expect(lossLimitFraction('7.5')).toBe(0.075);
    expect(lossLimitFraction('0')).toBeUndefined();
  });

  it('offers only the controls the backend accepts', () => {
    expect(deploymentActions('ACTIVE')).toEqual(['pause', 'stop']);
    expect(deploymentActions('PAUSED')).toEqual(['resume', 'stop']);
    expect(deploymentActions('COMPLETED')).toEqual([]);
    expect(deploymentActions('STOPPED')).toEqual([]);
  });

  it('cleans journal tags and links paper notifications to the deployment', () => {
    expect(parseTags(' a, b ,, a,' + 'x'.repeat(40))).toEqual(['a', 'b', 'x'.repeat(30)]);
    expect(
      notificationLink({
        execution_id: 'e1',
        execution_type: 'VALIDATION',
        notification_data: { event: 'PAPER_DEPLOYMENT', deployment_id: DEP.id, status: 'ACTIVE' },
      } as never),
    ).toEqual({ to: `/app/live/deployments/${DEP.id}`, label: 'Open paper deployment' });
  });
});
