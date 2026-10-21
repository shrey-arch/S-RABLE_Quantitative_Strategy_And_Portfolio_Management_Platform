import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import { formatINR, formatNumber } from '@/lib/format';
import RecordsPage from './RecordsPage';
import {
  RECORDS_EXECUTION_ID,
  RECORDS_EXECUTIONS,
  RECORDS_ORDERS,
  RECORDS_POSITIONS,
  RECORDS_REFUSED,
  RECORDS_STRATEGY,
  RECORDS_TRADES,
} from './records-fixture';
import { FORMULAS, MAINTENANCE_LABEL } from './records-model';

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

type Init = { params?: { query?: Record<string, string>; path?: Record<string, string> } };

function setup(path = '/app/records') {
  const get = vi.spyOn(api, 'GET').mockImplementation(((url: string, init?: Init) => {
    const q = init?.params?.query ?? {};
    const p = init?.params?.path ?? {};
    switch (url) {
      case '/executions':
        return respond(200, RECORDS_EXECUTIONS);
      case '/strategies':
        return respond(200, [RECORDS_STRATEGY]);
      case '/instruments':
        return respond(200, INSTRUMENTS_FIXTURE);
      case '/orders':
        return respond(
          200,
          RECORDS_ORDERS.filter(
            (o) =>
              (!q.side || o.order_side === q.side) &&
              (!q.instrument_id || o.instrument_id === q.instrument_id),
          ),
        );
      case '/trades':
        return respond(
          200,
          RECORDS_TRADES.filter((t) => !q.order_id || t.order_id === q.order_id),
        );
      case '/positions':
        return respond(
          200,
          RECORDS_POSITIONS.filter((x) => !q.instrument_id || x.instrument_id === q.instrument_id),
        );
      case '/orders/{order_id}': {
        const o = RECORDS_ORDERS.find((x) => x.id === p.order_id);
        return o ? respond(200, o) : respond(404, { detail: 'Order not found.' });
      }
      case '/trades/{trade_id}': {
        const t = RECORDS_TRADES.find((x) => x.id === p.trade_id);
        return t ? respond(200, t) : respond(404, { detail: 'Trade not found.' });
      }
      case '/positions/{position_id}': {
        const x = RECORDS_POSITIONS.find((y) => y.id === p.position_id);
        return x ? respond(200, x) : respond(404, { detail: 'Position not found.' });
      }
    }
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi
    .spyOn(api, 'POST')
    .mockImplementation((() => respond(400, RECORDS_REFUSED)) as never);
  const del = vi.spyOn(api, 'DELETE').mockImplementation((() => respond(204, undefined)) as never);
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
            <Route path="/app/records" element={<RecordsPage />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const calls = (url: string) =>
    get.mock.calls
      .filter((c) => c[0] === url)
      .map((c) => (c[1] as Init | undefined)?.params?.query);
  return { get, post, del, calls };
}

const symbol = (id: string) => INSTRUMENTS_FIXTURE.find((i) => i.id === id)!.symbol;
const openTab = async (name: string) => {
  fireEvent.mouseDown(await screen.findByRole('tab', { name }), { button: 0 });
  return screen.findByRole('tabpanel', { name });
};
const rowsOf = async (caption: string) =>
  within(await screen.findByRole('table', { name: caption }))
    .getAllByRole('row')
    .slice(1);

afterEach(() => vi.restoreAllMocks());

describe('RecordsPage', () => {
  it('lists the orders as returned, with their execution and instrument, all simulated', async () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Trading Records' })).toBeInTheDocument();
    expect(screen.getByText(/Simulated \u2014 no real orders/)).toBeInTheDocument();
    const rows = await rowsOf('Orders');
    expect(rows).toHaveLength(RECORDS_ORDERS.length);
    await waitFor(() => expect(rows[0]).toHaveTextContent('Momentum flip'));
    RECORDS_ORDERS.forEach((o, i) => {
      expect(rows[i]).toHaveTextContent(symbol(o.instrument_id));
      expect(rows[i]).toHaveTextContent(
        `${o.order_side}Completed${formatNumber(o.quantity, 0)}${formatNumber(o.filled_quantity, 0)}${formatNumber(o.price)}${formatNumber(o.average_fill_price)}`,
      );
    });
  });

  it('filters are sent to the API and kept in the address; each tab sends only its own', async () => {
    const { calls } = setup(
      `/app/records?execution=${RECORDS_EXECUTION_ID}&side=SELL&direction=SHORT`,
    );
    expect(await rowsOf('Orders')).toHaveLength(2);
    expect(calls('/orders').at(-1)).toEqual({ execution_id: RECORDS_EXECUTION_ID, side: 'SELL' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Instrument' }), {
      target: { value: INSTRUMENTS_FIXTURE[0]!.id },
    });
    await waitFor(() =>
      expect(calls('/orders').at(-1)).toEqual({
        execution_id: RECORDS_EXECUTION_ID,
        instrument_id: INSTRUMENTS_FIXTURE[0]!.id,
        side: 'SELL',
      }),
    );
    expect(screen.getByTestId('where')).toHaveTextContent(
      `instrument=${INSTRUMENTS_FIXTURE[0]!.id}`,
    );
    // Positions take a direction but no side: switching tabs keeps the run filter.
    await openTab('Positions');
    await waitFor(() =>
      expect(calls('/positions').at(-1)).toEqual({
        execution_id: RECORDS_EXECUTION_ID,
        instrument_id: INSTRUMENTS_FIXTURE[0]!.id,
      }),
    );
  });

  it('positions show the API values, and P&L headers explain the backend formulas', async () => {
    setup('/app/records?tab=positions');
    const rows = await rowsOf('Positions');
    RECORDS_POSITIONS.forEach((p, i) => {
      expect(rows[i]).toHaveTextContent(symbol(p.instrument_id));
      expect(rows[i]).toHaveTextContent(formatINR(p.realized_pnl));
      expect(rows[i]).toHaveTextContent(formatINR(p.unrealized_pnl));
      expect(rows[i]).toHaveTextContent(p.position_status === 'OPEN' ? 'Open' : 'Closed');
    });
    fireEvent.focus(screen.getByRole('button', { name: 'How Realised P&L is computed' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(FORMULAS.realized);
  });

  it('a row opens its chain: execution -> order -> trades, and the position', async () => {
    setup();
    const rows = await rowsOf('Orders');
    const sell = RECORDS_ORDERS.find(
      (o) => o.order_side === 'SELL' && symbol(o.instrument_id) === 'RELIANCE',
    )!;
    fireEvent.click(rows[RECORDS_ORDERS.indexOf(sell)]!);
    const drawer = await screen.findByRole('dialog');
    expect(screen.getByTestId('where')).toHaveTextContent(`record=order%3A${sell.id}`);
    const chain = await within(drawer).findByRole('list', { name: 'Relationship chain' });
    expect(within(chain).getByRole('link', { name: /Backtest results/ })).toHaveAttribute(
      'href',
      `/app/executions/${RECORDS_EXECUTION_ID}/results`,
    );
    const trade = RECORDS_TRADES.find((t) => t.order_id === sell.id)!;
    const tradeLink = await within(chain).findByRole('button', {
      name: new RegExp(`${trade.executed_quantity} @ ${trade.executed_price}`),
    });
    const position = RECORDS_POSITIONS.find((p) => p.instrument_id === sell.instrument_id)!;
    fireEvent.click(await within(chain).findByRole('button', { name: /Open RELIANCE/ }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`record=position%3A${position.id}`),
    );
    const positionDrawer = await screen.findByRole('dialog');
    expect(await within(positionDrawer).findByText(FORMULAS.unrealized)).toBeInTheDocument();
    expect(positionDrawer).toHaveTextContent(formatINR(position.unrealized_pnl));
    // and back to an order, then its trade, then its parent order
    fireEvent.click(
      await within(positionDrawer).findByRole('button', {
        name: new RegExp(`^SELL ${sell.quantity}`),
      }),
    );
    fireEvent.click(
      await within(await screen.findByRole('dialog')).findByRole('button', {
        name: tradeLink.textContent!,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`record=trade%3A${trade.id}`),
    );
    fireEvent.click(
      await within(await screen.findByRole('dialog')).findByRole('button', { name: /Open SELL/ }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`record=order%3A${sell.id}`),
    );
    // No maintenance without Advanced.
    expect(
      within(await screen.findByRole('dialog')).queryByRole('region', {
        name: 'Record maintenance',
      }),
    ).toBeNull();
  });

  it('advanced maintenance asks first, shows the 400 reason, and deletes once', async () => {
    const order = RECORDS_ORDERS[0]!;
    const { post, del } = setup(`/app/records?advanced=1&record=order:${order.id}`);
    // The page note (hidden behind the open drawer) and the drawer both say it.
    expect(screen.getByRole('note', { hidden: true })).toHaveTextContent(MAINTENANCE_LABEL);
    const drawer = await screen.findByRole('dialog');
    const tools = await within(drawer).findByRole('region', { name: 'Record maintenance' });
    expect(tools).toHaveTextContent(MAINTENANCE_LABEL);
    fireEvent.click(within(tools).getByRole('button', { name: 'Mark open' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Mark open' }));
    expect(await within(tools).findByRole('alert')).toHaveTextContent(RECORDS_REFUSED.detail);
    expect(post).toHaveBeenCalledWith('/orders/{order_id}/open', {
      params: { path: { order_id: order.id } },
    });
    fireEvent.click(within(tools).getByRole('button', { name: /Delete order/ }));
    const sure = await screen.findByRole('alertdialog');
    const yes = within(sure).getByRole('button', { name: 'Delete' });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/orders/{order_id}', {
      params: { path: { order_id: order.id } },
    });
  });

  it("another user's record id is not available", async () => {
    setup('/app/records?record=trade:00000000-0000-4000-8000-00000000abcd');
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByRole('alert')).toHaveTextContent(
      'belongs to another account',
    );
  });
});
