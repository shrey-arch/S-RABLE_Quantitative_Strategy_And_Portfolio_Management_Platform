import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE, instrument } from './instrument-fixture';
import InstrumentsPage from './InstrumentsPage';

type Reply = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const respond = (reply: Reply) =>
  Promise.resolve({
    ...(reply.status < 300 ? { data: reply.body } : { error: reply.body }),
    response: new Response(null, { status: reply.status }),
  });

function setup(
  opts: { list?: () => Reply; post?: () => Reply; patch?: () => Reply } = {},
  url = '/app/instruments',
) {
  const get = vi
    .spyOn(api, 'GET')
    .mockImplementation((() => respond((opts.list ?? (() => ok(INSTRUMENTS_FIXTURE)))())) as never);
  const post = vi
    .spyOn(api, 'POST')
    .mockImplementation((() => respond((opts.post ?? (() => ok(instrument(), 201)))())) as never);
  const patch = vi
    .spyOn(api, 'PATCH')
    .mockImplementation((() => respond((opts.patch ?? (() => ok(instrument())))())) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <InstrumentsPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { get, post, patch };
}

const table = () => screen.findByRole('table', { name: 'Instruments' });
const bodyRows = (t: HTMLElement) => within(t).getAllByRole('row').slice(1);

afterEach(() => vi.restoreAllMocks());

describe('InstrumentsPage', () => {
  it('lists every instrument with its fields, from GET /instruments', async () => {
    const { get } = setup();
    const rows = bodyRows(await table());
    expect(get).toHaveBeenCalledWith('/instruments');
    expect(rows).toHaveLength(3);
    const reliance = rows.find((r) => r.textContent?.includes('RELIANCE-EQ'))!;
    expect(reliance).toHaveTextContent('Reliance Industries');
    expect(reliance).toHaveTextContent('NSE');
    expect(reliance).toHaveTextContent('Equity');
    expect(reliance).toHaveTextContent('INE002A01018');
    expect(reliance).toHaveTextContent('0.05');
    expect(within(reliance).getByRole('link', { name: 'RELIANCE' })).toHaveAttribute(
      'href',
      '/app/instruments/31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2',
    );
    const gold = rows.find((r) => r.textContent?.includes('GOLDM'))!;
    expect(gold).toHaveTextContent('MCX');
    expect(within(gold).getByRole('switch', { name: 'Active: GOLDM' })).not.toBeChecked();
  });

  it('filters by exchange, type and status', async () => {
    setup();
    await table();
    fireEvent.change(screen.getByRole('combobox', { name: 'Exchange' }), {
      target: { value: 'MCX' },
    });
    expect(bodyRows(await table())).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Exchange' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'ETF' } });
    expect(bodyRows(await table()).map((r) => r.textContent)).toEqual([
      expect.stringContaining('NIFTYBEES'),
    ]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
      target: { value: 'inactive' },
    });
    expect(bodyRows(await table()).map((r) => r.textContent)).toEqual([
      expect.stringContaining('GOLDM'),
    ]);
  });

  it('reads filters from the address', async () => {
    setup({}, '/app/instruments?status=active&type=EQUITY');
    expect(bodyRows(await table())).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('active');
  });

  it('says when filters hide everything, and when there is nothing at all', async () => {
    setup({}, '/app/instruments?exchange=BSE');
    expect(await screen.findByText('No instruments match these filters')).toBeInTheDocument();
  });

  it('shows the empty state with no instruments', async () => {
    setup({ list: () => ok([]) });
    expect(await screen.findByText('No instruments yet')).toBeInTheDocument();
  });

  it('the switch sends only is_active and the list is reloaded', async () => {
    let active = false;
    const { get, patch } = setup({
      list: () => ok([INSTRUMENTS_FIXTURE[2]!].map((i) => ({ ...i, is_active: active }))),
      patch: () => {
        active = true;
        return ok({ ...INSTRUMENTS_FIXTURE[2]!, is_active: true });
      },
    });
    fireEvent.click(await screen.findByRole('switch', { name: 'Active: GOLDM' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/instruments/{instrument_id}', {
        params: { path: { instrument_id: INSTRUMENTS_FIXTURE[2]!.id } },
        body: { is_active: true },
      }),
    );
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Active: GOLDM' })).toBeChecked(),
    );
  });

  it('shows an error with retry when the list fails', async () => {
    setup({ list: () => ok({ detail: 'boom' }, 500) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
