import { AlertCircle, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { formatINR } from '@/lib/format';
import { buildCreateBody } from './portfolio-model';
import { useCreatePortfolio, usePortfolios } from './queries';
import { Simulated } from './PortfolioViews';

/** New portfolio: name, description and initial capital (POST /portfolio/accounts). */
export function CreatePortfolioDialog(props: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ name: '', description: '', capital: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreatePortfolio();
  const sending = useRef(false);
  const navigate = useNavigate();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    const built = buildCreateBody(values);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    sending.current = true;
    try {
      const created = await create.mutateAsync(built.value);
      setOpen(false);
      setValues({ name: '', description: '', capital: '' });
      navigate(`/app/portfolios/${created.id}`);
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      sending.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && setOpen(next)}>
      <DialogTrigger asChild>
        {props.trigger ?? (
          <Button>
            <Plus /> New portfolio
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New portfolio</DialogTitle>
          <DialogDescription>
            A simulated portfolio: its capital starts as cash. No broker account is used and no
            order is ever placed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          {formError && (
            <div
              role="alert"
              className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
            >
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{formError}</span>
            </div>
          )}
          <FormField label="Name" required error={errors.name}>
            {(field) => (
              <Input
                {...field}
                maxLength={100}
                autoComplete="off"
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
              />
            )}
          </FormField>
          <FormField label="Description" hint="Optional.">
            {(field) => (
              <Textarea
                {...field}
                rows={2}
                value={values.description}
                onChange={(e) => setValues({ ...values, description: e.target.value })}
              />
            )}
          </FormField>
          <FormField
            label="Initial capital (Rs)"
            required
            error={errors.capital}
            hint="Simulated money, held as cash until you save holdings."
          >
            {(field) => (
              <Input
                {...field}
                inputMode="decimal"
                value={values.capital}
                onChange={(e) => setValues({ ...values, capital: e.target.value })}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Create portfolio
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** /app/portfolios - the user's simulated portfolios. */
export default function PortfoliosPage() {
  const list = usePortfolios();
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h1 className="page-title text-3xl">Portfolios</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Simulated portfolios: choose strategies, get a target allocation within your risk
            limits, plan a rebalance and save the result. Nothing here places an order.
          </p>
          <SimulationLabel />
        </div>
        <CreatePortfolioDialog />
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <LoadingState rows={4} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title="No portfolios yet"
          description="Create one with its initial capital; it starts as cash."
          action={<CreatePortfolioDialog />}
        />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border bg-card shadow-card">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Your portfolios</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Portfolio</th>
                <th className="px-4 py-2 text-right font-medium">Initial capital</th>
                <th className="px-4 py-2 text-right font-medium">Cash</th>
                <th className="px-4 py-2 text-right font-medium">Invested</th>
                <th className="px-4 py-2 text-right font-medium">Total equity</th>
                <th className="px-4 py-2 text-right font-medium">Holdings</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <Link
                      to={`/app/portfolios/${p.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.description && (
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatINR(p.initial_capital)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatINR(p.cash)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatINR(p.invested_value)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <span className="font-medium">{formatINR(p.total_equity)}</span>
                    <Simulated className="ml-2" />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.holdings_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
