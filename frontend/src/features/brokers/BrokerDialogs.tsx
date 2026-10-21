import { AlertCircle, Plus } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@/api/errors';
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
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  accountName,
  BROKER_LABELS,
  BROKER_NAMES,
  buildConnectBody,
  buildCreateBody,
  EMPTY_DRAFT,
  SECRET_NOTE,
  type AccountDraft,
  type BrokerAccount,
  type BrokerName,
} from './broker-model';
import { useConnectBroker, useCreateBroker, useUpdateBroker } from './queries';

/** The backend's 422 field messages, without pydantic's "Value error, " prefix. */
const fieldErrorsOf = (error: unknown): Record<string, string> =>
  error instanceof ApiError && error.isValidation
    ? Object.fromEntries(
        Object.entries(error.fieldErrors).map(([k, v]) => [k, v.replace(/^Value error, /, '')]),
      )
    : {};

function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
    >
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span>{message}</span>
    </div>
  );
}

/** A write-only secret: typed once, sent once, never shown again. */
function SecretField(props: {
  label: string;
  value: string;
  error?: string;
  required?: boolean;
  hint?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={props.label} required={props.required} error={props.error} hint={props.hint}>
      {(field) => (
        <Input
          {...field}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </FormField>
  );
}

/** Add a broker account: POST /brokers/accounts. 409 = the same broker user ID already added. */
export function AddBrokerDialog(props: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateBroker();
  const sending = useRef(false);
  const set = (patch: Partial<AccountDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const reset = () => {
    // Secrets never stay in the page after the dialog closes.
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setFormError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    const built = buildCreateBody(draft);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    sending.current = true;
    try {
      await create.mutateAsync(built.value);
      reset();
      setOpen(false);
    } catch (error) {
      setErrors(fieldErrorsOf(error));
      setFormError((error as Error).message);
    } finally {
      sending.current = false;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return;
        if (!next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {props.trigger ?? (
          <Button>
            <Plus /> Add broker account
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add broker account</DialogTitle>
          <DialogDescription>{SECRET_NOTE}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormAlert message={formError} />
          <FormField label="Broker" required error={errors.broker_name}>
            {(field) => (
              <NativeSelect
                {...field}
                className="w-full"
                value={draft.broker_name}
                onChange={(e) => set({ broker_name: e.target.value as BrokerName })}
              >
                {BROKER_NAMES.map((name) => (
                  <NativeSelectOption key={name} value={name}>
                    {BROKER_LABELS[name]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label="Broker user ID" required error={errors.broker_user_id}>
            {(field) => (
              <Input
                {...field}
                autoComplete="off"
                maxLength={100}
                value={draft.broker_user_id}
                onChange={(e) => set({ broker_user_id: e.target.value })}
              />
            )}
          </FormField>
          <FormField
            label="Alias"
            hint="Optional name for this account."
            error={errors.account_alias}
          >
            {(field) => (
              <Input
                {...field}
                autoComplete="off"
                maxLength={100}
                value={draft.account_alias}
                onChange={(e) => set({ account_alias: e.target.value })}
              />
            )}
          </FormField>
          <SecretField
            label="API key"
            required
            value={draft.api_key}
            error={errors.api_key}
            onChange={(api_key) => set({ api_key })}
          />
          <SecretField
            label="API secret"
            required
            value={draft.api_secret}
            error={errors.api_secret}
            onChange={(api_secret) => set({ api_secret })}
          />
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Save account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edit alias and active: PATCH /brokers/accounts/{id}. An empty alias clears it. */
export function EditBrokerDialog(props: {
  account: BrokerAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { account } = props;
  const [alias, setAlias] = useState(account.account_alias ?? '');
  const [active, setActive] = useState(account.is_active);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const update = useUpdateBroker();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (update.isPending) return;
    if (alias.trim().length > 100) {
      setErrors({ account_alias: 'At most 100 characters.' });
      return;
    }
    setErrors({});
    setFormError(null);
    try {
      await update.mutateAsync({
        id: account.id,
        account_alias: alias.trim(),
        is_active: active,
      });
      props.onOpenChange(false);
    } catch (error) {
      setErrors(fieldErrorsOf(error));
      setFormError((error as Error).message);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => !update.isPending && props.onOpenChange(next)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit broker account</DialogTitle>
          <DialogDescription>
            {`${accountName(account)}. Only the alias and whether the account is active can be changed.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormAlert message={formError} />
          <FormField
            label="Alias"
            hint="Leave empty to remove the alias."
            error={errors.account_alias}
          >
            {(field) => (
              <Input
                {...field}
                autoComplete="off"
                maxLength={100}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
              />
            )}
          </FormField>
          <div className="flex items-center gap-2">
            <Switch id="broker-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="broker-active">Active</Label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Spinner />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Store tokens: POST /brokers/accounts/{id}/connect. The backend marks it CONNECTED. */
export function ConnectBrokerDialog(props: {
  account: BrokerAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tokens, setTokens] = useState({ access_token: '', refresh_token: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const connect = useConnectBroker();
  const close = () => {
    setTokens({ access_token: '', refresh_token: '' });
    setErrors({});
    setFormError(null);
    props.onOpenChange(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (connect.isPending) return;
    const built = buildConnectBody(tokens);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    try {
      await connect.mutateAsync({ id: props.account.id, body: built.value });
      close();
    } catch (error) {
      setErrors(fieldErrorsOf(error));
      setFormError((error as Error).message);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (connect.isPending) return;
        if (next) props.onOpenChange(true);
        else close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect broker account</DialogTitle>
          <DialogDescription>
            {`${accountName(props.account)}. ${SECRET_NOTE} Connecting stores the tokens; it does not enable trading.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <FormAlert message={formError} />
          <SecretField
            label="Access token"
            required
            value={tokens.access_token}
            error={errors.access_token}
            onChange={(access_token) => setTokens((t) => ({ ...t, access_token }))}
          />
          <SecretField
            label="Refresh token"
            hint="Optional."
            value={tokens.refresh_token}
            error={errors.refresh_token}
            onChange={(refresh_token) => setTokens((t) => ({ ...t, refresh_token }))}
          />
          <DialogFooter>
            <Button type="submit" disabled={connect.isPending}>
              {connect.isPending && <Spinner />}
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
