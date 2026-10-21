import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { INSTRUMENTS_FIXTURE } from '@/features/instruments/instrument-fixture';
import { istDate } from '@/features/instruments/market-data';
import { coverage } from '@/features/instruments/market-data-fixture';
import { REGIME_FIT } from '@/features/scoring/scoring-fixture';
import { formatDate, formatNumber, formatPercent } from '@/lib/format';
import RegimePage from './RegimePage';
import {
  SUP_CURRENT,
  SUP_HISTORY,
  SUP_INSTRUMENTS,
  SUP_MODEL,
  SUP_MODELS,
  SUP_REFUSED,
} from './supervised-fixture';

type Reply = { status: number; body: unknown };
const respond = ({ status, body }: Reply) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });
const ok = (body: unknown): Reply => ({ status: 200, body });

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const [NIFTY, VIX] = SUP_INSTRUMENTS;
const day = (t: string) => formatDate(istDate(t));
const card = SUP_MODEL.card!;
const evaluation = card.supervised!.evaluation;

function setup(path: string, train?: Reply) {
  vi.spyOn(api, 'GET').mockImplementation(((
    url: string,
    init?: { params?: { path?: Record<string, string> } },
  ) => {
    if (url === '/regime/current') return respond(ok(SUP_CURRENT));
    if (url === '/regime/history') return respond(ok(SUP_HISTORY));
    if (url === '/regime/models') return respond(ok(SUP_MODELS));
    if (url === '/regime/models/{model_id}') return respond(ok(SUP_MODEL));
    if (url === '/scoring/regime-fit') return respond(ok(REGIME_FIT));
    if (url === '/instruments') return respond(ok([...INSTRUMENTS_FIXTURE, ...SUP_INSTRUMENTS]));
    if (url.endsWith('/coverage'))
      return respond(
        ok(coverage({ instrument_id: init!.params!.path!.instrument_id!, row_count: 1100 })),
      );
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi
    .spyOn(api, 'POST')
    .mockImplementation((() =>
      respond(
        train ?? { status: 202, body: { ...SUP_MODEL, status: 'TRAINING', number: 2, card: null } },
      )) as never);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app/regime" element={<RegimePage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { post };
}

afterEach(() => vi.restoreAllMocks());

describe('Supervised regime model (Feature 2)', () => {
  it('the current regime shows each dimension with its probabilities, labelled as not a guarantee', async () => {
    setup('/app/regime');
    const current = await screen.findByRole('region', { name: 'Current regime' });
    expect(within(current).getByTestId('regime-name')).toHaveTextContent(SUP_CURRENT.regime.name);
    expect(current).toHaveTextContent(SUP_CURRENT.statement);
    expect(
      screen.getAllByText('Model classification of the next 20 days, not a guarantee').length,
    ).toBeGreaterThanOrEqual(2);
    expect(current).toHaveTextContent(
      `Combined probability${formatPercent(SUP_CURRENT.confidence)}`,
    );
    for (const d of SUP_CURRENT.dimensions!) {
      const row = within(current).getByRole('listitem', { name: d.name });
      expect(row).toHaveTextContent(`${d.label}${formatPercent(d.probability)}`);
      for (const p of d.probabilities)
        expect(row).toHaveTextContent(`${p.label}${formatPercent(p.probability)}`);
    }
  });

  it('history has one band row per dimension, lined up with the API periods', async () => {
    setup('/app/regime');
    const chart = await screen.findByRole('img', { name: /band rows/ });
    expect(chart).toHaveAttribute('data-points', String(SUP_HISTORY.points.length));
    for (const band of SUP_HISTORY.dimension_periods!) {
      const row = chart.querySelector(`[data-dimension="${band.key}"]`)!;
      const rendered = [...row.querySelectorAll('[data-band]')].map((b) =>
        b.getAttribute('data-label'),
      );
      expect(rendered).toEqual(band.periods.map((p) => p.label ?? ''));
    }
    const trend = SUP_HISTORY.dimension_periods!.find((d) => d.key === 'trend')!;
    fireEvent.click(screen.getByText(`Trend: every period (${trend.periods.length})`));
    const table = screen.getByRole('table', { name: 'Trend periods' });
    expect(within(table).getAllByRole('row')).toHaveLength(trend.periods.length + 1);
    expect(table).toHaveTextContent(day(trend.periods[1]!.start));
  });

  it('the model card shows each dimension against the 70% target, baselines and the confusion matrix', async () => {
    setup(`/app/regime?tab=model&model=${SUP_MODEL.id}`);
    const accuracy = await screen.findByRole('region', { name: 'Out-of-sample accuracy' });
    for (const d of evaluation.dimensions) {
      const tile = within(accuracy).getByRole('group', { name: `${d.name} accuracy` });
      expect(tile).toHaveTextContent(formatPercent(d.test.accuracy));
      expect(tile).toHaveTextContent(d.test.meets_target ? 'Meets target' : 'Below target');
      expect(tile).toHaveTextContent(
        `balanced accuracy ${formatPercent(d.test.balanced_accuracy)}`,
      );
    }
    expect(accuracy).toHaveTextContent(
      `${evaluation.summary.dimensions_meeting_target} of 3 dimensions meet the 70.00% target`,
    );
    // Both outcomes are shown honestly in this model.
    expect(evaluation.dimensions.some((d) => d.test.meets_target)).toBe(true);
    expect(evaluation.dimensions.some((d) => !d.test.meets_target)).toBe(true);

    const trend = evaluation.dimensions.find((d) => d.key === 'trend')!;
    const section = screen.getByRole('region', { name: new RegExp(`^Trend: `) });
    const baselines = within(section).getByRole('table', {
      name: 'Trend: model and baselines on the test days',
    });
    for (const b of trend.test.baselines)
      expect(baselines).toHaveTextContent(`Baseline: ${b.label}`);
    expect(baselines).toHaveTextContent(formatPercent(trend.test.baselines[1]!.accuracy));
    const matrix = within(section).getByRole('table', { name: /Trend confusion matrix/ });
    const rows = within(matrix).getAllByRole('row').slice(1);
    rows.forEach((row, i) => {
      const cells = within(row)
        .getAllByRole('cell')
        .map((c) => Number(c.textContent));
      expect(cells).toEqual(trend.test.confusion_matrix[i]);
    });
    const perClass = within(section).getByRole('table', {
      name: 'Trend: precision and recall by class',
    });
    for (const c of trend.test.per_class)
      expect(perClass).toHaveTextContent(
        `${c.label}${formatPercent(c.precision)}${formatPercent(c.recall)}`,
      );
    const importance = within(section).getByRole('list', { name: 'Trend feature importance' });
    expect(within(importance).getAllByRole('listitem')).toHaveLength(
      trend.feature_importance.length,
    );
    expect(within(importance).getAllByRole('listitem')[0]).toHaveTextContent(
      `${trend.feature_importance[0]!.feature}${formatPercent(trend.feature_importance[0]!.importance)}`,
    );

    const splits = screen.getByRole('table', { name: 'Dataset splits and purge gaps' });
    const d = card.dataset;
    expect(splits).toHaveTextContent(`train${formatNumber(d.splits[0]!.rows, 0)}`);
    expect(splits).toHaveTextContent(
      `${day(d.purges![0]!.start!)} to ${day(d.purges![0]!.end!)}: left out between train and validation`,
    );
    expect(splits).toHaveTextContent(day(d.splits[0]!.label_window_end!));
    const labels = screen.getByRole('region', { name: 'What the classes mean' });
    for (const rule of card.supervised!.label_definition.rules)
      expect(labels).toHaveTextContent(rule.rule);
  });

  it('trains a supervised model: dimension meanings, horizon check, India VIX and the exact request', async () => {
    const { post } = setup('/app/regime?tab=training');
    const form = await screen.findByRole('region', { name: 'Train a new model' });
    expect(within(form).getByRole('combobox', { name: 'Model type' })).toHaveValue('AUTO');
    expect(
      within(form).getByRole('region', { name: 'What each dimension means' }),
    ).toHaveTextContent('above +2%, below -2%');
    expect(
      await within(form).findByText(/1,100 daily bars in the range; 828 labelled days/),
    ).toBeVisible();
    fireEvent.change(within(form).getByRole('textbox', { name: /Label horizon/ }), {
      target: { value: '3' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Review training' }));
    expect(within(form).getByText('Enter 5 to 60.')).toBeVisible();

    fireEvent.change(within(form).getByRole('textbox', { name: /Label horizon/ }), {
      target: { value: '20' },
    });
    const vix = within(form).getByRole('combobox', { name: /India VIX/ });
    await waitFor(() => expect(vix).not.toBeDisabled());
    fireEvent.change(vix, { target: { value: VIX!.id } });
    fireEvent.click(within(form).getByRole('button', { name: 'Review training' }));
    const confirm = await screen.findByRole('region', { name: 'Confirm training' });
    expect(confirm).toHaveTextContent(
      'Train Model 2: all stored bars; RF or XGBoost; next 20 days; India VIX INDIAVIX; seed 42.',
    );
    fireEvent.click(within(confirm).getByRole('button', { name: /Start training/ }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/regime/models', {
        body: {
          model_kind: 'AUTO',
          instrument_id: NIFTY!.id,
          start_date: null,
          end_date: null,
          horizon_days: 20,
          vix_instrument_id: VIX!.id,
          random_state: 42,
          volatility_window: 20,
          trend_window: 20,
        },
      }),
    );
    const list = screen.getByRole('table', { name: 'Regime models' });
    expect(list).toHaveTextContent('RF or XGBoost');
    expect(list).toHaveTextContent('next 20 days; India VIX INDIAVIX; seed 42');
  });

  it("the backend's refusal for too little data is shown as sent", async () => {
    setup('/app/regime?tab=training', { status: 422, body: SUP_REFUSED });
    const form = await screen.findByRole('region', { name: 'Train a new model' });
    await within(form).findByText(/1,100 daily bars/);
    fireEvent.click(within(form).getByRole('button', { name: 'Review training' }));
    fireEvent.click(await screen.findByRole('button', { name: /Start training/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(SUP_REFUSED.detail);
  });
});
