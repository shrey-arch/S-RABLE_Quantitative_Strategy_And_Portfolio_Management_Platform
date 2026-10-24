import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DateRangeValue } from '@/components/ui/date-range-field';
import { Label } from '@/components/ui/label';
import type { DataRangeStatus } from '@/features/instruments/data-range';
import { DataRangeField } from '@/features/instruments/DataRangeField';
import { InstrumentPicker } from '@/features/instruments/InstrumentPicker';
import { setTheme, useTheme } from '@/lib/theme';

/**
 * Developer page (/dev/pickers): the instrument picker and the data-aware date range
 * that Backtest, Validation and Portfolio forms will use. Reads the real backend
 * (log in first in this tab).
 */
export default function PickersCheckPage() {
  const theme = useTheme();
  const [instrumentId, setInstrumentId] = useState('');
  const [range, setRange] = useState<DateRangeValue>({ start: '', end: '' });
  const [status, setStatus] = useState<DataRangeStatus>({ kind: 'no-instrument' });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="page-title text-3xl">Instrument and date pickers</h1>
          <p className="text-sm text-muted-foreground">Developer | real backend data</p>
        </div>
        <Button variant="outline" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Light' : 'Dark'} theme
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Choose data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="instrument">Instrument</Label>
            <InstrumentPicker
              id="instrument"
              value={instrumentId}
              onChange={(id) => {
                setInstrumentId(id);
                setRange({ start: '', end: '' });
              }}
            />
          </div>
          <DataRangeField
            instrumentId={instrumentId}
            value={range}
            onChange={setRange}
            onStatusChange={setStatus}
          />
          <dl className="grid gap-1 rounded-md bg-muted p-3 font-mono text-xs">
            <div>
              <dt className="inline text-muted-foreground">instrument_id: </dt>
              <dd className="inline break-all" data-testid="picked-id">
                {instrumentId || '(none)'}
              </dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">range: </dt>
              <dd className="inline">
                {range.start || '...'} to {range.end || '...'}
              </dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">status: </dt>
              <dd className="inline">{status.kind}</dd>
            </div>
          </dl>
          <Button disabled={status.kind !== 'ok'}>Use this data</Button>
        </CardContent>
      </Card>
    </main>
  );
}
