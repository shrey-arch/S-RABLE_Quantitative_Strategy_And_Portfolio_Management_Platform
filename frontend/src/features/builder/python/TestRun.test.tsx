import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  buildTestRun,
  emptyTestRun,
  parseParameters,
  signalMarkers,
  testRunSummary,
  TEST_RUN_CASH,
} from './sandbox-model';
import {
  SBX_INSTRUMENTS,
  SBX_REFERENCE,
  SBX_REFUSED,
  SBX_TEST_RUN,
  SBX_TEST_RUN_FAILED,
} from './sandbox-fixture';
import { TestRunPanel } from './TestRunPanel';

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

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function setup(run: Reply = { status: 200, body: SBX_TEST_RUN }) {
  vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/instruments') return respond({ status: 200, body: SBX_INSTRUMENTS });
    if (url === '/sandbox/reference') return respond({ status: 200, body: SBX_REFERENCE });
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation((() => respond(run)) as never);
  const goToLine = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <MemoryRouter>
          <TestRunPanel strategyId="s1" onGoToLine={goToLine} />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { post, goToLine };
}

async function fillAndRun() {
  const instrument = await screen.findByLabelText('Instrument');
  // The picker's options come from GET /instruments; wait for them.
  await waitFor(() => expect(within(instrument).getAllByRole('option').length).toBeGreaterThan(1));
  fireEvent.change(instrument, { target: { value: SBX_INSTRUMENTS[0]!.id } });
  fireEvent.click(screen.getByRole('button', { name: /Test run/ }));
}

afterEach(() => vi.restoreAllMocks());

describe('sandbox-model', () => {
  it('reads parameters written one per line', () => {
    expect(
      parseParameters('lookback = 20\n# a note\nband = 1.5\nmode = fast\nloud = true'),
    ).toEqual({
      ok: true,
      value: { lookback: 20, band: 1.5, mode: 'fast', loud: true },
    });
    expect(parseParameters('')).toEqual({ ok: true, value: {} });
    const bad = parseParameters('lookback 20');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('Line 1');
    const named = parseParameters('2bad = 1');
    expect(named.ok).toBe(false);
  });

  it('checks the form before asking the backend', () => {
    const empty = buildTestRun(emptyTestRun());
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(Object.keys(empty.errors)).toEqual(['instrument_id']);

    const bad = buildTestRun({ ...emptyTestRun(), instrumentId: 'i1', quantity: '0' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.quantity).toContain('whole number');

    const ok = buildTestRun({
      instrumentId: 'i1',
      bars: 200,
      quantity: '10',
      parameters: 'lookback = 20',
    });
    expect(ok).toEqual({
      ok: true,
      body: {
        instrument_id: 'i1',
        bars: 200,
        quantity: 10,
        cash: TEST_RUN_CASH,
        parameters: { lookback: 20 },
      },
    });
  });

  it('summarises a real run and marks every position change', () => {
    const changes = SBX_TEST_RUN.signals.filter((s) => s.changed);
    expect(testRunSummary(SBX_TEST_RUN)).toBe(
      `${SBX_TEST_RUN.signals.length} bars, ` +
        `${SBX_TEST_RUN.signals.filter((s) => s.action !== 'HOLD').length} signals, ` +
        `${changes.length} position changes`,
    );
    const markers = signalMarkers(SBX_TEST_RUN);
    expect(markers).toHaveLength(changes.length);
    // The side is the trade the change needs: buying increases the position.
    let held = 0;
    for (const [index, signal] of changes.entries()) {
      expect(markers[index]!.side).toBe(signal.position > held ? 'BUY' : 'SELL');
      held = signal.position;
    }
  });
});

describe('the test run panel', () => {
  it('runs the saved code and shows the signals, logs and the sandbox used', async () => {
    const { post } = setup();
    await fillAndRun();
    const summary = await screen.findByTestId('test-run-summary');
    expect(summary).toHaveTextContent(SBX_TEST_RUN.symbol);
    expect(summary).toHaveTextContent(testRunSummary(SBX_TEST_RUN));
    expect(post).toHaveBeenCalledWith('/strategies/{strategy_id}/test-run', {
      params: { path: { strategy_id: 's1' } },
      body: {
        instrument_id: SBX_INSTRUMENTS[0]!.id,
        bars: 200,
        quantity: 10,
        cash: TEST_RUN_CASH,
        parameters: {},
      },
    });

    const chart = screen.getByRole('img', { name: /test run/ });
    expect(chart).toHaveAttribute('data-bar-count', String(SBX_TEST_RUN.bars.length));
    expect(chart).toHaveAttribute(
      'data-marker-count',
      String(SBX_TEST_RUN.signals.filter((s) => s.changed).length),
    );

    // The logs the code wrote are shown against their bars.
    const list = screen.getByRole('list', { name: 'Signals and logs' });
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(list).toHaveTextContent('average=');

    expect(screen.getByTestId('sandbox-kind')).toHaveTextContent(
      /Guarded process|Docker container/,
    );
    expect(screen.getByText(/not stored/)).toBeVisible();
  });

  it('shows where the code failed and offers to go to the line', async () => {
    const { goToLine } = setup({ status: 200, body: SBX_TEST_RUN_FAILED });
    await fillAndRun();
    const error = SBX_TEST_RUN_FAILED.error!;
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`at line ${error.line}`);
    expect(alert).toHaveTextContent(error.exception!);
    expect(alert).toHaveTextContent(error.message!);
    fireEvent.click(screen.getByRole('button', { name: `Go to line ${error.line}` }));
    expect(goToLine).toHaveBeenCalledWith(error.line);
  });

  it('shows the refusal from the static check with its line', async () => {
    setup({ status: 422, body: { detail: SBX_REFUSED } });
    await fillAndRun();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('refused before it ran');
    expect(alert).toHaveTextContent(SBX_REFUSED.message!);
    expect(alert).toHaveTextContent(`at line ${SBX_REFUSED.line}`);
  });

  it('asks for an instrument before running', async () => {
    const { post } = setup();
    await screen.findByLabelText('Instrument');
    fireEvent.click(screen.getByRole('button', { name: /Test run/ }));
    await waitFor(() => expect(screen.getByText('Choose an instrument.')).toBeVisible());
    expect(post).not.toHaveBeenCalled();
  });
});
