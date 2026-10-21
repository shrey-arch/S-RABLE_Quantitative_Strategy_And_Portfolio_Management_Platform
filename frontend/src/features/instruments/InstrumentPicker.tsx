import { Link } from 'react-router';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/utils';
import { exchangeLabel } from './labels';
import { useInstruments, type Instrument } from './queries';

const optionLabel = (i: Instrument) => `${i.symbol} - ${i.name}${i.is_active ? '' : ' (inactive)'}`;

/**
 * Chooses one instrument from GET /instruments. The value is the instrument's id
 * (UUID), which is what backtest, validation and portfolio requests need.
 * Inactive instruments are left out unless they are the current value.
 */
export function InstrumentPicker(props: {
  value: string;
  onChange: (id: string, instrument: Instrument | undefined) => void;
  id?: string;
  className?: string;
  includeInactive?: boolean;
  /** Narrows the list, e.g. to NSE equities. */
  filter?: (instrument: Instrument) => boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const query = useInstruments();

  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const all = query.data ?? [];
  const shown = all
    .filter(
      (i) =>
        i.id === props.value ||
        ((props.includeInactive || i.is_active) && (!props.filter || props.filter(i))),
    )
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const byExchange = new Map<string, Instrument[]>();
  for (const i of shown) byExchange.set(i.exchange, [...(byExchange.get(i.exchange) ?? []), i]);

  if (query.isSuccess && shown.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No instruments to choose from.{' '}
        <Link to="/app/instruments" className="underline underline-offset-4">
          Add one on the Instruments page
        </Link>
        .
      </p>
    );
  }

  return (
    <NativeSelect
      id={props.id}
      className={cn('min-w-64', props.className)}
      value={props.value}
      disabled={query.isPending}
      aria-invalid={props['aria-invalid']}
      aria-describedby={props['aria-describedby']}
      onChange={(e) =>
        props.onChange(
          e.target.value,
          all.find((i) => i.id === e.target.value),
        )
      }
    >
      <NativeSelectOption value="">
        {query.isPending ? 'Loading instruments...' : 'Choose an instrument'}
      </NativeSelectOption>
      {[...byExchange].map(([exchange, items]) => (
        <NativeSelectOptGroup key={exchange} label={exchangeLabel(exchange)}>
          {items.map((i) => (
            <NativeSelectOption key={i.id} value={i.id}>
              {optionLabel(i)}
            </NativeSelectOption>
          ))}
        </NativeSelectOptGroup>
      ))}
    </NativeSelect>
  );
}
