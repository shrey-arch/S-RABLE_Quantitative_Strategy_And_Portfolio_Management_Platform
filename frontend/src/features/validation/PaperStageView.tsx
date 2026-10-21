import { Play } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { DEPLOY_NOTE, lossLimitFraction } from '@/features/paper/paper-model';
import { useStartPaperStage } from '@/features/paper/queries';
import { Row, Section } from '@/features/results/parts';
import { formatDate, formatINR, formatNumber, MISSING } from '@/lib/format';
import { StageStatusBadge, StageVerdict } from './StageViews';
import {
  moneyOrMissing,
  percentOrMissing,
  priorStagesPassed,
  type PaperStageInfo,
  type ValidationReport,
} from './validation-model';

const DECIMAL = /^\d+(\.\d+)?$/;

function StartForm({ report }: { report: ValidationReport }) {
  const start = useStartPaperStage();
  const [capital, setCapital] = useState('100000');
  const [loss, setLoss] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    const amount = Number(capital);
    if (!DECIMAL.test(capital.trim()) || amount <= 0) next.capital = 'Enter an amount above 0.';
    const fraction = lossLimitFraction(loss);
    if (fraction === undefined) next.loss = 'A percent above 0 and below 100, or empty.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setRefusal(null);
    try {
      const dep = await start.mutateAsync({
        validationId: report.id,
        capital: amount,
        loss_limit: fraction ?? null,
      });
      toast.success(`Paper trading started. It trades from ${formatDate(dep.start_date)}.`);
    } catch (e) {
      setRefusal((e as Error).message);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="max-w-md space-y-4">
      {refusal && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          {refusal}
        </p>
      )}
      <FormField
        label="Capital (Rs)"
        error={errors.capital}
        hint="Set aside from your paper account's available cash."
      >
        {(f) => (
          <Input
            {...f}
            inputMode="decimal"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
          />
        )}
      </FormField>
      <FormField
        label="Loss limit (%)"
        error={errors.loss}
        hint="Reaching it ends the stage as a breach (the stage fails). Empty for none."
      >
        {(f) => (
          <Input
            {...f}
            inputMode="decimal"
            value={loss}
            onChange={(e) => setLoss(e.target.value)}
          />
        )}
      </FormField>
      <Button type="submit" disabled={start.isPending}>
        {start.isPending ? <Spinner /> : <Play />}
        Start paper trading
      </Button>
    </form>
  );
}

function Tile(props: { label: string; value: string; note?: string }) {
  return (
    <div role="group" aria-label={props.label} className="rounded-lg border bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">{props.label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{props.value}</p>
      {props.note && <p className="text-xs text-muted-foreground">{props.note}</p>}
    </div>
  );
}

function PaperFigures({ paper }: { paper: PaperStageInfo }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Trading days"
          value={
            paper.days_planned === null
              ? formatNumber(paper.days_done, 0)
              : `${formatNumber(paper.days_done, 0)} of ${formatNumber(paper.days_planned, 0)}`
          }
        />
        <Tile
          label="Value"
          value={moneyOrMissing(paper.equity)}
          note={`Capital ${formatINR(paper.capital)}`}
        />
        <Tile label="Total return" value={percentOrMissing(paper.total_return)} />
        <Tile label="Max drawdown" value={percentOrMissing(paper.max_drawdown)} />
        <Tile
          label="Return retained"
          value={percentOrMissing(paper.retention)}
          note="Paper annualised return as a share of the backtest's"
        />
        <Tile
          label="Paper annualised return"
          value={percentOrMissing(paper.paper_annualized_mean_return)}
        />
        <Tile
          label="Backtest annualised return"
          value={percentOrMissing(paper.backtest_annualized_mean_return)}
          note="Stage 1"
        />
        <Tile
          label="Loss-limit breaches"
          value={formatNumber(paper.breaches, 0)}
          note={
            paper.loss_limit === null
              ? 'No loss limit'
              : `Limit ${percentOrMissing(paper.loss_limit)}`
          }
        />
      </div>
      <dl className="divide-y text-sm">
        <Row label="Deployment">
          <Link
            to={`/app/live/deployments/${paper.deployment_id}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            Open the paper deployment
          </Link>
          {` (${paper.status.toLowerCase()})`}
        </Row>
        <Row label="Dates">
          {formatDate(paper.start_date)} to {paper.end_date ? formatDate(paper.end_date) : MISSING}
        </Row>
        <Row label="Fills">{formatNumber(paper.fills, 0)}</Row>
      </dl>
    </>
  );
}

/** Stage 5: the validated strategy on the paper account for 30 days (Feature 1). */
export function PaperStageView({ report }: { report: ValidationReport }) {
  const stage = report.stages.paper_trading;
  const finished = stage.status === 'PASS' || stage.status === 'FAIL' || stage.status === 'ERROR';
  const canStart =
    stage.status === 'NOT_RUN' && report.status === 'COMPLETED' && priorStagesPassed(report);
  return (
    <div className="space-y-6">
      {finished && <StageVerdict stage={stage} source="app/validation/thresholds.py (stage 5)" />}
      <Section
        id="paper"
        title="Paper trading"
        actions={<StageStatusBadge status={stage.status} />}
        description="Stage 5 of the pipeline: the strategy trades your paper account on real closing prices with simulated money. Live trading is never offered."
      >
        {!finished && stage.reason && <p className="text-sm">{stage.reason}</p>}
        {stage.status === 'NOT_RUN' &&
          (canStart ? (
            <>
              <p className="text-sm text-muted-foreground">{DEPLOY_NOTE}</p>
              <StartForm report={report} />
            </>
          ) : (
            <p className="rounded-md border bg-muted/50 p-3 text-sm">
              It can start once stages 1 to 4 have passed.
            </p>
          ))}
        {stage.paper && <PaperFigures paper={stage.paper} />}
      </Section>
    </div>
  );
}
