import { AlertCircle, Clock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
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
import { MoneyText } from '@/components/ui/value-text';
import { InstrumentPicker } from '@/features/instruments/InstrumentPicker';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  buildOrderBody,
  CHARGE_KEYS,
  CHARGE_LABELS,
  needsPrice,
  needsTrigger,
  ORDER_TYPE_HELP,
  ORDER_TYPE_LABELS,
  ORDER_TYPES,
  SIDES,
  placedMessage,
  tradable,
  type OrderBody,
  type OrderType,
  type TicketDraft,
} from './paper-model';
import { useOrderPreview, usePlaceOrder } from './queries';

/** Waits until the user stops typing before asking for a preview. */
function useDebounced<T>(value: T, ms = 400): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setCurrent(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return current;
}

function Preview(props: { body: OrderBody | null }) {
  const preview = useOrderPreview(props.body);
  if (!props.body)
    return <p className="text-sm text-muted-foreground">Fill in the order to see its cost.</p>;
  if (preview.isError)
    return <p className="text-sm text-destructive">{(preview.error as Error).message}</p>;
  const p = preview.data;
  if (!p) return <p className="text-sm text-muted-foreground">Calculating...</p>;
  return (
    <section
      aria-label="Order estimate"
      className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm"
    >
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Last price</dt>
        <dd className="text-right">
          {p.quote ? (
            <>
              <MoneyText value={p.quote.price} />
              <span className="block text-xs text-muted-foreground">
                {formatDateTime(p.quote.time)} (delayed)
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{p.quote_problem ?? 'Not available'}</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Estimated price</dt>
        <dd className="text-right">
          <MoneyText value={p.estimated_price} missingReason="Needs a price" />
        </dd>
        <dt className="text-muted-foreground">Estimated value</dt>
        <dd className="text-right">
          <MoneyText value={p.estimated_value} missingReason="Needs a price" />
        </dd>
        {p.charges &&
          CHARGE_KEYS.filter((k) => (p.charges?.[k] ?? 0) !== 0 || k === 'stt').map((k) => (
            <div key={k} className="contents text-xs">
              <dt className="pl-2 text-muted-foreground">{CHARGE_LABELS[k]}</dt>
              <dd className="text-right">
                <MoneyText value={p.charges?.[k]} />
              </dd>
            </div>
          ))}
        <dt className="text-muted-foreground">Charges</dt>
        <dd className="text-right">
          <MoneyText value={p.charges?.total} missingReason="Needs a price" />
        </dd>
        <dt className="font-medium">
          {props.body.side === 'BUY' ? 'Estimated total cost' : 'Estimated proceeds'}
        </dt>
        <dd className="text-right font-medium">
          <MoneyText value={p.estimated_total} missingReason="Needs a price" />
        </dd>
        <dt className="text-muted-foreground">Available cash</dt>
        <dd className="text-right">
          <MoneyText value={p.available_cash} />
        </dd>
      </dl>
      {p.after_market && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <Clock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {`The market is closed: this is an after-market order for the session on ${formatDate(p.session_date)}.`}
        </p>
      )}
      {p.problem && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {p.problem}
        </p>
      )}
    </section>
  );
}

/** Buy or sell on the paper account. Checked by the backend before it is placed. */
export function OrderTicket(props: { draft: TicketDraft; onClose: () => void }) {
  const [draft, setDraft] = useState<TicketDraft>(props.draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const place = usePlaceOrder();
  const sending = useRef(false);
  const built = useMemo(() => buildOrderBody(draft), [draft]);
  const previewBody = useDebounced(built.ok ? built.body : null);
  const set = (patch: Partial<TicketDraft>) => setDraft({ ...draft, ...patch });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setFormError(null);
    sending.current = true;
    try {
      const order = await place.mutateAsync(built.body);
      if (order.status === 'REJECTED') toast.error(placedMessage(order));
      else toast.success(placedMessage(order));
      props.onClose();
    } catch (error) {
      if (error instanceof ApiError && error.isValidation)
        setErrors(
          Object.fromEntries(
            Object.entries(error.fieldErrors).map(([k, v]) => [k, v.replace(/^Value error, /, '')]),
          ),
        );
      setFormError((error as Error).message);
    } finally {
      sending.current = false;
    }
  };

  const type = draft.orderType;
  return (
    <Dialog open onOpenChange={(open) => !open && !place.isPending && props.onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paper order</DialogTitle>
          <DialogDescription>
            Delivery (CNC). Virtual money: S-RABLE fills it on delayed quotes; nothing goes to a
            broker.
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
          <div role="radiogroup" aria-label="Side" className="grid grid-cols-2 gap-2">
            {SIDES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={draft.side === s}
                onClick={() => set({ side: s })}
                className={cn(
                  'h-9 rounded-md border text-sm font-semibold',
                  draft.side === s
                    ? s === 'BUY'
                      ? 'border-success bg-success text-white'
                      : 'border-destructive bg-destructive text-white'
                    : 'bg-transparent text-muted-foreground',
                )}
              >
                {s === 'BUY' ? 'Buy' : 'Sell'}
              </button>
            ))}
          </div>
          <FormField label="Instrument" required error={errors.instrument_id}>
            {(field) => (
              <InstrumentPicker
                {...field}
                value={draft.instrumentId}
                filter={tradable}
                onChange={(id) => set({ instrumentId: id })}
                className="w-full"
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Order type" hint={ORDER_TYPE_HELP[type]}>
              {(field) => (
                <NativeSelect
                  {...field}
                  className="w-full"
                  value={type}
                  onChange={(e) => set({ orderType: e.target.value as OrderType })}
                >
                  {ORDER_TYPES.map((t) => (
                    <NativeSelectOption key={t} value={t}>
                      {ORDER_TYPE_LABELS[t]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField label="Quantity" required error={errors.quantity}>
              {(field) => (
                <Input
                  {...field}
                  inputMode="numeric"
                  value={draft.quantity}
                  onChange={(e) => set({ quantity: e.target.value })}
                />
              )}
            </FormField>
            {needsPrice(type) && (
              <FormField label="Price (Rs)" required error={errors.price}>
                {(field) => (
                  <Input
                    {...field}
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(e) => set({ price: e.target.value })}
                  />
                )}
              </FormField>
            )}
            {needsTrigger(type) && (
              <FormField label="Trigger price (Rs)" required error={errors.trigger_price}>
                {(field) => (
                  <Input
                    {...field}
                    inputMode="decimal"
                    value={draft.trigger}
                    onChange={(e) => set({ trigger: e.target.value })}
                  />
                )}
              </FormField>
            )}
          </div>
          <Preview body={previewBody} />
          <DialogFooter>
            <Button
              type="submit"
              disabled={place.isPending}
              className={
                draft.side === 'SELL' ? 'bg-destructive hover:bg-destructive/90' : undefined
              }
            >
              {place.isPending && <Spinner />}
              {`Place ${draft.side === 'BUY' ? 'buy' : 'sell'} order`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
