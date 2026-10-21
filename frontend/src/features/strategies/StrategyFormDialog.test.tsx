import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Strategy } from './queries';
import { REGISTRY_FIXTURE } from './registry-fixture';
import { StrategyFormDialog, type FormTarget } from './StrategyFormDialog';
import { VS_STRATEGIES } from '@/features/validation/validation-status-fixture';

// A strategy without a validation, as GET /strategies returns it.
const NOT_VALIDATED = VS_STRATEGIES.find(
  (s) => s.validation.status === 'NOT_VALIDATED',
)!.validation;

type Reply = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const respond = (reply: Reply) =>
  Promise.resolve({
    ...(reply.status < 300 ? { data: reply.body } : { error: reply.body }),
    response: new Response(null, { status: reply.status }),
  });

const SAVED: Strategy = {
  id: 's1',
  user_id: 'u1',
  name: 'Alpha',
  description: 'First',
  strategy_type: 'PYTHON',
  strategy_config: {
    parameters: { template: 'momentum', lookback: 50 },
    indicators: [],
    entry_conditions: [],
    exit_conditions: [],
  },
  python_code: null,
  version: 1,
  is_active: true,
  validation: NOT_VALIDATED,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
};

function setup(
  target: FormTarget,
  replies: { validate?: Reply; post?: Reply; patch?: Reply } = {},
) {
  vi.spyOn(api, 'GET').mockImplementation((() => respond(ok(REGISTRY_FIXTURE))) as never);
  const post = vi
    .spyOn(api, 'POST')
    .mockImplementation(((path: string) =>
      respond(
        path === '/strategies'
          ? (replies.post ?? ok({ ...SAVED, id: 'new-1' }, 201))
          : (replies.validate ?? ok({})),
      )) as never);
  const patch = vi
    .spyOn(api, 'PATCH')
    .mockImplementation((() => respond(replies.patch ?? ok(SAVED))) as never);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/app/strategies']}>
          <Routes>
            <Route
              path="/app/strategies"
              element={<StrategyFormDialog target={target} trigger={<Button>Open</Button>} />}
            />
            <Route path="/app/strategies/:id" element={<h1>Detail page</h1>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { post, patch };
}

/** Opens the dialog and waits until the form has loaded (it needs the registry). */
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('button', { name: 'Cancel' });
  return dialog;
}

/** Finds a control by its label; a required field's label ends with "*". */
const field = (dialog: HTMLElement, label: string) =>
  within(dialog).getByLabelText(new RegExp(`^${label}\\*?$`));
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const strategyCalls = (post: ReturnType<typeof setup>['post']) =>
  post.mock.calls.filter((c) => c[0] === '/strategies');

afterEach(() => vi.restoreAllMocks());

describe('StrategyFormDialog', () => {
  it('a core template creates a user copy with the registry defaults', async () => {
    const { post } = setup({ kind: 'new', templateKey: 'mean_reversion' });
    const dialog = await open();
    expect(field(dialog, 'Name')).toHaveValue('Mean Reversion (copy)');
    expect(field(dialog, 'entry_threshold')).toHaveValue('2');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create strategy' }));
    await screen.findByRole('heading', { name: 'Detail page' });

    expect(post).toHaveBeenCalledWith('/strategy-registry/{strategy_key}/validate', {
      params: { path: { strategy_key: 'mean_reversion' } },
      body: { parameters: { lookback: 20, entry_threshold: 2, exit_threshold: 0 } },
    });
    expect(strategyCalls(post)[0]![1]).toEqual({
      body: {
        name: 'Mean Reversion (copy)',
        description: null,
        strategy_type: 'PYTHON',
        strategy_config: {
          parameters: {
            template: 'mean_reversion',
            lookback: 20,
            entry_threshold: 2,
            exit_threshold: 0,
          },
          indicators: [],
          entry_conditions: [],
          exit_conditions: [],
        },
        python_code: null,
      },
    });
  });

  it('New strategy lets the user pick the template; fields follow the choice', async () => {
    setup({ kind: 'new' });
    const dialog = await open();
    expect(field(dialog, 'Name')).toHaveValue('');
    fireEvent.change(field(dialog, 'Core template'), { target: { value: 'volatility_arbitrage' } });
    expect(await within(dialog).findByLabelText('short_window')).toHaveValue('5');
    expect(within(dialog).queryByLabelText('lookback')).not.toBeInTheDocument();
  });

  it('checks types in the browser before calling the backend', async () => {
    const { post } = setup({ kind: 'new', templateKey: 'momentum' });
    const dialog = await open();
    type(field(dialog, 'Name'), '   ');
    type(field(dialog, 'lookback'), '2.5');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create strategy' }));
    expect(await within(dialog).findByText('Enter a name.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    type(field(dialog, 'Name'), 'Mine');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create strategy' }));
    expect(await within(dialog).findByText('Enter a whole number.')).toBeInTheDocument();
    expect(field(dialog, 'lookback')).toHaveAttribute('aria-invalid', 'true');
    expect(post).not.toHaveBeenCalled();
  });

  it("shows the backend's 422 under the parameter it is about", async () => {
    const { post } = setup(
      { kind: 'new', templateKey: 'volatility_arbitrage' },
      { validate: ok({ detail: 'short_window must be less than long_window.' }, 422) },
    );
    const dialog = await open();
    type(field(dialog, 'short_window'), '30');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create strategy' }));
    expect(
      await within(dialog).findByText('short_window must be less than long_window.'),
    ).toBeInTheDocument();
    expect(field(dialog, 'short_window')).toHaveAttribute('aria-invalid', 'true');
    expect(strategyCalls(post)).toHaveLength(0);
  });

  it('a 422 from saving shows under the name field', async () => {
    setup(
      { kind: 'new', templateKey: 'momentum' },
      {
        post: ok(
          { detail: [{ loc: ['body', 'name'], msg: 'String should have at most 100 characters' }] },
          422,
        ),
      },
    );
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create strategy' }));
    expect(
      await within(dialog).findByText('String should have at most 100 characters'),
    ).toBeInTheDocument();
    expect(field(dialog, 'Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('edit sends the changed fields and keeps the saved parameters', async () => {
    const { patch } = setup({ kind: 'edit', strategy: SAVED });
    const dialog = await open();
    expect(field(dialog, 'lookback')).toHaveValue('50');
    expect(within(dialog).getByText('Python (fixed when created)')).toBeInTheDocument();
    type(field(dialog, 'Name'), 'Alpha v2');
    type(field(dialog, 'lookback'), '60');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith('/strategies/{strategy_id}', {
      params: { path: { strategy_id: 's1' } },
      body: {
        name: 'Alpha v2',
        description: 'First',
        strategy_config: {
          parameters: { template: 'momentum', lookback: 60 },
          indicators: [],
          entry_conditions: [],
          exit_conditions: [],
        },
      },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('duplicate creates a copy named "(copy)" with the same type and values', async () => {
    const { post } = setup({ kind: 'duplicate', source: SAVED });
    const dialog = await open();
    expect(field(dialog, 'Name')).toHaveValue('Alpha (copy)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create strategy' }));
    await screen.findByRole('heading', { name: 'Detail page' });
    expect(strategyCalls(post)[0]![1]).toMatchObject({
      body: {
        name: 'Alpha (copy)',
        strategy_type: 'PYTHON',
        strategy_config: { parameters: { template: 'momentum', lookback: 50 } },
      },
    });
  });

  it('duplicating a Python strategy keeps its code', async () => {
    const code = 'def generate_signal(context):\n    return None\n';
    const { post } = setup({ kind: 'duplicate', source: { ...SAVED, python_code: code } });
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create strategy' }));
    await screen.findByRole('heading', { name: 'Detail page' });
    expect(strategyCalls(post)[0]![1]).toMatchObject({ body: { python_code: code } });
  });

  it('a strategy without a template keeps its config untouched', async () => {
    const plain = {
      ...SAVED,
      strategy_config: {
        parameters: { x: 1 },
        indicators: [],
        entry_conditions: [],
        exit_conditions: [],
      },
    };
    const { patch, post } = setup({ kind: 'edit', strategy: plain });
    const dialog = await open();
    expect(within(dialog).getByText(/not made from a core template/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![1]).toEqual({
      params: { path: { strategy_id: 's1' } },
      body: { name: 'Alpha', description: 'First' },
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('Cancel closes without saving', async () => {
    const { post, patch } = setup({ kind: 'edit', strategy: SAVED });
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
