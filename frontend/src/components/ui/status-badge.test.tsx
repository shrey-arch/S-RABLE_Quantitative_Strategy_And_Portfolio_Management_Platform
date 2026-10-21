import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_STATUSES, CONNECTION_STATUSES, EXECUTION_STATUSES } from '@/lib/enums';
import { resolveStatus, StatusBadge } from './status-badge';

describe('resolveStatus', () => {
  it('gives every backend execution status a deliberate tone', () => {
    const tones = Object.fromEntries(
      EXECUTION_STATUSES.map((s) => [s, resolveStatus('execution', s).tone]),
    );
    expect(tones).toEqual({
      PENDING: 'neutral',
      RUNNING: 'info',
      COMPLETED: 'success',
      FAILED: 'danger',
      CANCELLED: 'warning',
    });
  });

  it('covers every connection and account status', () => {
    expect(CONNECTION_STATUSES.map((s) => resolveStatus('connection', s).tone)).toEqual([
      'success',
      'neutral',
      'warning',
    ]);
    expect(ACCOUNT_STATUSES.map((s) => resolveStatus('account', s).tone)).toEqual([
      'success',
      'neutral',
      'danger',
    ]);
  });

  it('labels booleans as Active / Inactive', () => {
    expect(resolveStatus('active', true).label).toBe('Active');
    expect(resolveStatus('active', false).label).toBe('Inactive');
  });

  it('shows unknown values neutrally instead of crashing', () => {
    expect(resolveStatus('execution', 'QUEUED')).toEqual({ tone: 'neutral', label: 'Queued' });
  });

  it('shows a dash for missing values', () => {
    expect(resolveStatus('execution', null).label).toBe('\u2014');
  });
});

describe('<StatusBadge>', () => {
  it('always renders a text label (colour is never the only signal)', () => {
    render(<StatusBadge kind="execution" value="FAILED" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
