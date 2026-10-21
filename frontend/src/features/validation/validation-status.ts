import type { components } from '@/api/schema';
import type { Tone } from './validation-model';

/**
 * Feature 5: a strategy's validation status as the backend reports it
 * (app/services/validation/eligibility.py). Only VALIDATED and
 * VALIDATED_PAPER_PENDING strategies are eligible for capital; the reason is
 * always the backend's.
 */
export type ValidationStatus = components['schemas']['ValidationStatus'];
export type ValidationStatusValue = ValidationStatus['status'];

export const VALIDATION_STATUS_LABELS: Record<ValidationStatusValue, string> = {
  VALIDATED: 'Validated',
  VALIDATED_PAPER_PENDING: 'Validated (paper pending)',
  FAILED: 'Validation failed',
  OUTDATED: 'Validation outdated',
  NOT_VALIDATED: 'Not validated',
};

export const VALIDATION_STATUS_TONES: Record<ValidationStatusValue, Tone> = {
  VALIDATED: 'success',
  VALIDATED_PAPER_PENDING: 'info',
  FAILED: 'danger',
  OUTDATED: 'warning',
  NOT_VALIDATED: 'neutral',
};

/** Where to validate a strategy (the validation form, with it chosen). */
export const validateLink = (strategyId: string) =>
  `/app/validation/new?strategy=${encodeURIComponent(strategyId)}`;

/** The validation report a status comes from. */
export const reportLink = (validationId: string) => `/app/validation/${validationId}`;
