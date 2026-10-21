import { CircleCheck, Copy } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { MISSING } from '@/lib/format';
import { coreInfo, formatParamValue, instrumentNeed, type RegistryEntry } from './core-strategies';
import { StrategyFormDialog } from './StrategyFormDialog';

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {props.title}
      </h4>
      {props.children}
    </div>
  );
}

/** One built-in strategy. Everything except the wording comes from GET /strategy-registry. */
export function CoreStrategyCard({ entry }: { entry: RegistryEntry }) {
  const info = coreInfo(entry.strategy_key);
  const headingId = `core-${entry.strategy_key}`;

  return (
    <Card aria-labelledby={headingId} className="gap-4" role="article">
      <CardHeader>
        <h3 id={headingId} className="leading-none font-semibold">
          {info.name}
        </h3>
        <CardDescription>{info.summary}</CardDescription>
        <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-success">
          <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0" />
          Can be backtested. {instrumentNeed(entry.instruments)}
        </p>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {info.logic.length > 0 && (
          <Section title="How it decides">
            <ul className="list-disc space-y-0.5 pl-4">
              {info.logic.map(([when, then]) => (
                <li key={when}>
                  {when}
                  {then && (
                    <>
                      {' '}
                      &rarr; <span className="font-medium">{then}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Section title="Inputs">
            <p>
              {entry.required_inputs.length > 0
                ? entry.required_inputs.join(', ')
                : 'Price columns of several assets'}
            </p>
          </Section>
          <Section title="Calculates">
            <p>{info.indicators.length > 0 ? info.indicators.join('; ') : MISSING}</p>
          </Section>
          <Section title="Output">
            <p>{info.outputs}</p>
          </Section>
        </div>

        <Section title="Default parameters">
          {entry.parameters.length === 0 ? (
            <p className="text-muted-foreground">No parameters.</p>
          ) : (
            <table className="w-full text-left">
              <caption className="sr-only">{`${info.name} default parameters`}</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Parameter</th>
                  <th scope="col">Default</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entry.parameters.map((param) => (
                  <tr key={param.name}>
                    <td className="py-1.5 pr-3 align-top">
                      <code className="font-mono text-xs">{param.name}</code>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {param.type ?? 'any'}
                        {param.required ? ', required' : ''}
                      </span>
                      {info.parameterHelp[param.name] && (
                        <p className="text-xs text-muted-foreground">
                          {info.parameterHelp[param.name]}
                        </p>
                      )}
                    </td>
                    <td className="py-1.5 text-right align-top font-mono text-xs tabular-nums">
                      {formatParamValue(param)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
          <Link to="/app/scoring" className="font-medium text-primary hover:underline">
            Scores and regime fit
          </Link>
          <StrategyFormDialog
            target={{ kind: 'new', templateKey: entry.strategy_key }}
            trigger={
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                aria-label={`Use ${info.name} as a template`}
              >
                <Copy /> Use as template
              </Button>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
