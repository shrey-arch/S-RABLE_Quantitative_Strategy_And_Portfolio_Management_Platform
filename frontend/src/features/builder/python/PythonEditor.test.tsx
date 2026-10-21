import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { INDICATORS_FIXTURE } from '@/features/indicators/indicator-fixture';
import BuilderPage from '../BuilderPage';
import { EMPTY_CONFIG, PYTHON_TEMPLATE } from './python-template';
import { SBX_INSTRUMENTS, SBX_REFERENCE } from './sandbox-fixture';

// CodeMirror needs a real browser layout; here a plain textarea stands in for it.
// The real editor is covered by the browser tests (tests/e2e/builder.spec.ts).
vi.mock('./CodeEditor', () => ({
  CodeEditor: (props: {
    value: string;
    onChange: (v: string) => void;
    label: string;
    describedBy?: string;
    invalid?: boolean;
    errorLine?: number | null;
  }) => (
    <textarea
      aria-label={props.label}
      aria-describedby={props.describedBy}
      aria-invalid={props.invalid}
      data-error-line={props.errorLine ?? ''}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}));

// jsdom has no canvas; the chart stand-in exposes what it was given.
vi.mock('@/features/instruments/PriceChart', () => ({
  PriceChart: (props: { bars: unknown[]; markers?: unknown[]; label: string }) => (
    <div
      role="img"
      aria-label={props.label}
      data-bar-count={props.bars.length}
      data-marker-count={props.markers?.length ?? 0}
    />
  ),
}));

type Reply = { status: number; body: unknown };
const respond = ({ status, body }: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

const CODE = 'def generate_signal(context):\n    return None\n';

const saved = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  user_id: 'u1',
  name: 'My Python',
  description: 'Mine',
  strategy_type: 'PYTHON',
  strategy_config: EMPTY_CONFIG,
  python_code: CODE,
  version: 3,
  is_active: true,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
  ...over,
});

function Detail() {
  return <h1>Detail {useParams().id}</h1>;
}

function setup(path: string, save?: Reply) {
  vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/indicators') return respond({ status: 200, body: INDICATORS_FIXTURE });
    if (url === '/instruments') return respond({ status: 200, body: SBX_INSTRUMENTS });
    if (url === '/sandbox/reference') return respond({ status: 200, body: SBX_REFERENCE });
    return respond({ status: 200, body: saved() });
  }) as never);
  const post = vi
    .spyOn(api, 'POST')
    .mockImplementation(((_: string, init: { body: Record<string, unknown> }) =>
      respond(save ?? { status: 201, body: saved({ ...init.body, id: 'new-1' }) })) as never);
  const patch = vi
    .spyOn(api, 'PATCH')
    .mockImplementation((() => respond(save ?? { status: 200, body: saved() })) as never);
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
  return { post, patch };
}

const code = () => screen.findByRole('textbox', { name: 'Python code' });

afterEach(() => vi.restoreAllMocks());

describe('Python editor', () => {
  it('starts from the template that shows the generate_signal(context) contract', async () => {
    setup('/app/builder/new?type=python');
    expect(await code()).toHaveValue(PYTHON_TEMPLATE);
    expect(PYTHON_TEMPLATE).toMatch(/^def generate_signal\(context\):$/m);
    expect(PYTHON_TEMPLATE).toContain('generate_signal(context) -> StrategySignal');
    const kinds = screen.getByRole('navigation', { name: 'Kind of strategy' });
    expect(within(kinds).getByRole('link', { name: /Python/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(kinds).getByRole('link', { name: /No code/ })).toHaveAttribute(
      'href',
      '/app/builder/new',
    );
  });

  it('says the code runs in a sandbox, and offers a test run only once saved', async () => {
    setup('/app/builder/new?type=python');
    await code();
    expect(screen.getByText(/runs in an isolated sandbox/)).toBeVisible();
    // Unsaved: the backend runs the saved code, so there is nothing to test yet.
    expect(screen.getByText('Save the strategy to test it')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Backtest it' })).toBeNull();
  });

  it('a saved strategy can be test-run, backtested and validated', async () => {
    setup('/app/builder/s1');
    await code();
    expect(screen.getByRole('link', { name: 'Backtest it' })).toHaveAttribute(
      'href',
      '/app/backtests/new?strategy=s1',
    );
    expect(screen.getByRole('link', { name: 'Validate it' })).toHaveAttribute(
      'href',
      '/app/validation/new?strategy=s1',
    );
    expect(screen.getByRole('button', { name: /Test run/ })).toBeEnabled();
  });

  it('the reference panel lists what the backend allows', async () => {
    setup('/app/builder/s1');
    await code();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /What the code can use/ }), { button: 0 });
    const panel = await screen.findByRole('tabpanel', { name: /What the code can use/ });
    // The reference comes from the backend, so wait for it.
    await within(panel).findByRole('region', { name: 'What the code is given' });
    expect(panel).toHaveTextContent('generate_signal(context)');
    for (const entry of SBX_REFERENCE.context_api as Record<string, string>[]) {
      expect(panel).toHaveTextContent(String(entry.signature));
    }
    for (const rule of SBX_REFERENCE.rules) expect(panel).toHaveTextContent(rule);
    for (const limit of SBX_REFERENCE.limits as Record<string, string>[]) {
      expect(panel).toHaveTextContent(String(limit.value));
    }
  });

  it('creates a PYTHON strategy with the code and an empty StrategyConfig', async () => {
    const { post } = setup('/app/builder/new?type=python');
    fireEvent.change(await code(), { target: { value: CODE } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: ' Breakout ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create strategy/ }));
    await screen.findByRole('heading', { name: 'Detail new-1' });
    expect(post).toHaveBeenCalledWith('/strategies', {
      body: {
        name: 'Breakout',
        description: null,
        strategy_type: 'PYTHON',
        strategy_config: EMPTY_CONFIG,
        python_code: CODE,
      },
    });
  });

  it('needs a name and some code before anything is sent', async () => {
    const { post } = setup('/app/builder/new?type=python');
    fireEvent.change(await code(), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Create strategy/ }));
    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    expect(screen.getByText('Write the strategy code first.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("shows the backend's syntax error and keeps the code", async () => {
    setup('/app/builder/new?type=python', {
      status: 422,
      body: {
        detail: [
          { loc: ['body'], msg: 'Value error, Python syntax error on line 3: invalid syntax.' },
        ],
      },
    });
    fireEvent.change(await code(), { target: { value: 'def generate_signal(:\n' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Bad' } });
    fireEvent.click(screen.getByRole('button', { name: /Create strategy/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The backend did not save the strategy:');
    expect(alert).toHaveTextContent('Python syntax error on line 3: invalid syntax.');
    expect(screen.getByRole('textbox', { name: 'Python code' })).toHaveValue(
      'def generate_signal(:\n',
    );
    expect(screen.getByRole('textbox', { name: 'Python code' })).toHaveAccessibleDescription(
      /Python syntax error on line 3/,
    );
  });

  it('edits a saved Python strategy and PATCHes only name, description and code', async () => {
    const { patch } = setup('/app/builder/s1');
    expect(await code()).toHaveValue(CODE);
    expect(screen.getByText(/Saved as version 3/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Kind of strategy' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Python code' }), {
      target: { value: `${CODE}# v4\n` },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }));
    await screen.findByRole('heading', { name: 'Detail s1' });
    expect(patch).toHaveBeenCalledWith('/strategies/{strategy_id}', {
      params: { path: { strategy_id: 's1' } },
      body: { name: 'My Python', description: 'Mine', python_code: `${CODE}# v4\n` },
    });
  });

  it('"Start from the template" puts the template back', async () => {
    setup('/app/builder/s1');
    await code();
    fireEvent.click(screen.getByRole('button', { name: /Start from the template/ }));
    expect(screen.getByRole('textbox', { name: 'Python code' })).toHaveValue(PYTHON_TEMPLATE);
  });
});
