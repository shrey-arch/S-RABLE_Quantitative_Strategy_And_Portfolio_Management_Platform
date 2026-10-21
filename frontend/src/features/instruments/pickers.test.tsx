import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import type { DateRangeValue } from '@/components/ui/date-range-field';
import type { DataRangeStatus } from './data-range';
import { DataRangeField } from './DataRangeField';
import { INSTRUMENTS_FIXTURE, instrument } from './instrument-fixture';
import { InstrumentPicker } from './InstrumentPicker';
import { coverage } from './market-data-fixture';

type Query = { start_date?: string; end_date?: string };
const ok = (body: unknown, status = 200) =>
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T06:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('InstrumentPicker', () => {
  function Harness(props: { onPick: (id: string, symbol?: string) => void }) {
    const [value, setValue] = useState('');
    return (
      <>
        <label htmlFor="pick">Instrument</label>
        <InstrumentPicker
          id="pick"
          value={value}
          onChange={(id, i) => {
            setValue(id);
            props.onPick(id, i?.symbol);
          }}
        />
      </>
    );
  }

  it('lists active instruments by exchange and passes the chosen UUID', async () => {
    vi.spyOn(api, 'GET').mockImplementation((() => ok(INSTRUMENTS_FIXTURE)) as never);
    const onPick = vi.fn();
    wrap(<Harness onPick={onPick} />);
    const select = await screen.findByRole('combobox', { name: 'Instrument' });
    await waitFor(() => expect(select).toBeEnabled());
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    // GOLDM is inactive, so it is not offered.
    expect(options).toEqual([
      'Choose an instrument',
      'NIFTYBEES - Nippon India ETF Nifty 50 BeES',
      'RELIANCE - Reliance Industries',
    ]);
    fireEvent.change(select, { target: { value: '31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2' } });
    expect(onPick).toHaveBeenLastCalledWith('31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2', 'RELIANCE');
    expect(select).toHaveValue('31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2');
  });

  it('keeps an inactive instrument that is already the value', async () => {
    vi.spyOn(api, 'GET').mockImplementation((() => ok(INSTRUMENTS_FIXTURE)) as never);
    const gold = INSTRUMENTS_FIXTURE.find((i) => i.symbol === 'GOLDM')!;
    wrap(<InstrumentPicker value={gold.id} onChange={() => undefined} />);
    expect(await screen.findByRole('option', { name: /GOLDM .*\(inactive\)/ })).toBeInTheDocument();
  });

  it('says where to add instruments when there are none', async () => {
    vi.spyOn(api, 'GET').mockImplementation((() => ok([])) as never);
    wrap(<InstrumentPicker value="" onChange={() => undefined} />);
    expect(
      await screen.findByRole('link', { name: /Add one on the Instruments page/ }),
    ).toHaveAttribute('href', '/app/instruments');
  });
});

describe('DataRangeField', () => {
  const ID = instrument().id;
  // Stored: 05 Jan 2026 to 12 Oct 2026. Ranges inside Sep 2026 have no bars.
  function setupCoverage() {
    return vi.spyOn(api, 'GET').mockImplementation(((
      _path: string,
      init: { params: { query: Query } },
    ) => {
      const q = init.params.query;
      if (!q.start_date) {
        return ok(
          coverage({
            first_timestamp: '2026-01-05T00:00:00Z',
            last_timestamp: '2026-10-12T00:00:00Z',
          }),
        );
      }
      if (q.start_date.startsWith('2026-09')) {
        return ok(coverage({ row_count: 0, first_timestamp: null, last_timestamp: null }));
      }
      // 03 Oct 2026 is a Saturday: the first bar in the range is Mon 05 Oct.
      return ok(
        coverage({
          row_count: 6,
          first_timestamp: '2026-10-05T00:00:00Z',
          last_timestamp: '2026-10-12T00:00:00Z',
        }),
      );
    }) as never);
  }

  function Harness(props: { start?: DateRangeValue; onStatus: (s: DataRangeStatus) => void }) {
    const [value, setValue] = useState<DateRangeValue>(props.start ?? { start: '', end: '' });
    return (
      <DataRangeField
        instrumentId={ID}
        value={value}
        onChange={setValue}
        onStatusChange={props.onStatus}
      />
    );
  }

  const lastKind = (spy: ReturnType<typeof vi.fn>) =>
    (spy.mock.calls.at(-1)![0] as DataRangeStatus).kind;

  it('accepts a range with stored bars and names the trading days it really covers', async () => {
    const get = setupCoverage();
    const onStatus = vi.fn();
    wrap(<Harness onStatus={onStatus} start={{ start: '2026-10-03', end: '2026-10-12' }} />);
    expect(
      await screen.findByText('6 daily bars, 05 Oct 2026 to 12 Oct 2026.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Stored daily data: 05 Jan 2026 to 12 Oct 2026.')).toBeInTheDocument();
    expect(screen.getByText('1 trading day has no data in this range.')).toBeInTheDocument();
    expect(lastKind(onStatus)).toBe('ok');
    expect(get).toHaveBeenCalledWith('/instruments/{instrument_id}/market-data/coverage', {
      params: {
        path: { instrument_id: ID },
        query: { timeframe: '1D', start_date: '2026-10-03', end_date: '2026-10-12' },
      },
    });
  });

  it('rejects a range with no stored bars', async () => {
    setupCoverage();
    const onStatus = vi.fn();
    wrap(<Harness onStatus={onStatus} start={{ start: '2026-09-01', end: '2026-09-30' }} />);
    expect(
      await screen.findByText('No stored bars fall in this range. Choose other dates.'),
    ).toBeInTheDocument();
    expect(lastKind(onStatus)).toBe('invalid');
  });

  it('rejects ranges outside the stored data without asking the backend', async () => {
    const get = setupCoverage();
    const onStatus = vi.fn();
    wrap(<Harness onStatus={onStatus} start={{ start: '2025-01-01', end: '2025-12-31' }} />);
    expect(
      await screen.findByText('The end date is before the first stored bar (05 Jan 2026).'),
    ).toBeInTheDocument();
    expect(lastKind(onStatus)).toBe('invalid');
    expect(get).toHaveBeenCalledTimes(1); // only the stored-span lookup
  });

  it('asks for both dates, then checks the range', async () => {
    setupCoverage();
    const onStatus = vi.fn();
    wrap(<Harness onStatus={onStatus} />);
    expect(await screen.findByText('Choose a start and an end date.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-12' } });
    expect(await screen.findByText(/6 daily bars/)).toBeInTheDocument();
    expect(lastKind(onStatus)).toBe('ok');
  });

  it('says when nothing is stored for the instrument', async () => {
    vi.spyOn(api, 'GET').mockImplementation((() =>
      ok(coverage({ row_count: 0, first_timestamp: null, last_timestamp: null }))) as never);
    const onStatus = vi.fn();
    wrap(<Harness onStatus={onStatus} />);
    expect(
      await screen.findByText(/No daily data is stored for this instrument/),
    ).toBeInTheDocument();
    expect(lastKind(onStatus)).toBe('no-data');
  });
});
