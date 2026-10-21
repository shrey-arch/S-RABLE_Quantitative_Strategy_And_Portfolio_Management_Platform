import { ArrowLeft, Calculator, CircleSlash, RotateCcw, Save } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { Spinner } from '@/components/ui/spinner';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Section } from '@/features/results/parts';
import { useCurrentRegime } from '@/features/regime/queries';
import { useScores } from '@/features/scoring/queries';
import { formatINR } from '@/lib/format';
import { PlanSettings, RebalanceInputs, StateEditor } from './PortfolioForms';
import {
  buildRebalanceBody,
  buildStateBody,
  buildTargetBody,
  DEFAULT_LIMITS,
  draftFromAccount,
  draftFromEnding,
  isPortfolioTab,
  PORTFOLIO_TAB_LABELS,
  PORTFOLIO_TABS,
  type PlanDraft,
  type PortfolioAccount,
  type StateDraft,
} from './portfolio-model';
import {
  AccountStats,
  CalculationOnly,
  HoldingsView,
  RebalanceView,
  TargetView,
} from './PortfolioViews';
import {
  isNotAvailable,
  useAssetPrices,
  usePortfolio,
  useRebalance,
  useSaveState,
  useTarget,
} from './queries';

function BackLink() {
  return (
    <Link
      to="/app/portfolios"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden /> Portfolios
    </Link>
  );
}

function NotAvailable() {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
        <CircleSlash className="size-6" />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Portfolio not available</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This portfolio does not exist, or it belongs to another account.
      </p>
      <Button asChild className="mt-6">
        <Link to="/app/portfolios">Back to portfolios</Link>
      </Button>
    </div>
  );
}

/** The backend's message for a refused calculation (422), shown above the form. */
function Refused({ error }: { error: Error }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
    >
      {error.message}
    </p>
  );
}

/** Plan settings until the user changes them: every scored strategy, the current regime. */
function useDefaultPlan(): PlanDraft {
  const scores = useScores(null);
  const current = useCurrentRegime();
  return {
    strategyIds: (scores.data?.rows ?? [])
      .filter((r) => r.status === 'SCORED')
      .map((r) => r.strategy_id),
    regime: current.data?.regime.code ?? '',
    limits: DEFAULT_LIMITS,
  };
}

function Workspace({ account, id }: { account: PortfolioAccount; id: string }) {
  const [params, setParams] = useSearchParams();
  const value = params.get('tab');
  const tab = isPortfolioTab(value) ? value : 'overview';
  const setTab = (t: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (t === 'overview') p.delete('tab');
        else p.set('tab', t);
        return p;
      },
      { replace: true },
    );

  const defaults = useDefaultPlan();
  const [edited, setEdited] = useState<PlanDraft | null>(null);
  const plan = edited ?? defaults;
  const [planErrors, setPlanErrors] = useState<Record<string, string>>({});

  const target = useTarget();
  const [capital, setCapital] = useState<string | null>(null);
  const shownCapital = capital ?? account.total_equity;

  const rebalance = useRebalance();
  const held = account.holdings.map((h) => h.asset);
  const latest = useAssetPrices(held);
  const [editedPrices, setEditedPrices] = useState<Record<string, string>>({});
  const prices: Record<string, string> = {};
  for (const h of account.holdings) {
    const close = latest.data?.find((p) => p.asset === h.asset)?.price;
    prices[h.asset] = editedPrices[h.asset] ?? close ?? h.price;
  }
  const [minimumTrade, setMinimumTrade] = useState('0');
  const [rebalanceErrors, setRebalanceErrors] = useState<Record<string, string>>({});

  const [draft, setDraft] = useState<StateDraft | null>(null);
  const [fromPlan, setFromPlan] = useState(false);
  const shownDraft = draft ?? draftFromAccount(account);
  const [stateErrors, setStateErrors] = useState<Record<string, string>>({});
  const save = useSaveState(id);
  const sending = useRef(false);

  // A changed setting makes an earlier result stale: clear it.
  const changePlan = (next: PlanDraft) => {
    setEdited(next);
    target.reset();
    rebalance.reset();
  };

  const calculateTarget = () => {
    const built = buildTargetBody(shownCapital, plan);
    if (!built.ok) {
      setPlanErrors(built.errors);
      return;
    }
    setPlanErrors({});
    target.mutate(built.value);
  };

  const calculateRebalance = () => {
    const built = buildRebalanceBody(account, prices, minimumTrade, plan);
    if (!built.ok) {
      setPlanErrors(built.errors);
      setRebalanceErrors(built.errors);
      return;
    }
    setPlanErrors({});
    setRebalanceErrors({});
    rebalance.mutate(built.value);
  };

  const built = buildStateBody(shownDraft);
  const saveState = async () => {
    if (sending.current || !built.ok) return;
    sending.current = true;
    try {
      await save.mutateAsync(built.value);
      setDraft(null);
      setFromPlan(false);
      rebalance.reset();
      toast.success('Portfolio state saved.');
      setTab('overview');
    } catch (error) {
      toast.error(`Could not save: ${(error as Error).message}`);
    } finally {
      sending.current = false;
    }
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label="Portfolio sections" className="h-auto flex-wrap justify-start">
        {PORTFOLIO_TABS.map((t) => (
          <TabsTrigger key={t} value={t}>
            {PORTFOLIO_TAB_LABELS[t]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overview" className="space-y-6">
        <AccountStats account={account} />
        <HoldingsView account={account} />
      </TabsContent>

      <TabsContent value="target" className="space-y-6">
        <CalculationOnly />
        <PlanSettings plan={plan} onChange={changePlan} errors={planErrors} />
        <Section id="target-capital" title="Capital">
          <div className="flex flex-wrap items-end gap-3">
            <FormField
              label="Capital to allocate (Rs)"
              error={planErrors.capital}
              hint={`Prefilled with the saved total equity, ${formatINR(account.total_equity)}.`}
              className="max-w-xs"
            >
              {(field) => (
                <Input
                  {...field}
                  inputMode="decimal"
                  value={shownCapital}
                  onChange={(e) => {
                    setCapital(e.target.value);
                    target.reset();
                  }}
                />
              )}
            </FormField>
            <Button onClick={calculateTarget} disabled={target.isPending}>
              {target.isPending ? <Spinner /> : <Calculator />}
              Calculate target
            </Button>
          </div>
        </Section>
        {target.isError && <Refused error={target.error} />}
        {target.data && <TargetView target={target.data} />}
      </TabsContent>

      <TabsContent value="rebalance" className="space-y-6">
        <CalculationOnly />
        <PlanSettings plan={plan} onChange={changePlan} errors={planErrors} />
        <RebalanceInputs
          account={account}
          prices={prices}
          latest={latest.data}
          onPrice={(asset, v) => {
            setEditedPrices({ ...editedPrices, [asset]: v });
            rebalance.reset();
          }}
          minimumTrade={minimumTrade}
          onMinimumTrade={(v) => {
            setMinimumTrade(v);
            rebalance.reset();
          }}
          errors={rebalanceErrors}
        />
        <Button onClick={calculateRebalance} disabled={rebalance.isPending}>
          {rebalance.isPending ? <Spinner /> : <Calculator />}
          Calculate rebalance plan
        </Button>
        {rebalance.isError && <Refused error={rebalance.error} />}
        {rebalance.data && (
          <>
            <RebalanceView plan={rebalance.data} />
            {rebalance.data.ending_state && (
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(draftFromEnding(rebalance.data.ending_state!));
                  setFromPlan(true);
                  setStateErrors({});
                  setTab('state');
                }}
              >
                Use this result to edit and save
              </Button>
            )}
          </>
        )}
      </TabsContent>

      <TabsContent value="state" className="space-y-6">
        <Section
          id="save-state"
          title="Edit and save"
          description="Saving replaces the portfolio's cash and holdings. It is the only action here that changes anything, and it places no order."
        >
          {fromPlan && (
            <p role="note" className="rounded-md border bg-muted/50 p-3 text-sm">
              Filled in from the rebalance plan. Review it, then save.
            </p>
          )}
          <StateEditor
            draft={shownDraft}
            onChange={(next) => {
              setDraft(next);
              setStateErrors({});
            }}
            errors={stateErrors}
          />
          <div className="flex flex-wrap gap-2">
            {built.ok ? (
              <ConfirmDialog
                trigger={
                  <Button>
                    <Save /> Save state
                  </Button>
                }
                title="Save this state?"
                description={`Cash ${formatINR(built.value.cash)} and ${
                  Object.keys(built.value.holdings ?? {}).length
                } holding(s) will replace the saved state. Simulated: no order is placed.`}
                confirmLabel="Save"
                destructive={false}
                onConfirm={saveState}
              />
            ) : (
              <Button onClick={() => setStateErrors(built.errors)}>
                <Save /> Save state
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setDraft(null);
                setFromPlan(false);
                setStateErrors({});
              }}
            >
              <RotateCcw /> Reset to saved
            </Button>
          </div>
        </Section>
      </TabsContent>
    </Tabs>
  );
}

/** /app/portfolios/:id - one simulated portfolio: state, target, rebalance, save. */
export default function PortfolioDetailPage() {
  const { id = '' } = useParams();
  const query = usePortfolio(id);

  if (query.isError && isNotAvailable(query.error)) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <BackLink />
        <NotAvailable />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <BackLink />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {query.data ? query.data.name : 'Portfolio'}
        </h1>
        {query.data?.description && (
          <p className="text-sm text-muted-foreground">{query.data.description}</p>
        )}
        <SimulationLabel />
      </div>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <LoadingState rows={6} />
      ) : (
        <Workspace account={query.data} id={id} />
      )}
    </div>
  );
}
