import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { formatINR } from '@/lib/format';
import PortfoliosPage from './PortfoliosPage';
import { PORTFOLIO_LIST } from './portfolio-fixture';
import { MESSAGES } from './portfolio-model';

const respond = (status: number, body: unknown) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

function setup(list: unknown = PORTFOLIO_LIST) {
  vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/portfolio/accounts') return respond(200, list);
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((url: string, init: { body: object }) => {
    if (url !== '/portfolio/accounts') throw new Error(`unexpected POST ${url}`);
    return respond(201, { ...PORTFOLIO_LIST[1], ...init.body, id: 'new-id' });
  }) as never);
  function Where() {
    return <div data-testid="where">{useLocation().pathname}</div>;
  }
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/app/portfolios']}>
        <Routes>
          <Route path="/app/portfolios" element={<PortfoliosPage />} />
          <Route path="/app/portfolios/:id" element={<p>detail</p>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { post };
}

afterEach(() => vi.restoreAllMocks());

describe('PortfoliosPage', () => {
  it('lists each portfolio with the values the API returns, all simulated', async () => {
    setup();
    const table = await screen.findByRole('table', { name: 'Your portfolios' });
    const rows = within(table).getAllByRole('row').slice(1);
    PORTFOLIO_LIST.forEach((p, i) => {
      expect(rows[i]).toHaveTextContent(p.name);
      for (const v of [p.initial_capital, p.cash, p.invested_value, p.total_equity])
        expect(rows[i]).toHaveTextContent(formatINR(v));
      expect(within(rows[i]!).getByRole('link', { name: p.name })).toHaveAttribute(
        'href',
        `/app/portfolios/${p.id}`,
      );
      expect(rows[i]).toHaveTextContent('Simulated');
    });
    expect(screen.getByText(/Simulated \u2014 no real orders/)).toBeInTheDocument();
  });

  it('with no portfolios offers to create one', async () => {
    setup([]);
    expect(await screen.findByText('No portfolios yet')).toBeInTheDocument();
  });

  it('creating checks the form, sends it once and opens the new portfolio', async () => {
    const { post } = setup();
    await screen.findByRole('table', { name: 'Your portfolios' });
    fireEvent.click(screen.getAllByRole('button', { name: /New portfolio/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create portfolio' }));
    expect(await within(dialog).findByText(MESSAGES.name)).toBeInTheDocument();
    expect(within(dialog).getByText(MESSAGES.positive)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: /Name/ }), {
      target: { value: 'Growth' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Initial capital/ }), {
      target: { value: '250000' },
    });
    const create = within(dialog).getByRole('button', { name: 'Create portfolio' });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(await screen.findByText('detail')).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/portfolio/accounts', {
      body: { name: 'Growth', description: null, initial_capital: '250000' },
    });
    expect(screen.getByTestId('where')).toHaveTextContent('/app/portfolios/new-id');
  });
});
