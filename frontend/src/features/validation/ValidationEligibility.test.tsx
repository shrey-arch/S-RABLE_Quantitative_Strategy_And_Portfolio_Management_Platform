import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PlanSettings } from '@/features/portfolios/PortfolioForms';
import {
  buildTargetBody,
  DEFAULT_LIMITS,
  type PlanDraft,
} from '@/features/portfolios/portfolio-model';
import { TargetView } from '@/features/portfolios/PortfolioViews';
import { RankingTable } from '@/features/scoring/ScoringViews';
import { MyStrategiesTable } from '@/features/strategies/MyStrategiesTable';
import StrategyDetailPage from '@/features/strategies/StrategyDetailPage';
import { VALIDATION_STATUS_LABELS } from './validation-status';
import { VS_SCORES, VS_STRATEGIES, VS_TARGET_OFF, VS_TARGET_ON } from './validation-status-fixture';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const respond = (body: unknown, status = 200) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

function mount(ui: React.ReactNode, path = '/') {
  vi.spyOn(api, 'GET').mockImplementation(((
    url: string,
    init?: { params?: { path?: { strategy_id?: string } } },
  ) => {
    if (url === '/strategies') return respond(VS_STRATEGIES);
    if (url === '/strategies/{strategy_id}')
      return respond(VS_STRATEGIES.find((s) => s.id === init?.params?.path?.strategy_id));
    if (url === '/strategy-registry') return respond([]);
    if (url === '/regime/current') return respond({ detail: 'No regime model.' }, 404);
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  vi.spyOn(api, 'POST').mockImplementation(((url: string) => {
    if (url === '/scoring') return respond(VS_SCORES);
    throw new Error(`unexpected POST ${url}`);
  }) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/app/strategies/:id" element={<StrategyDetailPage />} />
            <Route path="*" element={ui} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

const byName = (name: string) => VS_STRATEGIES.find((s) => s.name === name)!;

describe('validation status (Feature 5)', () => {
  it('the strategies table shows each status with the backend reason and what to do', async () => {
    mount(<MyStrategiesTable />);
    const table = await screen.findByRole('table', { name: 'My strategies' });
    for (const s of VS_STRATEGIES) {
      const row = within(table).getByRole('row', { name: new RegExp(s.name) });
      const badge = within(row).getByText(VALIDATION_STATUS_LABELS[s.validation.status]);
      expect(badge.closest('[title]')).toHaveAttribute('title', s.validation.reason);
      const validate = within(row).queryByRole('link', { name: 'Validate it' });
      if (s.validation.eligible) expect(validate).toBeNull();
      else expect(validate).toHaveAttribute('href', `/app/validation/new?strategy=${s.id}`);
      if (s.validation.validation_id)
        expect(
          within(row).getByRole('link', { name: /Validation report|Latest validation/ }),
        ).toHaveAttribute('href', `/app/validation/${s.validation.validation_id}`);
    }
  });

  it('the strategy page says why an edited strategy needs validating again', async () => {
    const s = byName('Index momentum');
    mount(null, `/app/strategies/${s.id}`);
    const status = await screen.findByLabelText('Validation status');
    expect(status).toHaveTextContent('Validation outdated');
    expect(status).toHaveTextContent(s.validation.reason);
    expect(status).toHaveTextContent('validation of version 1');
    expect(within(status).getByRole('link', { name: 'Validate it' })).toBeInTheDocument();
  });

  it('the scoring ranking shows each strategy status', () => {
    const rows = VS_SCORES.rows.filter((r) => r.status === 'SCORED');
    render(
      <MemoryRouter>
        <RankingTable rows={rows} selected={[]} onToggle={() => {}} open={null} onOpen={() => {}} />
      </MemoryRouter>,
    );
    const table = screen.getByRole('table', { name: 'Strategy ranking' });
    for (const r of rows)
      expect(within(table).getByRole('row', { name: new RegExp(r.name) })).toHaveTextContent(
        VALIDATION_STATUS_LABELS[r.validation.status],
      );
  });

  it('candidates show their status; the switch is off by default and warns when on', async () => {
    function Harness() {
      const [plan, setPlan] = useState<PlanDraft>({
        strategyIds: [],
        regime: '',
        limits: DEFAULT_LIMITS,
      });
      return (
        <>
          <PlanSettings plan={plan} onChange={setPlan} errors={{}} />
          <output data-testid="body">
            {JSON.stringify(
              buildTargetBody('1000', { ...plan, strategyIds: ['x'] }).ok &&
                (buildTargetBody('1000', { ...plan, strategyIds: ['x'] }) as { value: object })
                  .value,
            )}
          </output>
        </>
      );
    }
    mount(<Harness />);
    const list = await screen.findByRole('list', { name: 'Candidate strategies' });
    for (const s of VS_STRATEGIES)
      expect(within(list).getByText(s.name).closest('li')).toHaveTextContent(
        VALIDATION_STATUS_LABELS[s.validation.status],
      );
    const toggle = screen.getByRole('switch', { name: 'Include unvalidated strategies' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId('body')).toHaveTextContent('"require_validated":true');
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(screen.getByRole('note')).toHaveTextContent(/For experiments only/);
    expect(screen.getByTestId('body')).toHaveTextContent('"require_validated":false');
  });

  it('the not-allocated list shows each validation reason exactly as returned', () => {
    render(
      <MemoryRouter>
        <TargetView target={VS_TARGET_ON} />
      </MemoryRouter>,
    );
    const list = screen.getByRole('list', { name: 'Not allocated' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(VS_TARGET_ON.excluded.length);
    VS_TARGET_ON.excluded.forEach((e, i) => {
      expect(items[i]).toHaveTextContent(`${e.name}${e.reason}`);
      expect(items[i]).toHaveTextContent(VALIDATION_STATUS_LABELS[e.validation!.status]);
    });
    const table = screen.getByRole('table', { name: 'Selected strategies' });
    for (const p of VS_TARGET_ON.positions) {
      expect(p.validation!.eligible).toBe(true);
      expect(within(table).getByText(p.name!)).toBeInTheDocument();
    }
    expect(screen.queryByRole('note', { name: 'Unvalidated strategies included' })).toBeNull();
  });

  it('with the switch on, the result warns which unvalidated strategies got capital', () => {
    render(
      <MemoryRouter>
        <TargetView target={VS_TARGET_OFF} />
      </MemoryRouter>,
    );
    const unvalidated = VS_TARGET_OFF.positions.filter((p) => !p.validation!.eligible);
    expect(unvalidated.length).toBeGreaterThan(0);
    expect(screen.getByRole('note', { name: 'Unvalidated strategies included' })).toHaveTextContent(
      `Unvalidated strategies were included (for experiments): ${unvalidated.map((p) => p.name).join(', ')}.`,
    );
  });
});
