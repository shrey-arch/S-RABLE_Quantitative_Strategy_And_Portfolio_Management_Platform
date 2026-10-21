import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { INDICATORS_FIXTURE } from './indicator-fixture';
import { IndicatorForm } from './IndicatorForm';
import IndicatorsPage from './IndicatorsPage';

const reply = (body: unknown, status = 200) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('IndicatorsPage', () => {
  it('shows every indicator from GET /indicators with its parameters, defaults and limits', async () => {
    const get = vi.spyOn(api, 'GET').mockImplementation((() => reply(INDICATORS_FIXTURE)) as never);
    wrap(<IndicatorsPage />);
    const cards = await screen.findAllByRole('heading', { level: 3 });
    expect(get).toHaveBeenCalledWith('/indicators');
    // Catalogue matches the backend schema: same keys, same order.
    expect(cards.map((h) => h.textContent)).toEqual(INDICATORS_FIXTURE.map((i) => i.name));

    for (const indicator of INDICATORS_FIXTURE) {
      const card = screen
        .getByRole('heading', { name: indicator.name })
        .closest('[data-slot="card"]') as HTMLElement;
      const list = within(card).getByRole('list', { name: `${indicator.name} parameters` });
      const items = within(list).getAllByRole('listitem');
      expect(items.map((li) => li.querySelector('.font-mono')!.textContent)).toEqual(
        indicator.parameters.map((p) => p.name),
      );
      indicator.parameters.forEach((p, i) => expect(items[i]).toHaveTextContent(p.description));
      expect(card).toHaveTextContent(indicator.key);
      expect(card).toHaveTextContent(indicator.outputs.join(', '));
    }
    const macd = screen
      .getByRole('heading', { name: /convergence divergence/ })
      .closest('[data-slot="card"]') as HTMLElement;
    expect(
      within(macd).getByText('Rule: fast_period must be less than slow_period.'),
    ).toBeInTheDocument();
    expect(within(macd).getByText('In its own panel')).toBeInTheDocument();
    const sma = screen
      .getByRole('heading', { name: 'Simple moving average' })
      .closest('[data-slot="card"]') as HTMLElement;
    expect(within(sma).getByText('Momentum')).toBeInTheDocument();
    expect(within(sma).getByRole('listitem')).toHaveTextContent(
      'Whole number \u00b7 greater than 0 \u00b7 required',
    );
  });

  it('shows an error when the catalogue cannot be loaded', async () => {
    vi.spyOn(api, 'GET').mockImplementation((() => reply({ detail: 'x' }, 500)) as never);
    wrap(<IndicatorsPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('IndicatorForm', () => {
  function setup(opts: { existing?: string[]; validate?: () => Promise<unknown> } = {}) {
    const post = vi.spyOn(api, 'POST').mockImplementation(
      (opts.validate ??
        ((
          _: string,
          init: {
            params: { path: { key: string } };
            body: { parameters: Record<string, number> };
          },
        ) => reply({ key: init.params.path.key, parameters: init.body.parameters }))) as never,
    );
    const onSave = vi.fn();
    wrap(
      <IndicatorForm
        catalogue={INDICATORS_FIXTURE}
        existingNames={opts.existing}
        onSave={onSave}
      />,
    );
    return { post, onSave };
  }

  it('offers exactly the backend types, in order', () => {
    setup();
    const options = within(screen.getByLabelText('Type')).getAllByRole('option');
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(
      INDICATORS_FIXTURE.map((i) => i.key),
    );
  });

  it('fills defaults for the chosen type and sends numbers to the backend check', async () => {
    const { post, onSave } = setup();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'MACD' } });
    expect(screen.getByLabelText('fast_period')).toHaveValue('12');
    expect(screen.getByLabelText('slow_period')).toHaveValue('26');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'macd_main' } });
    fireEvent.change(screen.getByLabelText('fast_period'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save indicator' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: 'macd_main',
        type: 'MACD',
        parameters: { fast_period: 8, slow_period: 26, signal_period: 9 },
      }),
    );
    expect(post).toHaveBeenCalledWith('/indicators/{key}/validate', {
      params: { path: { key: 'MACD' } },
      body: { parameters: { fast_period: 8, slow_period: 26, signal_period: 9 } },
    });
  });

  it('checks the name and the limits before calling the backend', () => {
    const { post } = setup({ existing: ['sma_fast'] });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'sma_fast' } });
    fireEvent.change(screen.getByLabelText(/^window/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save indicator' }));
    expect(
      screen.getByText('Another indicator in this strategy already has this name.'),
    ).toBeInTheDocument();
    expect(screen.getByText('window must be greater than 0.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^window/)).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText(/^window/), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save indicator' }));
    expect(screen.getByText('window must be a whole number.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("shows the backend's 422 under the parameter it names", async () => {
    const { onSave } = setup({
      validate: () => reply({ detail: 'fast_period must be less than slow_period.' }, 422),
    });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'MACD' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'm' } });
    fireEvent.change(screen.getByLabelText('fast_period'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save indicator' }));
    expect(
      await screen.findByText('fast_period must be less than slow_period.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('fast_period')).toHaveAttribute('aria-invalid', 'true');
    expect(onSave).not.toHaveBeenCalled();
  });
});
