import type { ColumnDef } from '@tanstack/react-table';
import { Play, Plus, RefreshCw, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { MoneyText } from '@/components/ui/value-text';
import { backtestable, entryFor, LIMITS } from '@/features/backtests/backtest-model';
import { InstrumentPicker } from '@/features/instruments/InstrumentPicker';
import { EquityChart } from '@/features/results/ResultsCharts';
import { useMyStrategies, useRegistry, type Strategy } from '@/features/strategies/queries';
import { formatDate, formatINR, formatNumber, formatPercent, MISSING } from '@/lib/format';
import {
  buildDeployBody,
  DEPLOY_NOTE,
  DEPLOYMENT_STATUS_LABELS,
  emptyDeploy,
  tradable,
  type AccountPerformance,
  type DeployDraft,
  type PaperDeployment,
  type PaperPerformance,
} from './paper-model';
import { Tile } from './PaperViews';
import { useAccountPerformance, useDeploy, useDeployments, useRunDue } from './queries';

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? MISSING : formatPercent(v);
const ratio = (v: number | null | undefined) =>
  v === null || v === undefined ? MISSING : formatNumber(v, 2);

/** The backend's performance figures (GET /paper/...): nothing is computed here. */
export function PerformanceTiles(props: { performance: PaperPerformance; label: string }) {
  const p = props.performance;
  const why = (key: string) => p.null_reasons[key];
  return (
    <section aria-label={props.label} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Value" hint={`Started at ${formatINR(p.start_value)}`}>
        <MoneyText value={p.end_value} />
      </Tile>
      <Tile label="Total return" hint={`${formatNumber(p.days, 0)} trading days`}>
        {pct(p.total_return)}
      </Tile>
      <Tile label="Max drawdown">{pct(p.max_drawdown)}</Tile>
      <Tile label="Sharpe ratio" hint={why('sharpe_ratio')}>
        {ratio(p.sharpe_ratio)}
      </Tile>
      <Tile label="Annualised return" hint={why('annualized_mean_return')}>
        {pct(p.annualized_mean_return)}
      </Tile>
      <Tile label="Annualised volatility" hint={why('annualized_volatility')}>
        {pct(p.annualized_volatility)}
      </Tile>
      <Tile
        label="Win rate"
        hint={`${formatNumber(p.winning_trades, 0)} of ${formatNumber(p.closed_trades, 0)} sells`}
      >
        {pct(p.win_rate)}
      </Tile>
      <Tile label="Realised P&L" hint={`Charges ${formatINR(p.charges)} \u00b7 ${p.fills} fills`}>
        <MoneyText value={p.realised_pnl} colored />
      </Tile>
    </section>
  );
}

// --- deploy -----------------------------------------------------------------------

/** Strategies the daily job can trade: a backtestable one whose layout is not a pair. */
function deployable(strategies: Strategy[], registry: ReturnType<typeof useRegistry>['data']) {
  const entries = registry ?? [];
  return backtestable(strategies, entries).filter(
    (s) => entryFor(s, entries)?.instruments !== 'pair',
  );
}

export function DeployDialog(props: { onClose: () => void; onDeployed: (id: string) => void }) {
  const strategies = useMyStrategies();
  const registry = useRegistry();
  const deploy = useDeploy();
  const [draft, setDraft] = useState<DeployDraft>(emptyDeploy);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const usable = useMemo(
    () => deployable(strategies.data ?? [], registry.data),
    [strategies.data, registry.data],
  );
  const strategy = usable.find((s) => s.id === draft.strategyId);
  const layout = strategy ? entryFor(strategy, registry.data ?? [])?.instruments : 'single';
  const universe = layout === 'universe';
  const set = (patch: Partial<DeployDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const choose = (id: string) => {
    const s = usable.find((x) => x.id === id);
    const isUniverse = s && entryFor(s, registry.data ?? [])?.instruments === 'universe';
    const kept = draft.instrumentIds.filter(Boolean);
    set({
      strategyId: id,
      instrumentIds: isUniverse
        ? [kept[0] ?? '', kept[1] ?? '', ...kept.slice(2)]
        : [kept[0] ?? ''],
    });
  };
  const setSlot = (index: number, id: string) =>
    set({ instrumentIds: draft.instrumentIds.map((v, i) => (i === index ? id : v)) });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const built = buildDeployBody(draft, !universe);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setRefusal(null);
    try {
      const dep = await deploy.mutateAsync(built.body);
      toast.success(`${dep.name} deployed. It trades from ${formatDate(dep.start_date)}.`);
      props.onDeployed(dep.id);
    } catch (e) {
      setRefusal((e as Error).message);
    }
  };

  const loading = strategies.isPending || registry.isPending;
  return (
    <Dialog open onOpenChange={(open) => !open && !deploy.isPending && props.onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Deploy a strategy</DialogTitle>
          <DialogDescription>{DEPLOY_NOTE}</DialogDescription>
        </DialogHeader>
        {strategies.isError || registry.isError ? (
          <ErrorState
            error={strategies.error ?? registry.error}
            onRetry={() => {
              void strategies.refetch();
              void registry.refetch();
            }}
          />
        ) : loading ? (
          <LoadingState rows={3} />
        ) : usable.length === 0 ? (
          <EmptyState
            title="No strategy to deploy"
            description="Save a strategy from a core template or build one without code (with an entry condition) first. Pair strategies cannot be deployed."
          />
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            {refusal && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
              >
                {refusal}
              </p>
            )}
            <FormField
              label="Strategy"
              error={errors.strategy_id}
              hint="Runs with the strategy's saved parameters or rules."
            >
              {(f) => (
                <NativeSelect
                  {...f}
                  value={draft.strategyId}
                  onChange={(e) => choose(e.target.value)}
                >
                  <NativeSelectOption value="">Choose a strategy</NativeSelectOption>
                  {usable.map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            {draft.instrumentIds.map((value, index) => (
              <FormField
                key={index}
                label={universe ? `Asset ${index + 1}` : 'Instrument'}
                error={index === 0 ? errors.instrument_id : undefined}
                hint={index === 0 ? 'NSE equities and ETFs.' : undefined}
              >
                {(f) => (
                  <div className="flex gap-2">
                    <InstrumentPicker
                      {...f}
                      className="flex-1"
                      value={value}
                      filter={tradable}
                      onChange={(id) => setSlot(index, id)}
                    />
                    {universe && index >= 2 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove asset ${index + 1}`}
                        onClick={() =>
                          set({ instrumentIds: draft.instrumentIds.filter((_, i) => i !== index) })
                        }
                      >
                        <X aria-hidden className="size-4" />
                      </Button>
                    )}
                  </div>
                )}
              </FormField>
            ))}
            {universe && draft.instrumentIds.length < LIMITS.instrumentsMax && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set({ instrumentIds: [...draft.instrumentIds, ''] })}
              >
                <Plus /> Add asset
              </Button>
            )}
            {!universe && (
              <FormField
                label="Quantity"
                error={errors.quantity}
                hint="Shares bought on a buy signal."
              >
                {(f) => (
                  <Input
                    {...f}
                    inputMode="numeric"
                    value={draft.quantity}
                    onChange={(e) => set({ quantity: e.target.value })}
                  />
                )}
              </FormField>
            )}
            <FormField
              label="Capital (Rs)"
              error={errors.capital}
              hint="Set aside from the account's available cash; the strategy trades only this."
            >
              {(f) => (
                <Input
                  {...f}
                  inputMode="decimal"
                  value={draft.capital}
                  onChange={(e) => set({ capital: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              label="Loss limit (%)"
              error={errors.loss_limit}
              hint="Pauses the deployment when its value falls this far below the capital. Empty for none."
            >
              {(f) => (
                <Input
                  {...f}
                  inputMode="decimal"
                  value={draft.lossLimitPct}
                  onChange={(e) => set({ lossLimitPct: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              label="Duration (calendar days)"
              error={errors.duration_days}
              hint="Completes after this many days. Empty to run until you stop it."
            >
              {(f) => (
                <Input
                  {...f}
                  inputMode="numeric"
                  value={draft.durationDays}
                  onChange={(e) => set({ durationDays: e.target.value })}
                />
              )}
            </FormField>
            <DialogFooter>
              <Button type="submit" disabled={deploy.isPending}>
                {deploy.isPending ? <Spinner /> : <Play />}
                Deploy
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- the list ---------------------------------------------------------------------

export function DeploymentsTable({ deployments }: { deployments: PaperDeployment[] }) {
  const columns = useMemo<ColumnDef<PaperDeployment>[]>(
    () => [
      {
        id: 'name',
        header: 'Deployment',
        accessorFn: (d) => d.name,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <Link
              to={`/app/live/deployments/${row.original.id}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.validation_id && (
              <p className="text-xs text-muted-foreground">Validation stage 5</p>
            )}
          </div>
        ),
      },
      {
        id: 'instruments',
        header: 'Instruments',
        accessorFn: (d) => d.instruments.map((i) => i.symbol).join(', '),
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (d) => DEPLOYMENT_STATUS_LABELS[d.status] ?? d.status,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <StatusBadge kind="paperDeployment" value={row.original.status} />
            {row.original.status_reason && (
              <p className="max-w-56 text-xs text-muted-foreground">{row.original.status_reason}</p>
            )}
          </div>
        ),
      },
      { id: 'capital', header: 'Capital', accessorFn: (d) => formatINR(d.capital) },
      {
        id: 'value',
        header: 'Value',
        accessorFn: (d) => d.performance.end_value,
        cell: ({ row }) => <MoneyText value={row.original.performance.end_value} />,
      },
      {
        id: 'return',
        header: 'Return',
        accessorFn: (d) => d.performance.total_return,
        cell: ({ row }) => pct(row.original.performance.total_return),
      },
      {
        id: 'last',
        header: 'Last close traded',
        accessorFn: (d) => d.last_processed_date ?? '',
        cell: ({ row }) =>
          row.original.last_processed_date
            ? formatDate(row.original.last_processed_date)
            : `From ${formatDate(row.original.start_date)}`,
      },
    ],
    [],
  );
  return (
    <DataTable
      caption="Strategy deployments"
      columns={columns}
      data={deployments}
      empty={
        <EmptyState
          title="No deployments"
          description="Deploy a saved strategy and the daily job trades it at each close."
        />
      }
    />
  );
}

export function DeploymentsPanel(props: { onDeployed: (id: string) => void }) {
  const deployments = useDeployments();
  const runDue = useRunDue();
  const [deploying, setDeploying] = useState(false);
  const run = async () => {
    try {
      const r = await runDue.mutateAsync();
      toast.success(
        `Processed ${r.days_processed} deployment day${r.days_processed === 1 ? '' : 's'} through ${formatDate(r.through)}.`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">{DEPLOY_NOTE}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={run} disabled={runDue.isPending}>
            {runDue.isPending ? <Spinner /> : <RefreshCw />}
            Run due days now
          </Button>
          <Button onClick={() => setDeploying(true)}>
            <Plus /> Deploy strategy
          </Button>
        </div>
      </div>
      {deployments.isError ? (
        <ErrorState error={deployments.error} onRetry={() => void deployments.refetch()} />
      ) : !deployments.data ? (
        <LoadingState rows={3} />
      ) : (
        <DeploymentsTable deployments={deployments.data} />
      )}
      {deploying && (
        <DeployDialog
          onClose={() => setDeploying(false)}
          onDeployed={(id) => {
            setDeploying(false);
            props.onDeployed(id);
          }}
        />
      )}
    </div>
  );
}

// --- account performance ----------------------------------------------------------

export function AccountPerformanceView({ data }: { data: AccountPerformance }) {
  const points = data.snapshots.map((s) => ({ time: s.day, value: s.equity }));
  return (
    <div className="space-y-4">
      <PerformanceTiles performance={data.performance} label="Account performance" />
      {points.length === 0 ? (
        <EmptyState
          title="No closes recorded yet"
          description="The daily job records the account's value after each NSE close."
        />
      ) : (
        <EquityChart
          strategy={points}
          benchmark={null}
          benchmarkLabel=""
          seriesLabel="Account"
          label={`Account value at each close, ${points.length} closes`}
        />
      )}
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {data.basis.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

export function PerformancePanel() {
  const performance = useAccountPerformance();
  if (performance.isError)
    return <ErrorState error={performance.error} onRetry={() => void performance.refetch()} />;
  if (!performance.data) return <LoadingState rows={4} />;
  return <AccountPerformanceView data={performance.data} />;
}
