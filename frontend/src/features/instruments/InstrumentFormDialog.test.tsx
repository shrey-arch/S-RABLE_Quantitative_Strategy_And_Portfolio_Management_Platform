import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { instrument } from './instrument-fixture';
import { InstrumentFormDialog } from './InstrumentFormDialog';
import type { Instrument } from './queries';

type Reply = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const respond = (reply: Reply) =>
  Promise.resolve({
    ...(reply.status < 300 ? { data: reply.body } : { error: reply.body }),
    response: new Response(null, { status: reply.status }),
  });

function setup(
  target: { kind: 'new' } | { kind: 'edit'; instrument: Instrument },
  reply: Reply = ok(instrument(), 201),
) {
  const post = vi.spyOn(api, 'POST').mockImplementation((() => respond(reply)) as never);
  const patch = vi.spyOn(api, 'PATCH').mockImplementation((() => respond(reply)) as never);
  const onSaved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InstrumentFormDialog target={target} trigger={<Button>Open</Button>} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  return { post, patch, onSaved, dialog: screen.getByRole('dialog') };
}

const field = (dialog: HTMLElement, label: string) =>
  within(dialog).getByLabelText(new RegExp(`^${label}\\*?$`));
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

function fillRequired(dialog: HTMLElement) {
  type(field(dialog, 'Symbol'), 'TCS');
  type(field(dialog, 'Trading symbol'), 'TCS-EQ');
  type(field(dialog, 'Name'), 'Tata Consultancy Services');
}

afterEach(() => vi.restoreAllMocks());

describe('InstrumentFormDialog', () => {
  it('adds an instrument with the backend defaults', async () => {
    const { post, onSaved, dialog } = setup({ kind: 'new' });
    fillRequired(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add instrument' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/instruments', {
      body: {
        symbol: 'TCS',
        trading_symbol: 'TCS-EQ',
        name: 'Tata Consultancy Services',
        exchange: 'NSE',
        instrument_type: 'EQUITY',
        isin: null,
        lot_size: 1,
        tick_size: 0.05,
        is_active: true,
      },
    });
  });

  it('checks fields before sending', async () => {
    const { post, dialog } = setup({ kind: 'new' });
    type(field(dialog, 'Lot size'), '0');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add instrument' }));
    expect(await within(dialog).findByText('Enter the symbol.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a whole number of 1 or more.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('a 409 duplicate shows under the trading symbol', async () => {
    const { dialog } = setup(
      { kind: 'new' },
      ok({ detail: 'An instrument with this trading symbol already exists.' }, 409),
    );
    fillRequired(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add instrument' }));
    expect(
      await within(dialog).findByText('An instrument with this trading symbol already exists.'),
    ).toBeInTheDocument();
    expect(field(dialog, 'Trading symbol')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a 422 shows under the field it names', async () => {
    const { dialog } = setup(
      { kind: 'new' },
      ok(
        { detail: [{ loc: ['body', 'isin'], msg: 'String should have at most 20 characters' }] },
        422,
      ),
    );
    fillRequired(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add instrument' }));
    expect(
      await within(dialog).findByText('String should have at most 20 characters'),
    ).toBeInTheDocument();
    expect(field(dialog, 'ISIN')).toHaveAttribute('aria-invalid', 'true');
  });

  it('edit shows the saved values and sends only changes', async () => {
    const { patch, onSaved, dialog } = setup(
      { kind: 'edit', instrument: instrument() },
      ok(instrument({ name: 'RIL' })),
    );
    expect(field(dialog, 'Trading symbol')).toHaveValue('RELIANCE-EQ');
    type(field(dialog, 'Name'), 'RIL');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/instruments/{instrument_id}', {
      params: { path: { instrument_id: instrument().id } },
      body: { name: 'RIL' },
    });
  });

  it('saving an unchanged edit sends nothing', async () => {
    const { patch, dialog } = setup({ kind: 'edit', instrument: instrument() });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patch).not.toHaveBeenCalled();
  });
});
