import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { conditionText, readConfig, type Condition } from './strategy-config';

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function ConditionList({ items, label }: { items: Condition[]; label: string }) {
  if (items.length === 0) return <Empty>{`No ${label} conditions.`}</Empty>;
  return (
    <ol className="space-y-1.5 text-sm">
      {items.map((c, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
          <code className="font-mono text-xs leading-5">{conditionText(c)}</code>
        </li>
      ))}
    </ol>
  );
}

/** The saved StrategyConfig, read-only: parameters, indicators, entry and exit conditions. */
export function StrategyConfigView({ config }: { config: unknown }) {
  const view = readConfig(config);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card className="gap-3" aria-labelledby="cfg-parameters">
        <CardHeader>
          <CardTitle id="cfg-parameters" className="text-base">
            Parameters
          </CardTitle>
        </CardHeader>
        <CardContent>
          {view.parameters.length === 0 ? (
            <Empty>No parameters.</Empty>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Parameters</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="pb-1 font-medium">
                    Name
                  </th>
                  <th scope="col" className="pb-1 text-right font-medium">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {view.parameters.map(([name, value]) => (
                  <tr key={name}>
                    <td className="py-1.5 font-mono text-xs">{name}</td>
                    <td className="py-1.5 text-right font-mono text-xs tabular-nums">
                      {String(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="gap-3" aria-labelledby="cfg-indicators">
        <CardHeader>
          <CardTitle id="cfg-indicators" className="text-base">
            Indicators
          </CardTitle>
        </CardHeader>
        <CardContent>
          {view.indicators.length === 0 ? (
            <Empty>No indicators.</Empty>
          ) : (
            <ul className="divide-y text-sm">
              {view.indicators.map((ind) => (
                <li key={ind.name} className="py-1.5">
                  <span className="font-mono text-xs">{ind.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{ind.type}</span>
                  {Object.keys(ind.parameters ?? {}).length > 0 && (
                    <p className="font-mono text-xs text-muted-foreground">
                      {Object.entries(ind.parameters)
                        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                        .join(', ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="gap-3" aria-labelledby="cfg-entry">
        <CardHeader>
          <CardTitle id="cfg-entry" className="text-base">
            Entry conditions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ConditionList items={view.entry} label="entry" />
        </CardContent>
      </Card>

      <Card className="gap-3" aria-labelledby="cfg-exit">
        <CardHeader>
          <CardTitle id="cfg-exit" className="text-base">
            Exit conditions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ConditionList items={view.exit} label="exit" />
        </CardContent>
      </Card>

      <details className="rounded-xl border bg-card shadow-card p-4 text-sm lg:col-span-2">
        <summary className="cursor-pointer font-medium">Advanced: raw configuration (JSON)</summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {JSON.stringify(config, null, 2)}
        </pre>
      </details>
    </div>
  );
}
