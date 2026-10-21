import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import {
  RECORDS_COUNTS,
  RECORDS_COUNTS_EMPTY,
  RECORDS_EXECUTION_ID,
  RECORDS_EXECUTIONS,
  RECORDS_OLD_EXECUTION_ID,
  RECORDS_ORDERS,
  RECORDS_POSITIONS,
  RECORDS_STRATEGY,
  RECORDS_TRADES,
} from './records-fixture';
import { StoredRecords } from './StoredRecords';

const respond = (status: number, body: unknown) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

function setup(executionId: string) {
  let stored = executionId === RECORDS_EXECUTION_ID;
  vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/executions/{execution_id}/records')
      return respond(200, stored ? RECORDS_COUNTS : RECORDS_COUNTS_EMPTY);
    if (url === '/executions') return respond(200, RECORDS_EXECUTIONS);
    if (url === '/strategies') return respond(200, [RECORDS_STRATEGY]);
    if (url === '/instruments') return respond(200, INSTRUMENTS_FIXTURE);
    if (url === '/orders') return respond(200, RECORDS_ORDERS);
    if (url === '/trades') return respond(200, RECORDS_TRADES);
    if (url === '/positions') return respond(200, RECORDS_POSITIONS);
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation((() => {
    stored = true;
    return respond(201, RECORDS_COUNTS);
  }) as never);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <MemoryRouter>
          <StoredRecords executionId={executionId} />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { post };
}

afterEach(() => vi.restoreAllMocks());

describe('StoredRecords (results page)', () => {
  it('a stored run shows its counts, a drawer with its chain, and a link to Trading Records', async () => {
    setup(RECORDS_EXECUTION_ID);
    const panel = await screen.findByRole('region', { name: 'Trading records' });
    expect(
      await within(panel).findByText('4 orders, 4 trades, 2 positions stored.'),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /View in Trading Records/ })).toHaveAttribute(
      'href',
      `/app/records?execution=${RECORDS_EXECUTION_ID}`,
    );
    fireEvent.click(within(panel).getByRole('button', { name: 'Open records' }));
    const drawer = await screen.findByRole('dialog');
    const orders = await within(drawer).findByRole('region', { name: 'Orders and their trades' });
    expect(
      within(orders)
        .getAllByRole('listitem')
        .filter((li) => li.parentElement?.tagName === 'OL'),
    ).toHaveLength(RECORDS_ORDERS.length);
    expect(within(drawer).getByRole('region', { name: 'Positions' })).toHaveTextContent('RELIANCE');
  });

  it('an older run can store its records, once', async () => {
    const { post } = setup(RECORDS_OLD_EXECUTION_ID);
    const button = await screen.findByRole('button', { name: 'Store records' });
    fireEvent.click(button);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/executions/{execution_id}/records', {
      params: { path: { execution_id: RECORDS_OLD_EXECUTION_ID } },
    });
    expect(await screen.findByText('4 orders, 4 trades, 2 positions stored.')).toBeInTheDocument();
  });
});
