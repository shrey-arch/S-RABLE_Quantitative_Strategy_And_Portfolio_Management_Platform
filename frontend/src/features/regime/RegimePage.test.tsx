import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { POLL_MS } from '@/features/backtests/backtest-model';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import { istDate } from '@/features/instruments/market-data';
import { coverage } from '@/features/instruments/market-data-fixture';
import { formatDate, formatNumber, formatPercent } from '@/lib/format';
import { REGIME_FIT } from '@/features/scoring/scoring-fixture';
import { coreInfo } from '@/features/strategies/core-strategies';
import { CURRENT_REGIME, REGIME_HISTORY, REGIME_MODEL, REGIME_MODELS } from './regime-fixture';
import RegimePage from './RegimePage';

type Reply = { status: number; body: unknown };
const respond = ({ status, body }: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });
const ok = (body: unknown): Reply => ({ status: 200, body });
const NO_MODEL: Reply = {
  status: 404,
  body: { detail: 'No regime model has been trained yet. Train one on the Market regime page.' },
};

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const NIFTYBEES = INSTRUMENTS_FIXTURE[1]!;
const day = (t: string) => formatDate(istDate(t));

interface Options {
  path?: string;
  current?: () => Reply;
  history?: () => Reply;
  models?: () => Reply;
  train?: Reply;
  fit?: unknown;
}

function setup(options: Options = {}) {
  const get = vi.spyOn(api, 'GET').mockImplementation(((
    url: string,
    init?: { params?: { query?: Record<string, string>; path?: Record<string, string> } },
  ) => {
    if (url === '/regime/current') return respond(options.current?.() ?? ok(CURRENT_REGIME));
    if (url === '/regime/history') return respond(options.history?.() ?? ok(REGIME_HISTORY));
    if (url === '/regime/models') return respond(options.models?.() ?? ok(REGIME_MODELS));
    if (url === '/regime/models/{model_id}') return respond(ok(REGIME_MODEL));
    if (url === '/scoring/regime-fit') return respond(ok(options.fit ?? REGIME_FIT));
    if (url === '/instruments') return respond(ok(INSTRUMENTS_FIXTURE));
    if (url.endsWith('/coverage'))
      return respond(
        ok(coverage({ instrument_id: init!.params!.path!.instrument_id!, row_count: 600 })),
      );
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation((() =>
    respond(
      options.train ?? {
        status: 202,
        body: { ...REGIME_MODEL, status: 'TRAINING', number: 2, card: null },
      },
    )) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Where() {
    const location = useLocation();
    return <div data-testid="where">{location.pathname + location.search}</div>;
  }
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[options.path ?? '/app/regime']}>
          <Routes>
            <Route path="/app/regime" element={<RegimePage />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const calls = (url: string) =>
    (get.mock.calls as unknown[][]).filter(([u]) => u === url).map(([, init]) => init);
  return { calls, post };
}

const openTab = async (name: string) => {
  fireEvent.mouseDown(await screen.findByRole('tab', { name }), { button: 0 });
  return screen.findByRole('tabpanel', { name });
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RegimePage', () => {
  it('the current regime shows exactly the API labels, confidence and date', async () => {
    setup();
    expect(await screen.findByRole('heading', { level: 1, name: 'Market Regime' })).toBeVisible();
    const card = await screen.findByRole('region', { name: 'Current regime' });
    const r = CURRENT_REGIME.regime;
    expect(within(card).getByTestId('regime-name')).toHaveTextContent(r.name);
    expect(card).toHaveTextContent(r.code);
    expect(card).toHaveTextContent(`Volatility state${r.volatility_state}`);
    expect(card).toHaveTextContent(`Trend state${r.trend_state}`);
    expect(card).toHaveTextContent(`Confidence${formatPercent(CURRENT_REGIME.confidence)}`);
    expect(card).toHaveTextContent(`As of${day(CURRENT_REGIME.as_of)}`);
    expect(within(card).getByRole('link', { name: 'NIFTYBEES' })).toHaveAttribute(
      'href',
      `/app/instruments/${NIFTYBEES.id}`,
    );
    expect(card).toHaveTextContent('Model 1 (gmm-regime-v1)');
    // It says what it is: a classification, not a forecast.
    expect(card).toHaveTextContent('it is not a forecast');
    expect(screen.getAllByText('Model classification, not a forecast').length).toBeGreaterThan(0);
    const probabilities = within(card).getAllByRole('listitem');
    expect(probabilities).toHaveLength(CURRENT_REGIME.probabilities.length);
    CURRENT_REGIME.probabilities.forEach((p, i) => {
      expect(probabilities[i]).toHaveTextContent(
        `${p.code}${p.name}${formatPercent(p.probability)}`,
      );
    });
  });

  it('history bands carry text labels and line up with the API periods', async () => {
    setup();
    const chart = await screen.findByRole('img', { name: /regime periods labelled/ });
    expect(chart).toHaveAttribute('data-points', String(REGIME_HISTORY.points.length));
    const drawn = chart.querySelectorAll('[data-band]');
    expect(drawn).toHaveLength(REGIME_HISTORY.periods.length);
    REGIME_HISTORY.periods.forEach((period, i) => {
      const band = drawn[i]!;
      expect(band.getAttribute('data-start')).toBe(period.start);
      expect(band.getAttribute('data-end')).toBe(period.end);
      expect(band.getAttribute('data-code')).toBe(period.code ?? '');
      expect(band.querySelector('title')!.textContent).toBe(
        `${period.code} ${period.name}: ${day(period.start)} to ${day(period.end)} (${period.bars} ${period.bars === 1 ? 'day' : 'days'})`,
      );
    });
    // Wide bands show their code as text inside the band.
    const labelled = [...drawn].filter((b) => b.querySelector('text'));
    expect(labelled.length).toBeGreaterThan(0);
    for (const band of labelled)
      expect(band.querySelector('text')!.textContent).toBe(band.getAttribute('data-code'));
    // The legend names every code.
    const legend = screen.getByRole('list', { name: 'Regimes' });
    for (const regime of REGIME_HISTORY.regimes)
      expect(legend).toHaveTextContent(`${regime.code}${regime.name}`);
  });

  it('lists the transitions (newest first) and every period from the API', async () => {
    setup();
    const transitions = await screen.findByRole('table', { name: 'Regime transitions' });
    const rows = within(transitions).getAllByRole('row').slice(1);
    const expected = [...REGIME_HISTORY.transitions].reverse();
    expect(rows).toHaveLength(expected.length);
    rows.forEach((row, i) => {
      const t = expected[i]!;
      expect(row).toHaveTextContent(
        `${day(t.timestamp)}${t.from_code} ${t.from_name}${t.to_code} ${t.to_name}${formatPercent(t.confidence)}`,
      );
    });
    const periods = within(screen.getByRole('table', { name: 'Regime periods' }))
      .getAllByRole('row')
      .slice(1);
    expect(periods.map((r) => r.textContent)).toEqual(
      REGIME_HISTORY.periods.map((p) => `${p.code} ${p.name}${day(p.start)}${day(p.end)}${p.bars}`),
    );
  });

  it('the date range is sent to the backend and kept in the address', async () => {
    const { calls } = setup({ path: '/app/regime?from=2023-11-01&to=2024-04-30' });
    await screen.findByRole('img', { name: /regime periods labelled/ });
    expect(calls('/regime/history').at(-1)).toEqual({
      params: { query: { start_date: '2023-11-01', end_date: '2024-04-30' } },
    });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-01-01' } });
    expect(screen.getByTestId('where')).toHaveTextContent('from=2024-01-01&to=2024-04-30');
    await vi.waitFor(() =>
      expect(calls('/regime/history').at(-1)).toEqual({
        params: { query: { start_date: '2024-01-01', end_date: '2024-04-30' } },
      }),
    );
  });

  it('strategy fit shows the backend verdict and rule for each core strategy', async () => {
    setup();
    const fit = await screen.findByRole('region', { name: 'Strategy fit' });
    const items = await within(fit).findAllByRole('listitem');
    const labels = {
      COMPATIBLE: 'Compatible',
      NOT_COMPATIBLE: 'Not compatible',
      UNKNOWN: 'Unknown',
    };
    expect(items).toHaveLength(REGIME_FIT.strategies.length);
    REGIME_FIT.strategies.forEach((s, i) => {
      expect(items[i]).toHaveTextContent(
        `${coreInfo(s.strategy_key).name}${labels[s.compatibility.status]}${s.rule.rule}`,
      );
    });
  });

  it('with no trained model, no regime value is shown anywhere', async () => {
    setup({ current: () => NO_MODEL, history: () => NO_MODEL, models: () => ok([]) });
    expect(await screen.findByText('No regime model yet')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Current regime' })).toBeNull();
    expect(screen.queryByRole('img', { name: /regime periods/ })).toBeNull();
    for (const label of REGIME_MODEL.card!.labels.regimes)
      expect(screen.queryByText(label.name, { exact: false })).toBeNull();
    const panel = await openTab('Model card');
    expect(await within(panel).findByText('No regime model yet')).toBeInTheDocument();
  });

  it('the model card shows the backend model metadata', async () => {
    setup({ path: '/app/regime?tab=model' });
    const c = REGIME_MODEL.card!;
    const overview = await screen.findByRole('region', { name: 'Model 1 (gmm-regime-v1)' });
    expect(overview).toHaveTextContent(`Model type${c.model_type}`);
    expect(overview).toHaveTextContent(
      `Training period${day(c.training_start)} to ${day(c.training_end)}`,
    );
    expect(overview).toHaveTextContent(`Clusters${c.n_components}, chosen from 2, 3, 4.`);
    expect(overview).toHaveTextContent('Active (used for the current regime)');
    const features = within(screen.getByRole('table', { name: 'Model features' })).getAllByRole(
      'row',
    );
    expect(features.slice(1).map((r) => r.firstChild!.textContent)).toEqual(
      c.features.map((f) => f.name),
    );
    const regimes = within(screen.getByRole('table', { name: 'Regimes of the model' }))
      .getAllByRole('row')
      .slice(1);
    c.labels.regimes.forEach((r, i) => {
      expect(regimes[i]).toHaveTextContent(
        `${r.code} ${r.name}${r.volatility_state}${r.trend_state}`,
      );
      expect(regimes[i]).toHaveTextContent(formatPercent(r.annualized_volatility));
    });
    expect(
      screen.getByRole('region', { name: 'Regimes and how they are named' }),
    ).toHaveTextContent(c.labels.rule);
    const performance = screen.getByRole('region', { name: 'Reported performance' });
    expect(performance).toHaveTextContent(
      `Validation BIC${formatNumber(c.evaluation!.validation_bic, 1)}`,
    );
    expect(performance).toHaveTextContent(`Test BIC${formatNumber(c.evaluation!.test_bic, 1)}`);
    expect(performance).toHaveTextContent(formatPercent(c.evaluation!.test_mean_max_probability));
    expect(performance).toHaveTextContent('no accuracy figure');
    const splits = within(screen.getByRole('table', { name: 'Dataset splits' })).getAllByRole(
      'row',
    );
    expect(splits.slice(1).map((r) => r.textContent)).toEqual(
      c.dataset.splits.map(
        (s) =>
          `${s.name} (${formatPercent(c.dataset.ratios[s.name])})${formatNumber(s.rows, 0)}${day(s.start)} to ${day(s.end)}`,
      ),
    );
  });

  it('training a Gaussian mixture: checks the form, reviews, then posts exactly what it showed', async () => {
    const { post } = setup({ path: '/app/regime?tab=training' });
    const form = await screen.findByRole('region', { name: 'Train a new model' });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Model type' }), {
      target: { value: 'GMM' },
    });
    // The active model's reference instrument is preselected.
    expect(await within(form).findByRole('combobox', { name: 'Reference instrument' })).toHaveValue(
      NIFTYBEES.id,
    );
    expect(
      await within(form).findByText(/600 daily bars in the range; 580 with complete/),
    ).toBeVisible();
    fireEvent.change(within(form).getByRole('textbox', { name: 'Volatility window (days)' }), {
      target: { value: '2' },
    });
    fireEvent.click(within(form).getByRole('checkbox', { name: '2' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: '3' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: '4' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Review training' }));
    expect(within(form).getByText('Enter 5 to 120.')).toBeVisible();
    expect(within(form).getByText('Choose at least one cluster count.')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Confirm training' })).toBeNull();

    fireEvent.change(within(form).getByRole('textbox', { name: 'Volatility window (days)' }), {
      target: { value: '30' },
    });
    fireEvent.click(within(form).getByRole('checkbox', { name: '3' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: '5' }));
    fireEvent.change(within(form).getByRole('textbox', { name: 'Seed' }), {
      target: { value: '9' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Review training' }));
    const confirm = await screen.findByRole('region', { name: 'Confirm training' });
    expect(confirm).toHaveTextContent(
      'Train Model 2: all stored bars; windows 30/20 days; clusters 3, 5; seed 9.',
    );
    expect(confirm).toHaveTextContent('replaces the active model for everyone');
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: /Start training/ }));
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith('/regime/models', {
        body: {
          model_kind: 'GMM',
          instrument_id: NIFTYBEES.id,
          start_date: null,
          end_date: null,
          volatility_window: 30,
          trend_window: 20,
          candidate_components: [3, 5],
          random_state: 9,
          horizon_days: 20,
        },
      }),
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('training: the backend refusal is shown as sent', async () => {
    setup({
      path: '/app/regime?tab=training',
      train: {
        status: 409,
        body: {
          detail: 'A regime model is already training. Wait for it to finish, then try again.',
        },
      },
    });
    const form = await screen.findByRole('region', { name: 'Train a new model' });
    await within(form).findByText(/600 daily bars/);
    fireEvent.click(within(form).getByRole('button', { name: 'Review training' }));
    fireEvent.click(await screen.findByRole('button', { name: /Start training/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A regime model is already training.',
    );
  });

  it('a model in training is followed until it is ready, then polling stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const training = [
      { ...REGIME_MODELS[0]!, id: 'm-2', number: 2, status: 'TRAINING', is_active: false },
      ...REGIME_MODELS,
    ];
    const ready = [
      { ...training[0]!, status: 'READY', is_active: true },
      { ...REGIME_MODELS[0]!, is_active: false },
    ];
    let reads = 0;
    const { calls } = setup({
      path: '/app/regime?tab=training',
      models: () => {
        reads += 1;
        return ok(reads < 2 ? training : ready);
      },
    });
    expect(await screen.findByText(/Model 2 \(gmm-regime-v1\) is training\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review training' })).toBeDisabled();
    const table = screen.getByRole('table', { name: 'Regime models' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Training');
    const before = calls('/regime/models').length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await vi.waitFor(() => expect(calls('/regime/models').length).toBeGreaterThan(before));
    await vi.waitFor(() => expect(screen.queryByText(/is training\./)).toBeNull());
    expect(
      within(screen.getByRole('table', { name: 'Regime models' })).getAllByRole('row')[1],
    ).toHaveTextContent('Model 2 (gmm-regime-v1)ActiveTrained by youReady');
    expect(screen.getByRole('button', { name: 'Review training' })).toBeEnabled();
    const seen = calls('/regime/models').length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    // Polling stopped once nothing is training (one refresh after it finished).
    expect(calls('/regime/models').length).toBeLessThanOrEqual(seen + 1);
  });
});
