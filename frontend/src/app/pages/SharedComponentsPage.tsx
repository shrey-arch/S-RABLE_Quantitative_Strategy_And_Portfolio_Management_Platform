import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { DateText, MoneyText, PercentText } from '@/components/ui/value-text';
import { ACCOUNT_STATUSES, CONNECTION_STATUSES, EXECUTION_STATUSES } from '@/lib/enums';
import { setTheme, useTheme } from '@/lib/theme';

/** Developer page (/dev/shared): S-RABLE's own reusable components. Sample values only. */
export default function SharedComponentsPage() {
  const theme = useTheme();
  const [email, setEmail] = useState('');

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="page-title text-3xl">Shared components</h1>
          <p className="text-sm text-muted-foreground">Developer | sample values only</p>
        </div>
        <Button variant="outline" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Light' : 'Dark'} theme
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Status badges (backend enum values)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="Execution">
            {EXECUTION_STATUSES.map((s) => (
              <StatusBadge key={s} kind="execution" value={s} />
            ))}
          </Row>
          <Row label="Connection">
            {CONNECTION_STATUSES.map((s) => (
              <StatusBadge key={s} kind="connection" value={s} />
            ))}
          </Row>
          <Row label="Account">
            {ACCOUNT_STATUSES.map((s) => (
              <StatusBadge key={s} kind="account" value={s} />
            ))}
          </Row>
          <Row label="Active flag">
            <StatusBadge kind="active" value={true} />
            <StatusBadge kind="active" value={false} />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Values</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Money: <MoneyText value={100000} /> | <MoneyText value={-2500.5} colored /> |{' '}
            <MoneyText value={null} missingReason="Not returned by the backend" />
          </p>
          <p>
            Percent: <PercentText value={0.1234} /> | <PercentText value={-0.05} colored /> |{' '}
            <PercentText value={null} />
          </p>
          <p>
            Date: <DateText value="2025-01-31" /> |{' '}
            <DateText value="2026-10-14T10:00:00Z" withTime />
          </p>
          <SimulationLabel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Form field and confirm dialog</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Email"
            required
            hint="We never share your email."
            error={email && !email.includes('@') ? 'Enter a valid email address.' : undefined}
          >
            {(field) => (
              <Input {...field} value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </FormField>
          <ConfirmDialog
            trigger={<Button variant="destructive">Delete strategy...</Button>}
            title="Delete this strategy?"
            description="This cannot be undone."
            confirmLabel="Delete"
            onConfirm={() =>
              new Promise((resolve) => setTimeout(resolve, 1000)).then(() =>
                toast.success('Deleted (demo only)'),
              )
            }
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <EmptyState
          title="No strategies yet"
          description="Create your first strategy to get started."
          action={<Button size="sm">New strategy</Button>}
        />
        <ErrorState
          error={new ApiError(404, 'Not found or not available to you.')}
          onRetry={() => undefined}
        />
        <ErrorState
          error={new ApiError(0, 'Cannot reach the server. Check that the backend is running.')}
          onRetry={() => undefined}
        />
        <LoadingState />
      </div>
    </main>
  );
}

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 text-xs text-muted-foreground">{props.label}</span>
      {props.children}
    </div>
  );
}
