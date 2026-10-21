import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import { formatDateTime, formatINR } from '@/lib/format';
import { PaperAccountPanel } from './PaperTradingPage';
import {
  PAPER_ACCOUNT,
  PAPER_CHARGES,
  PAPER_FILLS,
  PAPER_HOLDINGS,
  PAPER_NO_FUNDS,
  PAPER_ORDERS,
  PAPER_PREVIEW,
  PAPER_QUOTES,
} from './paper-fixture';
import { buildOrderBody, emptyTicket, PAPER_LABEL } from './paper-model';

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

function setup(path = '/app/live?tab=account', opts: { placeStatus?: number } = {}) {
  vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    const answers: Record<string, unknown> = {
      '/paper/account': PAPER_ACCOUNT,
      '/paper/quotes': PAPER_QUOTES,
      '/paper/orders': PAPER_ORDERS,
      '/paper/holdings': PAPER_HOLDINGS,
      '/paper/fills': PAPER_FILLS,
      '/paper/charges': PAPER_CHARGES,
      '/instruments': INSTRUMENTS_FIXTURE,
    };
    if (url in answers) return respond(200, answers[url]);
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((url: string) => {
    if (url === '/paper/orders/preview') return respond(200, PAPER_PREVIEW);
    if (url === '/paper/orders')
      return opts.placeStatus === 422
        ? respond(422, PAPER_NO_FUNDS)
        : respond(
            201,
            PAPER_ORDERS.find((o) => o.status === 'FILLED'),
          );
    if (url === '/paper/account/reset') return respond(200, PAPER_ACCOUNT);
    throw new Error(`unexpected POST ${url}`);
  }) as never);
  const del = vi
    .spyOn(api, 'DELETE')
    .mockImplementation((() => respond(200, { ...PAPER_ORDERS[2], status: 'CANCELLED' })) as never);
  const put = vi.spyOn(api, 'PUT').mockImplementation((() => respond(200, PAPER_ACCOUNT)) as never);
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
            <Route path="/app/live" element={<PaperAccountPanel />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { post, del, put };
}

const tab = async (name: string) => {
  fireEvent.mouseDown(await screen.findByRole('tab', { name }), { button: 0 });
  return screen.findByRole('tabpanel', { name });
};

afterEach(() => vi.restoreAllMocks());

describe('Paper account (Live Trading (Paper) tab)', () => {
  it('shows the account exactly as returned, labelled paper with the price source', async () => {
    setup();
    expect(screen.getByText(PAPER_LABEL)).toBeInTheDocument();
    const summary = await screen.findByRole('region', { name: 'Account summary' });
    expect(summary).toHaveTextContent(`Equity${formatINR(PAPER_ACCOUNT.equity)}`);
    expect(summary).toHaveTextContent(`Available cash${formatINR(PAPER_ACCOUNT.available_cash)}`);
    expect(summary).toHaveTextContent(
      `${formatINR(PAPER_ACCOUNT.blocked_cash)} held for open buys`,
    );
    expect(summary).toHaveTextContent(`Total P&L${formatINR(PAPER_ACCOUNT.total_pnl)}`);
    expect(summary).toHaveTextContent(`Charges paid${formatINR(PAPER_ACCOUNT.total_charges)}`);
    const market = screen.getByRole('status', { name: 'Market status' });
    expect(market).toHaveTextContent('NSE market open');
    expect(market).toHaveTextContent(PAPER_ACCOUNT.price_source.note);
  });

  it('the watchlist shows each delayed quote with its time', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Watchlist instruments' });
    const reliance = within(list).getByRole('listitem', { name: 'RELIANCE' });
    const q = PAPER_QUOTES[0]!.quote!;
    expect(reliance).toHaveTextContent(formatINR(q.price));
    expect(reliance).toHaveTextContent('1.57%');
    expect(reliance).toHaveTextContent(`${formatDateTime(q.time)} \u00b7 18 min old`);
  });

  it('Buy opens a ticket; the estimate is the backend preview; placing sends the exact order', async () => {
    const { post } = setup();
    const list = await screen.findByRole('list', { name: 'Watchlist instruments' });
    fireEvent.click(
      within(within(list).getByRole('listitem', { name: 'RELIANCE' })).getByRole('button', {
        name: 'Buy',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Buy' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.change(within(dialog).getByLabelText(/Quantity/), { target: { value: '10' } });
    const estimate = await within(dialog).findByRole(
      'region',
      { name: 'Order estimate' },
      { timeout: 3000 },
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/paper/orders/preview', {
        body: {
          instrument_id: RELIANCE.id,
          side: 'BUY',
          order_type: 'MARKET',
          quantity: 10,
          price: null,
          trigger_price: null,
        },
      }),
    );
    expect(estimate).toHaveTextContent(
      `Estimated price${formatINR(PAPER_PREVIEW.estimated_price)}`,
    );
    expect(estimate).toHaveTextContent(`STT${formatINR(PAPER_PREVIEW.charges!.stt)}`);
    expect(estimate).toHaveTextContent(`Charges${formatINR(PAPER_PREVIEW.charges!.total)}`);
    expect(estimate).toHaveTextContent(
      `Estimated total cost${formatINR(PAPER_PREVIEW.estimated_total)}`,
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Place buy order' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(post).toHaveBeenCalledWith('/paper/orders', {
      body: {
        instrument_id: RELIANCE.id,
        side: 'BUY',
        order_type: 'MARKET',
        quantity: 10,
        price: null,
        trigger_price: null,
      },
    });
  });

  it("the backend's refusal is shown in the ticket", async () => {
    setup('/app/live?tab=account', { placeStatus: 422 });
    fireEvent.click(await screen.findByRole('button', { name: /New order/ }));
    const dialog = await screen.findByRole('dialog');
    const picker = within(dialog).getByRole('combobox', { name: /Instrument/ });
    await waitFor(() => expect(picker).not.toBeDisabled());
    fireEvent.change(picker, {
      target: { value: RELIANCE.id },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Place buy order' }));
    expect(await within(dialog).findByText(PAPER_NO_FUNDS.detail)).toBeInTheDocument();
  });

  it('checks the ticket before sending', () => {
    expect(buildOrderBody({ ...emptyTicket(RELIANCE.id), orderType: 'LIMIT' })).toEqual({
      ok: false,
      errors: { price: 'Enter a price above 0.' },
    });
    expect(
      buildOrderBody({
        ...emptyTicket(RELIANCE.id, 'SELL'),
        orderType: 'SL',
        price: '980',
        trigger: '970',
      }),
    ).toEqual({
      ok: false,
      errors: { trigger_price: 'For a sell SL the trigger must be at or above the price.' },
    });
    expect(buildOrderBody({ ...emptyTicket(''), quantity: '1.5' })).toEqual({
      ok: false,
      errors: {
        instrument_id: 'Choose an instrument.',
        quantity: 'Whole number from 1 to 10,00,000.',
      },
    });
    expect(
      buildOrderBody({
        ...emptyTicket(RELIANCE.id),
        orderType: 'SL_M',
        trigger: '1450',
        price: '9',
      }),
    ).toEqual({
      ok: true,
      body: {
        instrument_id: RELIANCE.id,
        side: 'BUY',
        order_type: 'SL_M',
        quantity: 1,
        price: null,
        trigger_price: 1450,
      },
    });
  });

  it('open orders list only live orders; the order book lists all; cancel asks first', async () => {
    const { del } = setup();
    const open = await screen.findByRole('table', { name: 'Open orders' });
    const live = PAPER_ORDERS.filter((o) => o.status === 'OPEN' || o.status === 'TRIGGER_PENDING');
    expect(within(open).getAllByRole('row').slice(1)).toHaveLength(live.length);
    expect(open).toHaveTextContent('Trigger pending');
    const nifty = live.find((o) => o.symbol === 'NIFTYBEES')!;
    fireEvent.click(
      within(open).getByRole('button', { name: `Cancel BUY ${nifty.quantity} NIFTYBEES` }),
    );
    const confirm = await screen.findByRole('alertdialog');
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel order' }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('/paper/orders/{order_id}', {
        params: { path: { order_id: nifty.id } },
      }),
    );
    const book = await tab('Order book');
    expect(within(book).getAllByRole('row').slice(1)).toHaveLength(PAPER_ORDERS.length);
    expect(book).toHaveTextContent('Cancelled');
    expect(book).toHaveTextContent(formatINR(1413.05));
    expect(screen.getByTestId('where')).toHaveTextContent('view=book');
  });

  it('holdings and fills show the backend values, with every charge', async () => {
    setup('/app/live?tab=account&view=holdings');
    const holdings = await screen.findByRole('table', { name: 'Holdings' });
    const h = PAPER_HOLDINGS[0]!;
    expect(holdings).toHaveTextContent(
      `${h.quantity}${formatINR(h.average_price)}${formatINR(h.last_price)}`,
    );
    expect(holdings).toHaveTextContent(formatINR(h.unrealised_pnl));
    fireEvent.click(within(holdings).getByRole('button', { name: 'Sell' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Sell' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const fills = await tab('Fills');
    const f = PAPER_FILLS[0]!;
    const row = within(fills).getAllByRole('row')[1]!;
    for (const v of [
      f.trade_value,
      f.charges.stt,
      f.charges.stamp_duty,
      f.charges.gst,
      f.total_charges,
      f.net_amount,
    ])
      expect(row).toHaveTextContent(formatINR(v));
  });

  it('settings show the charge rates and reset asks first', async () => {
    const { post } = setup('/app/live?tab=account&view=settings');
    const rates = await screen.findByRole('region', { name: 'How charges are calculated' });
    await within(rates).findByText(new RegExp(PAPER_CHARGES.rates[0]!.label.replace(/[()]/g, '.')));
    for (const r of PAPER_CHARGES.rates) expect(rates).toHaveTextContent(r.basis);
    fireEvent.click(screen.getByRole('button', { name: 'Reset account' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(post).not.toHaveBeenCalledWith('/paper/account/reset', expect.anything());
    fireEvent.click(within(confirm).getByRole('button', { name: 'Reset' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/paper/account/reset', {
        body: { initial_cash: 1000000 },
      }),
    );
  });
});
