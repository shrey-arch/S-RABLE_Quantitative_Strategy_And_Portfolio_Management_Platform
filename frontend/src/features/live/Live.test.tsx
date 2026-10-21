import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { notificationLink } from '@/features/notifications/notification-model';
import type { Notification } from '@/features/notifications/notification-model';
import { formatINR, formatPercent } from '@/lib/format';
import { candlesOf, tailUpdates } from './live-chart-data';
import {
  LIVE_ACCOUNT,
  LIVE_CREATED,
  LIVE_DONE,
  LIVE_DONE_BARS,
  LIVE_DONE_EVENTS,
  LIVE_DONE_FILLS,
  LIVE_INSTRUMENTS,
  LIVE_REFUSED,
  LIVE_REGISTRY,
  LIVE_REPLAY_DAYS,
  LIVE_RUNNING,
  LIVE_RUNNING_BARS,
  LIVE_RUNNING_EVENTS,
  LIVE_RUNNING_FILLS,
  LIVE_SESSIONS,
  LIVE_STATUS,
  LIVE_STRATEGIES,
  LIVE_STREAM,
} from './live-fixture';
import {
  ageTone,
  buildSessionBody,
  emptySession,
  equityPoints,
  filterEvents,
  LIVE_LABEL,
  mergeBar,
  mergeEvents,
  parseSse,
  type FormingBar,
  type LiveBar,
  type LiveFill,
} from './live-model';
import LiveSessionPage from './LiveSessionPage';
import LiveTradingPage from './LiveTradingPage';
import NewLiveSessionPage from './NewLiveSessionPage';

// jsdom has no canvas; the stand-ins expose exactly what each chart is given.
vi.mock('./LiveChart', () => ({
  LiveChart: (p: {
    bars: LiveBar[];
    forming: FormingBar | null;
    fills: LiveFill[];
    label: string;
  }) => (
    <div
      role="img"
      aria-label={p.label}
      data-bars={p.bars.length}
      data-forming={p.forming ? `${p.forming.minutes}/${p.forming.of}` : ''}
      data-markers={p.fills.length}
      data-last-close={p.bars.at(-1)?.close}
    />
  ),
  EquityLine: (p: { points: { value: number }[]; capital: number; label: string }) => (
    <div
      role="img"
      aria-label={p.label}
      data-points={p.points.length}
      data-last={p.points.at(-1)?.value}
    />
  ),
}));

const stream = vi.hoisted(() => ({ state: 'idle', forming: null as unknown }));
vi.mock('./useLiveStream', () => ({ useLiveStream: () => stream }));

type Reply = [number, unknown];
const respond = ([status, body]: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const RUN = LIVE_RUNNING.id;
const DONE = LIVE_DONE.id;

function setup(path: string, opts: { create?: Reply } = {}) {
  vi.spyOn(api, 'GET').mockImplementation(((
    url: string,
    init?: { params?: { path?: { session_id?: string } } },
  ) => {
    const id = init?.params?.path?.session_id;
    const pick = (run: unknown, done: unknown): Reply =>
      id === RUN
        ? [200, run]
        : id === DONE
          ? [200, done]
          : [404, { detail: 'Live session not found.' }];
    if (url === '/live/sessions') return respond([200, LIVE_SESSIONS]);
    if (url === '/live/sessions/{session_id}') return respond(pick(LIVE_RUNNING, LIVE_DONE));
    if (url === '/live/sessions/{session_id}/bars')
      return respond(pick(LIVE_RUNNING_BARS, LIVE_DONE_BARS));
    if (url === '/live/sessions/{session_id}/events')
      return respond(pick(LIVE_RUNNING_EVENTS, LIVE_DONE_EVENTS));
    if (url === '/live/sessions/{session_id}/fills')
      return respond(pick(LIVE_RUNNING_FILLS, LIVE_DONE_FILLS));
    if (url === '/live/status') return respond([200, LIVE_STATUS]);
    if (url === '/live/replay-days') return respond([200, LIVE_REPLAY_DAYS]);
    if (url === '/strategies') return respond([200, LIVE_STRATEGIES]);
    if (url === '/strategy-registry') return respond([200, LIVE_REGISTRY]);
    if (url === '/instruments') return respond([200, LIVE_INSTRUMENTS]);
    if (url === '/paper/account') return respond([200, LIVE_ACCOUNT]);
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((url: string) => {
    if (url === '/live/sessions') return respond(opts.create ?? [201, LIVE_CREATED]);
    if (url === '/live/sessions/{session_id}/stop')
      return respond([200, { ...LIVE_RUNNING, stop_requested: 'SQUARE_OFF' }]);
    if (url === '/live/sessions/{session_id}/pause')
      return respond([200, { ...LIVE_RUNNING, status: 'PAUSED' }]);
    if (url === '/live/stop-all') return respond([200, { stopping: 1 }]);
    throw new Error(`unexpected POST ${url}`);
  }) as never);
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
            <Route path="/app/live" element={<LiveTradingPage />} />
            <Route path="/app/live/new" element={<NewLiveSessionPage />} />
            <Route path="/app/live/sessions/:id" element={<LiveSessionPage />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { post };
}

beforeEach(() => {
  stream.state = 'idle';
  stream.forming = null;
});
afterEach(() => vi.restoreAllMocks());

describe('live-model', () => {
  it('reads the real event stream: every log event once, in order, then the end', () => {
    const { messages, rest } = parseSse(LIVE_STREAM);
    expect(rest).toBe('');
    const logged = messages.filter((m) => m.id !== null);
    expect(logged.map((m) => m.id)).toEqual(LIVE_DONE_EVENTS.map((e) => e.id));
    expect(logged.map((m) => m.event)).toEqual(LIVE_DONE_EVENTS.map((e) => e.kind.toLowerCase()));
    expect(messages[0]!.event).toBe('status');
    expect(messages.at(-1)).toEqual({ event: 'end', id: null, data: { status: 'COMPLETED' } });
    expect(messages.filter((m) => m.event === 'snapshot')).toHaveLength(1);
    // The same messages however the text is cut into chunks.
    let buffer = '';
    const chunked = [];
    for (let i = 0; i < LIVE_STREAM.length; i += 997) {
      const r = parseSse(buffer + LIVE_STREAM.slice(i, i + 997));
      buffer = r.rest;
      chunked.push(...r.messages);
    }
    expect(chunked).toEqual(messages);
    expect(parseSse(': heartbeat\n\n').messages).toEqual([]);
  });

  it('merges stream events and bars once each', () => {
    const half = LIVE_DONE_EVENTS.slice(0, 100);
    expect(mergeEvents(half, LIVE_DONE_EVENTS.slice(50))).toEqual(LIVE_DONE_EVENTS);
    expect(mergeEvents(half, half)).toBe(half);
    const bars = LIVE_DONE_BARS.bars.slice(0, 10);
    expect(mergeBar(bars, LIVE_DONE_BARS.bars[10]!)).toEqual(LIVE_DONE_BARS.bars.slice(0, 11));
    const changed = { ...bars[9]!, close: 1 };
    expect(mergeBar(bars, changed).at(-1)).toEqual(changed);
    // The stream writes times as +00:00, the REST endpoints as Z: still one bar.
    const streamed = { ...bars[9]!, time: bars[9]!.time.replace('Z', '+00:00'), close: 2 };
    expect(mergeBar(bars, streamed)).toHaveLength(10);
    expect(mergeBar(bars, streamed).at(-1)).toEqual({ ...bars[9]!, close: 2 });
    expect(candlesOf([...bars, streamed], null)).toHaveLength(10);
  });

  it('filters the log; the equity line is the EQUITY events', () => {
    expect(filterEvents(LIVE_DONE_EVENTS, 'orders')).toHaveLength(LIVE_DONE_FILLS.length);
    expect(filterEvents(LIVE_DONE_EVENTS, 'all').some((e) => e.kind === 'EQUITY')).toBe(false);
    const eq = equityPoints(LIVE_DONE_EVENTS);
    expect(eq).toHaveLength(LIVE_DONE_EVENTS.filter((e) => e.kind === 'EQUITY').length);
  });

  it('the data-age dot follows the timeframe and the backend status', () => {
    const s = { status: 'RUNNING' as const, timeframe: '5M', data_age_seconds: 120 };
    expect(ageTone(s)).toBe('fresh');
    expect(ageTone({ ...s, data_age_seconds: 400 })).toBe('late');
    expect(ageTone({ ...s, data_age_seconds: 1200 })).toBe('stale');
    expect(ageTone({ ...s, status: 'STALE' })).toBe('stale');
    expect(ageTone({ ...s, data_age_seconds: null })).toBe('none');
    expect(ageTone({ ...LIVE_RUNNING })).toBe('fresh');
  });

  it('checks the form like the backend and builds the request', () => {
    const empty = buildSessionBody(emptySession(), 1000);
    expect(empty.ok).toBe(false);
    if (!empty.ok)
      expect(Object.keys(empty.errors).sort()).toEqual([
        'capital',
        'instrument_id',
        'replay_date',
        'strategy_id',
      ]);
    const ok = buildSessionBody(
      {
        ...emptySession(),
        strategyId: 's',
        instrumentId: 'i',
        replayDate: '2026-10-16',
        maxPositionValue: '',
      },
      951864.28,
    );
    expect(ok).toEqual({
      ok: true,
      body: {
        strategy_id: 's',
        instrument_id: 'i',
        name: null,
        timeframe: '5M',
        mode: 'REPLAY',
        replay_date: '2026-10-16',
        speed: 5,
        capital: 200000,
        quantity: 10,
        slippage_bps: 5,
        loss_limit_pct: 2,
        max_position_value: null,
      },
    });
  });

  it('the chart sends only the changed candles while a bar forms and closes', () => {
    const bars = LIVE_RUNNING_BARS.bars;
    const forming = LIVE_RUNNING_BARS.forming!;
    const before = candlesOf(bars, forming);
    expect(before).toHaveLength(bars.length + 1);
    const moved = candlesOf(bars, { ...forming, close: forming.close + 1, high: forming.high + 1 });
    expect(tailUpdates(before, moved)).toEqual([moved.at(-1)]);
    const closed = { ...forming, close: forming.close + 2 };
    const next = { ...forming, time: '2026-10-16T05:50:00Z', minutes: 1 };
    const after = candlesOf([...bars, closed], next);
    expect(tailUpdates(before, after)).toHaveLength(2);
    expect(tailUpdates(before, candlesOf(bars.slice(1), forming))).toBeNull();
    expect(tailUpdates([], before)).toBeNull();
  });

  it('a live notification opens its session', () => {
    const n = {
      execution_id: RUN,
      execution_type: 'LIVE',
      notification_data: { event: 'LIVE_SESSION', session_id: RUN },
    } as unknown as Notification;
    expect(notificationLink(n)).toEqual({
      to: `/app/live/sessions/${RUN}`,
      label: 'Open live session',
    });
  });
});

describe('Live Trading (Paper)', () => {
  it('lists the sessions as returned; Stop all asks first', async () => {
    const { post } = setup('/app/live');
    expect(screen.getByRole('heading', { level: 1, name: 'Live Trading (Paper)' })).toBeVisible();
    expect(screen.getByText(LIVE_LABEL)).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Live sessions' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(LIVE_SESSIONS.length);
    for (const s of LIVE_SESSIONS) {
      const row = rows.find((r) => r.textContent!.includes(s.name))!;
      expect(row).toHaveTextContent(formatINR(s.money.net_pnl));
      expect(within(row).getByRole('link', { name: s.name })).toHaveAttribute(
        'href',
        `/app/live/sessions/${s.id}`,
      );
    }
    expect(await screen.findByTestId('market-line')).toHaveTextContent('NSE is closed');
    expect(screen.getByText('1 of at most 3 sessions running.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop all and square off' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/live/stop-all'));
  });

  it('the tabs hold the paper account, deployments and performance', async () => {
    setup('/app/live');
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Paper account' }), { button: 0 });
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/app/live?tab=account'),
    );
  });
});

describe('a finished session', () => {
  it('shows the stored summary, the day of bars, its fills and the log', async () => {
    setup(`/app/live/sessions/${DONE}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: `Live session: ${LIVE_DONE.name}` }),
    ).toBeVisible();
    expect(screen.getByTestId('session-clock')).toHaveTextContent(LIVE_DONE.clock.label);
    expect(screen.getByTestId('status-reason')).toHaveTextContent('The session ended at 15:30.');
    const sum = LIVE_DONE.summary as Record<string, number>;
    const summary = screen.getByRole('region', { name: 'Session summary' });
    expect(summary).toHaveTextContent(`Net P&L${formatINR(sum.net_pnl)}`);
    expect(summary).toHaveTextContent(`Closed trades${sum.closed_trades}`);
    expect(summary).toHaveTextContent(`Win rate${formatPercent(sum.win_rate)}`);
    expect(summary).toHaveTextContent(`Charges${formatINR(sum.charges)}`);
    const chart = await screen.findByRole('img', { name: /5M bars/ });
    expect(chart).toHaveAttribute('data-bars', String(LIVE_DONE_BARS.bars.length));
    expect(chart).toHaveAttribute('data-markers', String(LIVE_DONE_FILLS.length));
    expect(chart).toHaveAttribute('data-forming', '');
    const fills = await screen.findByRole('table', { name: 'Session fills' });
    expect(within(fills).getAllByRole('row').slice(1)).toHaveLength(LIVE_DONE_FILLS.length);
    expect(fills).toHaveTextContent('Auto square-off at 15:20 (intraday)');
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
    const log = screen.getByRole('region', { name: 'Event log' });
    fireEvent.click(within(log).getByRole('button', { name: 'Orders' }));
    expect(within(log).getAllByRole('listitem')).toHaveLength(LIVE_DONE_FILLS.length);
    const equity = screen.getByRole('img', { name: 'Session equity' });
    expect(equity).toHaveAttribute(
      'data-last',
      String(equityPoints(LIVE_DONE_EVENTS).at(-1)!.value),
    );
  });

  it('an unknown session says so', async () => {
    setup('/app/live/sessions/nope');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Not available');
    expect(screen.getByRole('heading', { level: 1, name: 'Live session' })).toBeVisible();
  });
});

describe('a running session', () => {
  it('shows the clock, the forming bar, position, P&L and risk exactly as returned', async () => {
    stream.state = 'open';
    stream.forming = LIVE_RUNNING_BARS.forming;
    setup(`/app/live/sessions/${RUN}`);
    expect(await screen.findByTestId('session-clock')).toHaveTextContent(
      'Replay of 16 Oct 2026 \u00b7 10x',
    );
    expect(screen.getByTestId('data-age-dot')).toHaveAttribute('data-tone', 'fresh');
    expect(screen.getByTestId('stream-state')).toHaveTextContent('Live updates on');
    const f = LIVE_RUNNING_BARS.forming!;
    const chart = await screen.findByRole('img', { name: /5M bars/ });
    expect(chart).toHaveAttribute('data-forming', `${f.minutes}/${f.of}`);
    expect(chart).toHaveAttribute('data-bars', String(LIVE_RUNNING_BARS.bars.length));
    expect(screen.getByTestId('forming-note')).toHaveTextContent(`${f.minutes} of ${f.of} minutes`);
    const tiles = screen.getByRole('region', { name: 'Position and P&L' });
    const m = LIVE_RUNNING.money;
    expect(tiles).toHaveTextContent(
      `Position${LIVE_RUNNING.position_qty > 0 ? 'Long' : 'Short'} ${Math.abs(LIVE_RUNNING.position_qty)}`,
    );
    expect(tiles).toHaveTextContent(`Equity${formatINR(m.equity)}`);
    expect(tiles).toHaveTextContent(`Unrealised P&L${formatINR(m.unrealised_pnl)}`);
    expect(tiles).toHaveTextContent(`Charges${formatINR(m.charges)}`);
    const r = LIVE_RUNNING.risk;
    const risk = screen.getByRole('region', { name: 'Risk limits' });
    expect(risk).toHaveTextContent(`${formatINR(r.loss)} of ${formatINR(r.loss_limit)}`);
    expect(risk).toHaveTextContent(
      `${formatINR(r.position_value)} of ${formatINR(r.position_limit)}`,
    );
    expect(within(risk).getByRole('meter', { name: 'Position value' })).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(r.position_used! * 100)),
    );
  });

  it('Stop offers square off now or at 15:20', async () => {
    const { post } = setup(`/app/live/sessions/${RUN}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stop this session?' });
    expect(dialog).toHaveTextContent(`position of ${Math.abs(LIVE_RUNNING.position_qty)} RELIANCE`);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop, square off at 15:20' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/live/sessions/{session_id}/stop', {
        params: { path: { session_id: RUN } },
        body: { square_off: false },
      }),
    );
  });
});

describe('a new session', () => {
  it('only offers runnable strategies and recorded days; Review, then start', async () => {
    const { post } = setup('/app/live/new');
    const strategy = await screen.findByLabelText('Strategy');
    const options = within(strategy)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Choose a strategy', 'Intraday momentum']);
    expect(await screen.findByRole('radio', { name: /Delayed live/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Replay/ })).toBeChecked();
    fireEvent.change(strategy, {
      target: { value: LIVE_STRATEGIES.find((s) => s.name === 'Intraday momentum')!.id },
    });
    fireEvent.change(screen.getByLabelText('Instrument'), {
      target: { value: LIVE_INSTRUMENTS[0]!.id },
    });
    const day = screen.getByLabelText('Recorded day');
    await waitFor(() =>
      expect(within(day).getAllByRole('option')).toHaveLength(LIVE_REPLAY_DAYS.length + 1),
    );
    fireEvent.change(day, { target: { value: '2026-10-16' } });
    fireEvent.change(screen.getByLabelText('Speed'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Shares per position'), { target: { value: '50' } });
    expect(
      await screen.findByText(
        `The paper account has ${formatINR(LIVE_ACCOUNT.available_cash)} available.`,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const review = await screen.findByRole('region', { name: 'Review' });
    expect(review).toHaveTextContent('Replay of 16 Oct 2026 from 09:15 at 10x');
    expect(review).toHaveTextContent('2% of the capital: square off and pause');
    expect(review).toHaveTextContent(LIVE_LABEL);
    fireEvent.click(within(review).getByRole('button', { name: 'Start session' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/live/sessions', {
        body: expect.objectContaining({
          mode: 'REPLAY',
          replay_date: '2026-10-16',
          speed: 10,
          quantity: 50,
          capital: 200000,
        }),
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        `/app/live/sessions/${LIVE_CREATED.id}`,
      ),
    );
  });

  it('a refusal from the backend is shown on the Review', async () => {
    setup('/app/live/new', { create: [422, LIVE_REFUSED] });
    fireEvent.change(await screen.findByLabelText('Strategy'), {
      target: { value: LIVE_STRATEGIES.find((s) => s.name === 'Intraday momentum')!.id },
    });
    fireEvent.change(screen.getByLabelText('Instrument'), {
      target: { value: LIVE_INSTRUMENTS[0]!.id },
    });
    const day = screen.getByLabelText('Recorded day');
    await waitFor(() => expect(within(day).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(day, { target: { value: '2026-10-16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(LIVE_REFUSED.detail);
  });
});
