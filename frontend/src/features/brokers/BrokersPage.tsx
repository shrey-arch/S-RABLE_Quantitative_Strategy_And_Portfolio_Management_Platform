import { Landmark, Pencil, PlugZap, Trash2, Unplug } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDateTime } from '@/lib/format';
import { AddBrokerDialog, ConnectBrokerDialog, EditBrokerDialog } from './BrokerDialogs';
import { accountName, brokerLabel, CONNECTION_NOTE, type BrokerAccount } from './broker-model';
import { useBrokerAccounts, useDeleteBroker, useDisconnectBroker } from './queries';

const failed = (error: unknown) => toast.error((error as Error).message);

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="truncate text-sm">{props.children}</dd>
    </div>
  );
}

function AccountCard(props: { account: BrokerAccount; onEdit: () => void; onConnect: () => void }) {
  const { account } = props;
  const disconnect = useDisconnectBroker();
  const remove = useDeleteBroker();
  const name = accountName(account);
  const titleId = `broker-${account.id}`;
  const connected = account.connection_status === 'CONNECTED';
  return (
    <li aria-labelledby={titleId} className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="truncate font-semibold">
            {name}
          </h2>
          <div className="flex flex-wrap gap-2">
            <StatusBadge kind="connection" value={account.connection_status} />
            <StatusBadge kind="active" value={account.is_active} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {connected ? (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="outline" aria-label={`Disconnect ${name}`}>
                  <Unplug aria-hidden /> Disconnect
                </Button>
              }
              title="Disconnect this broker account?"
              description="The backend deletes the stored access and refresh tokens. The account stays listed."
              confirmLabel="Disconnect"
              onConfirm={() => disconnect.mutateAsync(account.id).catch(failed)}
            />
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={props.onConnect}
              aria-label={`Connect ${name}`}
            >
              <PlugZap aria-hidden /> Connect
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={props.onEdit} aria-label={`Edit ${name}`}>
            <Pencil aria-hidden /> Edit
          </Button>
          <ConfirmDialog
            trigger={
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${name}`}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            }
            title="Delete this broker account?"
            description={`${name} and its stored keys and tokens are removed.`}
            confirmLabel="Delete"
            onConfirm={() => remove.mutateAsync(account.id).catch(failed)}
          />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Broker">{brokerLabel(account.broker_name)}</Field>
        <Field label="Broker user ID">{account.broker_user_id}</Field>
        <Field label="Alias">{account.account_alias ?? 'None'}</Field>
        <Field label="Last synced">
          {account.last_synced_at ? formatDateTime(account.last_synced_at) : 'Never'}
        </Field>
      </dl>
    </li>
  );
}

/** /app/brokers - the user's stored broker accounts. Nothing here trades. */
export default function BrokersPage() {
  const list = useBrokerAccounts();
  const [editing, setEditing] = useState<BrokerAccount | null>(null);
  const [connecting, setConnecting] = useState<BrokerAccount | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Landmark aria-hidden className="size-5 text-muted-foreground" />
            Brokers
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Broker accounts stored with your login. Keys and tokens are write-only: they are never
            shown after you save them.
          </p>
        </div>
        <AddBrokerDialog />
      </div>
      <p
        role="note"
        className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm text-info"
      >
        {CONNECTION_NOTE}
      </p>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <LoadingState rows={3} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title="No broker accounts yet"
          description="Add a broker account to keep its details for later. Nothing trades live."
        />
      ) : (
        <ul className="space-y-3" aria-label="Broker accounts">
          {list.data.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onEdit={() => setEditing(account)}
              onConnect={() => setConnecting(account)}
            />
          ))}
        </ul>
      )}
      {editing && (
        <EditBrokerDialog
          key={editing.id}
          account={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
      {connecting && (
        <ConnectBrokerDialog
          key={connecting.id}
          account={connecting}
          open
          onOpenChange={(open) => !open && setConnecting(null)}
        />
      )}
    </div>
  );
}
