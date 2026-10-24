import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { MISSING } from '@/lib/format';
import { IndicatorForm } from './IndicatorForm';
import {
  coreStrategyName,
  limitText,
  panelLabel,
  useIndicators,
  type IndicatorConfigValue,
  type IndicatorInfo,
} from './queries';

const DOT = String.fromCharCode(0xb7);

function IndicatorCard({ indicator }: { indicator: IndicatorInfo }) {
  const titleId = `indicator-${indicator.key}`;
  return (
    <Card className="min-w-0 gap-4" aria-labelledby={titleId}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 id={titleId} className="leading-none font-semibold">
              {indicator.name}
            </h3>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{indicator.key}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{indicator.category}</Badge>
            <Badge variant="outline">{panelLabel(indicator.panel)}</Badge>
          </div>
        </div>
        <CardDescription>{indicator.definition}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ul aria-label={`${indicator.name} parameters`} className="divide-y rounded-md border">
          {indicator.parameters.map((p) => (
            <li key={p.name} className="space-y-0.5 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-mono">{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  {p.type === 'int' ? 'Whole number' : 'Number'} {DOT} {limitText(p)} {DOT}{' '}
                  {p.default === null ? 'required' : `default ${p.default}`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{p.description}</p>
            </li>
          ))}
        </ul>
        {indicator.rules.length > 0 && (
          <p className="text-muted-foreground">Rule: {indicator.rules.join(' ')}</p>
        )}
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Outputs</dt>
          <dd className="font-mono text-xs leading-5">{indicator.outputs.join(', ')}</dd>
          <dt className="text-muted-foreground">Uses</dt>
          <dd>{indicator.required_columns.join(', ')}</dd>
          <dt className="text-muted-foreground">Used by core strategies</dt>
          <dd>
            {indicator.used_by.length
              ? indicator.used_by.map(coreStrategyName).join(', ')
              : MISSING}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}

function ParameterCheck({ catalogue }: { catalogue: IndicatorInfo[] }) {
  const [accepted, setAccepted] = useState<IndicatorConfigValue | null>(null);
  return (
    <Card role="region" className="gap-4" aria-labelledby="check-title">
      <CardHeader>
        <CardTitle id="check-title" className="text-base">
          Check parameters
        </CardTitle>
        <CardDescription>
          The same check the backend runs when a strategy is saved. Defaults are filled in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <IndicatorForm
          catalogue={catalogue}
          showName={false}
          submitLabel="Check"
          onSave={setAccepted}
        />
        {accepted && (
          <p role="status" className="flex items-center gap-2 text-sm text-success">
            <CircleCheck aria-hidden className="size-4" />
            Accepted: {accepted.type}{' '}
            {Object.entries(accepted.parameters)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** /app/indicators - the indicator types the backend calculates (GET /indicators). */
export default function IndicatorsPage() {
  const query = useIndicators();

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="page-title text-3xl">Indicators</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          The indicator types the backend calculates. A strategy configuration can only use these,
          and charts show series computed by the backend from stored daily bars.
        </p>
      </div>

      {query.isPending ? (
        <div role="status" aria-label="Loading indicators" className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState title="No indicators" description="The backend lists no indicator types." />
      ) : (
        <>
          <ParameterCheck catalogue={query.data} />
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {query.data.map((indicator) => (
              <IndicatorCard key={indicator.key} indicator={indicator} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
