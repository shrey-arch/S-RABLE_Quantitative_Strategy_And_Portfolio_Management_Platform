import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { INDICATORS_FIXTURE } from '@/features/indicators/indicator-fixture';
import BuilderPage from './BuilderPage';

type Reply = { status: number; body: unknown };
const respond = ({ status, body }: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

const SAVED_CONFIG = {
  parameters: { quantity: 10 },
  indicators: [{ name: 'sma_20', type: 'SMA', parameters: { window: 20 } }],
  entry_conditions: [
    {
      left: { type: 'indicator', name: 'sma_20', output: 'value' },
      operator: '<',
      right: { type: 'price', field: 'close' },
    },
  ],
  exit_conditions: [],
};

const strategy = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  user_id: 'u1',
  name: 'My rules',
  description: 'Saved',
  strategy_type: 'NO_CODE',
  strategy_config: SAVED_CONFIG,
  python_code: null,
  version: 2,
  is_active: true,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
  ...over,
});

function Detail() {
  return <h1>Detail {useParams().id}</h1>;
}

function setup(path: string, opts: { saved?: unknown; save?: Reply } = {}) {
  const get = vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/indicators') return respond({ status: 200, body: INDICATORS_FIXTURE });
    if (url === '/strategies/{strategy_id}')
      return respond({ status: 200, body: opts.saved ?? strategy() });
    return respond({ status: 200, body: [] });
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((url: string, init: never) => {
    const body = (init as { body: Record<string, unknown> }).body;
    if (url === '/indicators/{key}/validate') {
      const key = (init as { params: { path: { key: string } } }).params.path.key;
      return respond({ status: 200, body: { key, parameters: body.parameters } });
    }
    return respond(opts.save ?? { status: 201, body: strategy({ ...body, id: 'new-1' }) });
  }) as never);
  const patch = vi
    .spyOn(api, 'PATCH')
    .mockImplementation((() => respond(opts.save ?? { status: 200, body: strategy() })) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/builder/new" element={<BuilderPage />} />
          <Route path="/app/builder/:id" element={<BuilderPage />} />
          <Route path="/app/strategies/:id" element={<Detail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { get, post, patch };
}

const next = () => fireEvent.click(screen.getByRole('button', { name: /Next/ }));
const stepHeading = (title: string) =>
  screen.findByRole('heading', { level: 2, name: new RegExp(`: ${title}$`) });
const goTo = (title: string) =>
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Builder steps' })).getByRole('button', {
      name: new RegExp(title),
    }),
  );
const select = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });
const strategyCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => c[0] === '/strategies');

afterEach(() => vi.restoreAllMocks());

describe('BuilderPage (no-code builder)', () => {
  it('builds a strategy in six steps and saves exactly the config it shows', async () => {
    const { post } = setup('/app/builder/new');
    await screen.findByRole('heading', { level: 1, name: 'Strategy Builder' });
    await screen.findByRole('navigation', { name: 'Builder steps' });

    // 1. Basics
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'SMA dip' },
    });
    next();

    // 2. Parameters
    await stepHeading('Parameters');
    fireEvent.click(screen.getByRole('button', { name: /Add parameter/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Parameter 1 name' }), {
      target: { value: 'quantity' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Parameter 1 value' }), {
      target: { value: '10' },
    });
    next();

    // 3. Indicators: checked by POST /indicators/{key}/validate before it is added
    await stepHeading('Indicators');
    fireEvent.click(screen.getByRole('button', { name: /Add indicator/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'sma_20' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /window/ }), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add indicator' }));
    const list = await screen.findByRole('list', { name: 'Indicators in this strategy' });
    await within(list).findByText('sma_20');
    expect(post).toHaveBeenCalledWith('/indicators/{key}/validate', {
      params: { path: { key: 'SMA' } },
      body: { parameters: { window: 20 } },
    });
    next();

    // 4. Entry: sma_20 < close
    await stepHeading('Entry conditions');
    fireEvent.click(screen.getByRole('button', { name: /Add entry condition/ }));
    select('Entry condition 1 right kind', 'price');
    next();

    // 5. Exit: close > sma_20
    await stepHeading('Exit conditions');
    fireEvent.click(screen.getByRole('button', { name: /Add exit condition/ }));
    select('Exit condition 1 left kind', 'price');
    select('Exit condition 1 operator', '>');
    select('Exit condition 1 right kind', 'indicator');
    next();

    // 6. Review
    await stepHeading('Review');
    expect(screen.getByText('Enter when sma_20 < close.')).toBeInTheDocument();
    expect(screen.getByText('Exit when close > sma_20.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No problems found');
    const expected = {
      parameters: { quantity: 10 },
      indicators: [{ name: 'sma_20', type: 'SMA', parameters: { window: 20 } }],
      entry_conditions: [
        {
          left: { type: 'indicator', name: 'sma_20', output: 'value' },
          operator: '<',
          right: { type: 'price', field: 'close' },
        },
      ],
      exit_conditions: [
        {
          left: { type: 'price', field: 'close' },
          operator: '>',
          right: { type: 'indicator', name: 'sma_20', output: 'value' },
        },
      ],
    };
    const json = screen.getByLabelText('Configuration JSON');
    expect(JSON.parse(json.textContent ?? '')).toEqual(expected);

    fireEvent.click(screen.getByRole('button', { name: /Create strategy/ }));
    await screen.findByRole('heading', { name: 'Detail new-1' });
    expect(strategyCalls(post)[0]![1]).toEqual({
      body: {
        name: 'SMA dip',
        description: null,
        strategy_type: 'NO_CODE',
        strategy_config: expected,
      },
    });
  });

  it('offers only the five contract operators, and price, indicator or number operands', async () => {
    setup('/app/builder/s1');
    await screen.findByRole('navigation', { name: 'Builder steps' });
    goTo('Entry conditions');
    const operator = await screen.findByRole('combobox', { name: 'Entry condition 1 operator' });
    expect(
      within(operator)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual(['<', '<=', '>', '>=', '==']);
    const kind = screen.getByRole('combobox', { name: 'Entry condition 1 left kind' });
    expect(
      within(kind)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual(['price', 'indicator', 'value']);
  });

  it('loads a saved strategy and PATCHes it with the edited config', async () => {
    const { patch } = setup('/app/builder/s1');
    await screen.findByText(/version 2/);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('My rules');
    goTo('Entry conditions');
    select('Entry condition 1 operator', '>=');
    goTo('Review');
    fireEvent.click(await screen.findByRole('button', { name: /Save changes/ }));
    await screen.findByRole('heading', { name: 'Detail s1' });
    expect(patch).toHaveBeenCalledWith('/strategies/{strategy_id}', {
      params: { path: { strategy_id: 's1' } },
      body: {
        name: 'My rules',
        description: 'Saved',
        strategy_config: {
          ...SAVED_CONFIG,
          entry_conditions: [{ ...SAVED_CONFIG.entry_conditions[0], operator: '>=' }],
        },
      },
    });
  });

  it('an undefined indicator reference is caught in the browser and nothing is sent', async () => {
    const { patch } = setup('/app/builder/s1');
    await screen.findByText(/version 2/);
    goTo('Indicators');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove sma_20' }));
    goTo('Entry conditions');
    expect(
      await screen.findByText('sma_20 is not defined. Add it in Indicators, or choose another.'),
    ).toBeInTheDocument();
    goTo('Review');
    fireEvent.click(await screen.findByRole('button', { name: /Save changes/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Fix these before saving');
    expect(alert).toHaveTextContent('sma_20 is not defined');
    expect(screen.queryByLabelText('Configuration JSON')).not.toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it("shows the backend's 422 reason when it refuses the save", async () => {
    setup('/app/builder/s1', {
      save: {
        status: 422,
        body: {
          detail: [
            {
              loc: ['body', 'strategy_config'],
              msg: 'Value error, Unknown indicator reference: sma_20',
            },
          ],
        },
      },
    });
    await screen.findByText(/version 2/);
    goTo('Review');
    fireEvent.click(await screen.findByRole('button', { name: /Save changes/ }));
    const alert = await screen.findByText('The backend did not save the strategy:');
    expect(alert.parentElement).toHaveTextContent('Unknown indicator reference: sma_20');
    expect(screen.getByRole('heading', { level: 1, name: 'Edit strategy' })).toBeInTheDocument();
  });

  it('renaming an indicator keeps its conditions pointing at it', async () => {
    setup('/app/builder/s1');
    await screen.findByText(/version 2/);
    goTo('Indicators');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit sma_20' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'sma_fast' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save indicator' }));
    await screen.findByText('sma_fast');
    goTo('Review');
    expect(await screen.findByText('Enter when sma_fast < close.')).toBeInTheDocument();
  });

  it('a strategy made from a core template is not opened in the builder', async () => {
    setup('/app/builder/s1', {
      saved: strategy({
        strategy_type: 'PYTHON',
        strategy_config: { ...SAVED_CONFIG, parameters: { template: 'momentum' } },
      }),
    });
    expect(await screen.findByText(/was not made in the no-code builder/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the strategy' })).toHaveAttribute(
      'href',
      '/app/strategies/s1',
    );
    expect(screen.queryByRole('navigation', { name: 'Builder steps' })).not.toBeInTheDocument();
  });

  it('a missing or foreign strategy shows not available', async () => {
    vi.spyOn(api, 'GET').mockImplementation(((url: string) =>
      url === '/indicators'
        ? respond({ status: 200, body: INDICATORS_FIXTURE })
        : respond({ status: 404, body: { detail: 'Strategy not found.' } })) as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/app/builder/x']}>
          <Routes>
            <Route path="/app/builder/:id" element={<BuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText('This strategy does not exist, or it belongs to another account.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: 'Builder steps' })).not.toBeInTheDocument(),
    );
  });
});
