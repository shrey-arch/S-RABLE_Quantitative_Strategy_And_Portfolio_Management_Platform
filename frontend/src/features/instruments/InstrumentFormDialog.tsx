import { AlertCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { EXCHANGES, INSTRUMENT_TYPES } from '@/lib/enums';
import {
  EMPTY_FORM,
  formFromInstrument,
  LIMITS,
  lotSizeRule,
  textRule,
  tickSizeRule,
  toCreateBody,
  toUpdateBody,
  type InstrumentFormValues,
} from './instrument-form';
import { exchangeLabel, instrumentTypeLabel } from './labels';
import { useCreateInstrument, useUpdateInstrument, type Instrument } from './queries';

type Target = { kind: 'new' } | { kind: 'edit'; instrument: Instrument };

const FIELDS = new Set<keyof InstrumentFormValues>([
  'symbol',
  'trading_symbol',
  'name',
  'exchange',
  'instrument_type',
  'isin',
  'lot_size',
  'tick_size',
]);

function InstrumentForm(props: { target: Target; onDone: (saved?: Instrument) => void }) {
  const { target } = props;
  const create = useCreateInstrument();
  const update = useUpdateInstrument();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InstrumentFormValues>({
    defaultValues: target.kind === 'edit' ? formFromInstrument(target.instrument) : EMPTY_FORM,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (target.kind === 'edit') {
        const body = toUpdateBody(target.instrument, values);
        if (Object.keys(body).length === 0) return props.onDone();
        const saved = await update.mutateAsync({ id: target.instrument.id, body });
        toast.success(`${saved.symbol} was saved.`);
        props.onDone(saved);
      } else {
        props.onDone(await create.mutateAsync(toCreateBody(values)));
      }
    } catch (error) {
      if (!(error instanceof ApiError)) return setFormError((error as Error).message);
      if (error.status === 409) {
        // The only uniqueness rule on instruments is the trading symbol.
        return setError('trading_symbol', { message: error.message });
      }
      const other: string[] = [];
      for (const [key, message] of Object.entries(error.fieldErrors)) {
        if (FIELDS.has(key as keyof InstrumentFormValues)) {
          setError(key as keyof InstrumentFormValues, { message });
        } else {
          other.push(message);
        }
      }
      if (other.length || Object.keys(error.fieldErrors).length === 0) {
        setFormError(other.join(' ') || error.message);
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{formError}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Symbol"
          required
          error={errors.symbol?.message}
          hint="As listed, e.g. RELIANCE. For an NSE index use NIFTY50 or INDIAVIX (or its Yahoo symbol, such as ^NSEI), so its data can be imported."
        >
          {(field) => (
            <Input
              {...field}
              autoComplete="off"
              maxLength={LIMITS.symbol}
              {...register('symbol', { validate: textRule('symbol', LIMITS.symbol) })}
            />
          )}
        </FormField>
        <FormField
          label="Trading symbol"
          required
          error={errors.trading_symbol?.message}
          hint="Must be unique, e.g. RELIANCE-EQ."
        >
          {(field) => (
            <Input
              {...field}
              autoComplete="off"
              maxLength={LIMITS.trading_symbol}
              {...register('trading_symbol', {
                validate: textRule('trading symbol', LIMITS.trading_symbol),
              })}
            />
          )}
        </FormField>
      </div>

      <FormField label="Name" required error={errors.name?.message}>
        {(field) => (
          <Input
            {...field}
            autoComplete="off"
            maxLength={LIMITS.name}
            {...register('name', { validate: textRule('name', LIMITS.name) })}
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Exchange" required error={errors.exchange?.message}>
          {(field) => (
            <NativeSelect {...field} className="w-full" {...register('exchange')}>
              {EXCHANGES.map((e) => (
                <option key={e} value={e}>
                  {exchangeLabel(e)}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label="Type" required error={errors.instrument_type?.message}>
          {(field) => (
            <NativeSelect {...field} className="w-full" {...register('instrument_type')}>
              {INSTRUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {instrumentTypeLabel(t)}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="ISIN" error={errors.isin?.message} hint="Optional.">
          {(field) => (
            <Input
              {...field}
              autoComplete="off"
              maxLength={LIMITS.isin}
              className="font-mono"
              {...register('isin', {
                validate: (v) =>
                  v.trim().length <= LIMITS.isin || `Use at most ${LIMITS.isin} characters.`,
              })}
            />
          )}
        </FormField>
        <FormField label="Lot size" required error={errors.lot_size?.message}>
          {(field) => (
            <Input
              {...field}
              inputMode="numeric"
              className="font-mono"
              {...register('lot_size', { validate: lotSizeRule })}
            />
          )}
        </FormField>
        <FormField label="Tick size" required error={errors.tick_size?.message}>
          {(field) => (
            <Input
              {...field}
              inputMode="decimal"
              className="font-mono"
              {...register('tick_size', { validate: tickSizeRule })}
            />
          )}
        </FormField>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" {...register('is_active')} />
        Active (can be picked for backtests)
      </label>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => props.onDone()}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          {target.kind === 'edit' ? 'Save changes' : 'Add instrument'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Add or edit an instrument in a dialog. `onSaved` runs after a successful save. */
export function InstrumentFormDialog(props: {
  target: Target;
  trigger: ReactNode;
  onSaved?: (instrument: Instrument) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {props.target.kind === 'edit'
              ? `Edit ${props.target.instrument.symbol}`
              : 'Add instrument'}
          </DialogTitle>
          <DialogDescription>
            Instruments are shared by everyone using this S-RABLE installation.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <InstrumentForm
            target={props.target}
            onDone={(saved) => {
              setOpen(false);
              if (saved) props.onSaved?.(saved);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
