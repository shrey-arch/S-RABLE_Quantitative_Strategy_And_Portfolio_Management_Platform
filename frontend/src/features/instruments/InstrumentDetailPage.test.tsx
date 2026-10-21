import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChartOverlay } from '@/features/indicators/overlays';
import { INDICATORS_FIXTURE } from '@/features/indicators/indicator-fixture';
import type { Bar } from './market-data';
import { instrument } from './instrument-fixture';
import InstrumentDetailPage from './InstrumentDetailPage';
import { coverage, importResult, MARKET_DATA_FIXTURE, rowsBetween } from './market-data-fixture';

// jsdom has no canvas; the stand-in exposes exactly what the page passes to the chart.
vi.mock('./PriceChart', () => ({
  PriceChart: (p: { bars: Bar[]; mode: string; label: string; overlays?: ChartOverlay[] }) => (
    <div
      role="img"
      aria-label={p.label}
      data-mode={p.mode}
      data-bars={JSON.stringify(p.bars)}
      data-overlays={JSON.stringify(p.overlays ?? [])}
    />
  ),
}));

type Reply = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Reply => ({ status, body });
const respond = (reply: Reply) =>
  Promise.resolve({
    ...(reply.status < 300 ? { data: reply.body } : { error: reply.body }),
    response: new Response(null, { status: reply.status }),
  });

type Query = { start_date?: string; end_date?: string };
type SeriesBody = { parameters: Record<string, number>; start_date?: string; end_date?: string };

/** A stand-in series: one point per stored bar in the range, value = close + 1 (warm-up: first is null). */
const seriesFromRows = (key: string, body: SeriesBody): Reply =>
  ok({
    instrument_id: '31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2',
    key,
    panel: key === 'RSI' ? 'separate' : 'price',
    parameters: body.parameters,
    outputs: ['value'],
    points: rowsBetween(body.start_date, body.end_date).map((r, i) => ({
      timestamp: r.timestamp,
      values: { value: i === 0 ? null : r.close + 1 },
    })),
  });
interface Opts {
  instrument?: () => Reply;
  rows?: (q: Query) => Reply;
  coverage?: (q: Query) => Reply;
  importReply?: () => Reply;
  seriesReply?: (key: string, body: SeriesBody) => Reply;
  deleteReply?: () => Reply;
}

function setup(opts: Opts = {}, url = '/app/instruments/31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2') {
  const get = vi.spyOn(api, 'GET').mockImplementation(((
    path: string,
    init?: { params?: { query?: Query } },
  ) => {
    const q = init?.params?.query ?? {};
    if (path === '/instruments/{instrument_id}')
      return respond((opts.instrument ?? (() => ok(instrument())))());
    if (path === '/instruments/{instrument_id}/market-data')
      return respond((opts.rows ?? ((x: Query) => ok(rowsBetween(x.start_date, x.end_date))))(q));
    if (path === '/instruments/{instrument_id}/market-data/coverage')
      return respond((opts.coverage ?? (() => ok(coverage())))(q));
    if (path === '/indicators') return respond(ok(INDICATORS_FIXTURE));
    return respond(ok([]));
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((
    path: string,
    init: { params: { path: { key?: string } }; body: SeriesBody },
  ) => {
    if (path === '/instruments/{instrument_id}/indicators/{key}') {
      return respond((opts.seriesReply ?? seriesFromRows)(init.params.path.key!, init.body));
    }
    return respond((opts.importReply ?? (() => ok(importResult())))());
  }) as never);
  const del = vi
    .spyOn(api, 'DELETE')
    .mockImplementation((() => respond((opts.deleteReply ?? (() => ok(null, 204)))())) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/app/instruments/:id" element={<InstrumentDetailPage />} />
            <Route path="/app/instruments" element={<p>Instrument list</p>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { get, post, del };
}

const chartBars = async () =>
  JSON.parse((await screen.findByRole('img')).getAttribute('data-bars')!) as Bar[];
const callsTo = (spy: { mock: { calls: unknown[][] } }, path: string) =>
  spy.mock.calls
    .filter((c) => c[0] === path)
    .map((c) => (c[1] as { params: { query?: Query } }).params);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T06:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('InstrumentDetailPage', () => {
  it('shows the instrument metadata and labels the data as historical daily data', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'RELIANCE' })).toBeInTheDocument();
    expect(screen.getByText('Reliance Industries')).toBeInTheDocument();
    expect(screen.getByText('RELIANCE-EQ')).toBeInTheDocument();
    expect(screen.getByText('INE002A01018')).toBeInTheDocument();
    expect(
      screen.getByText('Historical \u00b7 daily \u00b7 source: Yahoo Finance'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
  });

  it('draws exactly the rows the API returned, in order', async () => {
    const { get } = setup();
    const bars = await chartBars();
    expect(bars).toEqual(
      MARKET_DATA_FIXTURE.map((r) => ({
        time: r.timestamp.slice(0, 10),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      })),
    );
    expect(callsTo(get, '/instruments/{instrument_id}/market-data')[0]).toEqual({
      path: { instrument_id: '31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2' },
      query: { timeframe: '1D' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show data table (6 rows)' }));
    const rows = within(screen.getByRole('table', { name: 'Daily bars' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows).toHaveLength(6);
    expect(rows[2]).toHaveTextContent('1,356.40');
  });

  it('sends a sampled range from the address and charts only its rows', async () => {
    const { get } = setup(
      {},
      '/app/instruments/31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2?from=2026-10-06&to=2026-10-08',
    );
    const bars = await chartBars();
    expect(bars.map((b) => b.time)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08']);
    expect(bars).toHaveLength(rowsBetween('2026-10-06', '2026-10-08').length);
    expect(callsTo(get, '/instruments/{instrument_id}/market-data')[0]!.query).toEqual({
      timeframe: '1D',
      start_date: '2026-10-06',
      end_date: '2026-10-08',
    });
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-06');
    expect(screen.getByLabelText('To')).toHaveValue('2026-10-08');
  });

  it('changing the dates requests the new range', async () => {
    const { get } = setup();
    await chartBars();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-09' } });
    await waitFor(() =>
      expect(callsTo(get, '/instruments/{instrument_id}/market-data').at(-1)!.query).toEqual({
        timeframe: '1D',
        start_date: '2026-10-09',
      }),
    );
    await waitFor(async () => expect(await chartBars()).toHaveLength(2));
  });

  it('shows a message instead of an empty chart when the range has no data', async () => {
    setup(
      {
        coverage: (q) =>
          ok(
            q.start_date
              ? coverage({ row_count: 0, first_timestamp: null, last_timestamp: null })
              : coverage(),
          ),
      },
      '/app/instruments/31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2?from=2026-09-01&to=2026-09-30',
    );
    expect(await screen.findByText('No data for this range')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(await screen.findByText('No data to check in this range.')).toBeInTheDocument();
  });

  it('does not send a range whose end is in the future', async () => {
    const { get } = setup(
      {},
      '/app/instruments/31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2?to=2026-12-31',
    );
    expect(await screen.findByText('The end date cannot be in the future.')).toBeInTheDocument();
    await chartBars();
    for (const p of callsTo(get, '/instruments/{instrument_id}/market-data')) {
      expect(p.query).toEqual({ timeframe: '1D' });
    }
  });

  it('shows coverage and the quality flags from the backend', async () => {
    setup({
      coverage: () =>
        ok(
          coverage({
            trading_days: {
              ...coverage().trading_days,
              closed_days_with_data: ['2026-10-02'],
            },
          }),
        ),
    });
    const panel = (await screen.findByText('Data coverage')).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    expect(within(panel).getByText('Trading days in range').nextSibling).toHaveTextContent('7');
    expect(within(panel).getByText('Trading days missing').nextSibling).toHaveTextContent('1');
    expect(within(panel).getByText('Provider').nextSibling).toHaveTextContent('Yahoo Finance');
    expect(within(panel).getByText(/13 Oct 2026/)).toBeInTheDocument();
    const warnings = within(
      screen.getByRole('list', { name: 'Data quality warnings' }),
    ).getAllByRole('listitem');
    expect(warnings.map((w) => w.textContent)).toEqual([
      '1 day with zero volume.',
      expect.stringContaining('Data on 1 day the NSE calendar marks as closed: 02 Oct 2026'),
    ]);
  });

  it('lists a few missing periods, all on request, and flags unknown holidays', async () => {
    const periods = Array.from({ length: 12 }, (_, i) => {
      const day = `2020-03-${String(i + 2).padStart(2, '0')}`;
      return { start: day, end: day, days: 1 };
    });
    const note =
      'NSE holidays are listed only for 2026. For 2020 every weekday counts as a trading day, so exchange holidays there show as missing.';
    setup({
      coverage: () =>
        ok(
          coverage({
            trading_days: {
              ...coverage().trading_days,
              missing_days: 12,
              missing_periods: periods,
              note,
            },
          }),
        ),
    });
    const panel = (await screen.findByText('Data coverage')).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    expect(within(panel).getByText('may include holidays')).toBeInTheDocument();
    expect(within(panel).getByText(note)).toBeInTheDocument();
    const list = () => within(panel).getAllByRole('listitem');
    expect(list()).toHaveLength(8);
    fireEvent.click(within(panel).getByRole('button', { name: 'Show all 12 listed periods' }));
    expect(list()).toHaveLength(12);
  });

  it('imports a date range and shows what was stored', async () => {
    const { post, get } = setup();
    await chartBars();
    expect(screen.getByLabelText('Import from')).toHaveValue('2026-10-12');
    expect(screen.getByLabelText('Import to')).toHaveValue('2026-10-16');
    const before = callsTo(get, '/instruments/{instrument_id}/market-data').length;
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(
      await screen.findByText(/fetched 4, stored 3, already stored 1, rejected 0/),
    ).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith('/instruments/{instrument_id}/market-data/import', {
      params: { path: { instrument_id: '31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2' } },
      body: { start_date: '2026-10-12', end_date: '2026-10-16' },
    });
    await waitFor(() =>
      expect(callsTo(get, '/instruments/{instrument_id}/market-data').length).toBeGreaterThan(
        before,
      ),
    );
  });

  it('explains an import that fetched nothing and shows rejected reasons', async () => {
    setup({
      importReply: () =>
        ok(importResult({ fetched: 0, inserted: 0, skipped_existing: 0, rejected: 0 })),
    });
    await chartBars();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/The provider returned no bars/)).toBeInTheDocument();
  });

  it('shows the backend message when an import is refused', async () => {
    setup({
      importReply: () => ok({ detail: 'The market-data provider could not be reached.' }, 502),
    });
    await chartBars();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The price provider could not be reached from the backend.',
    );
  });

  it('does not offer import for anything other than an NSE equity, ETF or index', async () => {
    setup({ instrument: () => ok(instrument({ instrument_type: 'FUTURES' })) });
    expect(
      await screen.findByText(/Import supports NSE equities, ETFs and indices only/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
  });

  it('shows the backend 409 message when the instrument cannot be deleted', async () => {
    const message =
      'This instrument has stored price data or trading records, so it cannot be deleted. Deactivate it instead.';
    const error = vi.spyOn(toast, 'error');
    const { del } = setup({ deleteReply: () => ok({ detail: message }, 409) });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete instrument' }));
    await waitFor(() => expect(error).toHaveBeenCalledWith(message));
    expect(del).toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'RELIANCE' })).toBeInTheDocument();
  });

  it('goes back to the list after a delete', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete instrument' }));
    expect(await screen.findByText('Instrument list')).toBeInTheDocument();
  });

  it('draws backend indicator series aligned with the price bars', async () => {
    const { post } = setup(
      {},
      '/app/instruments/31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2?from=2026-10-06&to=2026-10-12&ind=SMA:window=3&ind=RSI:period=14',
    );
    await waitFor(async () => {
      const el = await screen.findByRole('img');
      expect(JSON.parse(el.getAttribute('data-overlays')!)).toHaveLength(2);
    });
    const el = screen.getByRole('img');
    const bars = JSON.parse(el.getAttribute('data-bars')!) as Bar[];
    const overlays = JSON.parse(el.getAttribute('data-overlays')!) as ChartOverlay[];
    expect(overlays.map((o) => [o.label, o.panel])).toEqual([
      ['SMA(3)', 'price'],
      ['RSI(14)', 'separate'],
    ]);
    for (const overlay of overlays) {
      // Same trading days, in the same order, as the candles.
      expect(overlay.lines[0]!.points.map((p) => p.time)).toEqual(bars.map((b) => b.time));
      expect(overlay.lines[0]!.points[0]!.value).toBeNull();
      expect(overlay.lines[0]!.points[1]!.value).toBe(bars[1]!.close + 1);
    }
    expect(post).toHaveBeenCalledWith('/instruments/{instrument_id}/indicators/{key}', {
      params: { path: { instrument_id: '31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2', key: 'SMA' } },
      body: { parameters: { window: 3 }, start_date: '2026-10-06', end_date: '2026-10-12' },
    });
    expect(screen.getByRole('img')).toHaveAccessibleName(/with SMA\(3\), RSI\(14\)/);
  });

  it('adds an indicator from the form and removes it again', async () => {
    const validate = (_: string, init: { params: { path: { key: string } }; body: SeriesBody }) =>
      ok({ key: init.params.path.key, parameters: init.body.parameters });
    const { post } = setup({});
    await chartBars();
    post.mockImplementation(((
      path: string,
      init: { params: { path: { key: string } }; body: SeriesBody },
    ) =>
      respond(
        path === '/indicators/{key}/validate'
          ? validate(path, init)
          : seriesFromRows(init.params.path.key, init.body),
      )) as never);
    fireEvent.click(screen.getByRole('button', { name: 'Add indicator' }));
    fireEvent.change(screen.getByLabelText(/^window/), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to chart' }));
    const chips = await screen.findByRole('group', { name: 'Chart indicators' });
    expect(await within(chips).findByText('SMA(5)')).toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(screen.getByRole('img').getAttribute('data-overlays')!)).toHaveLength(1),
    );
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove SMA(5)' }));
    await waitFor(() =>
      expect(JSON.parse(screen.getByRole('img').getAttribute('data-overlays')!)).toHaveLength(0),
    );
  });

  it("shows the backend's message when an indicator cannot be computed", async () => {
    setup(
      { seriesReply: () => ok({ detail: 'window must be greater than 0.' }, 422) },
      '/app/instruments/31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2?ind=SMA:window=3',
    );
    expect(await screen.findByText('SMA(3): window must be greater than 0.')).toBeInTheDocument();
  });

  it('says the instrument is not available for an unknown id', async () => {
    setup({ instrument: () => ok({ detail: 'Instrument not found' }, 404) });
    expect(
      await screen.findByRole('heading', { name: 'Instrument not available' }),
    ).toBeInTheDocument();
  });
});
