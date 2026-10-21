import { ApiError } from '@/api/errors';

/** Exact backend message for INACTIVE / SUSPENDED users (app/services/auth/auth_service.py). */
export const BACKEND_INACTIVE_MESSAGE = 'User account is not active.';

export const INACTIVE_ACCOUNT_MESSAGE =
  'Your account is not active (inactive or suspended). Contact the administrator to restore access.';

export const SESSION_EXPIRED_MESSAGE = 'Your session has ended. Please log in again.';

/**
 * Message for a failed login.
 * Wrong email and wrong password give the same generic text, so the form never
 * reveals which accounts exist.
 */
export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 && error.message === BACKEND_INACTIVE_MESSAGE) {
      return INACTIVE_ACCOUNT_MESSAGE;
    }
    if (error.status === 401 || error.status === 422) return 'Invalid email or password.';
    return error.message;
  }
  return 'Login failed. Please try again.';
}

/** Exact backend message when the email is already registered (409). */
export const BACKEND_EMAIL_TAKEN_MESSAGE = 'A user with this email already exists.';

export const EMAIL_TAKEN_MESSAGE = 'An account with this email already exists. Log in instead.';
