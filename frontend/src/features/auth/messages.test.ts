import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import { INACTIVE_ACCOUNT_MESSAGE, loginErrorMessage } from './messages';

describe('loginErrorMessage', () => {
  it('uses one generic message for wrong email or wrong password', () => {
    expect(loginErrorMessage(new ApiError(401, 'Invalid email or password.'))).toBe(
      'Invalid email or password.',
    );
  });

  it('explains inactive / suspended accounts (backend: "User account is not active.")', () => {
    expect(loginErrorMessage(new ApiError(401, 'User account is not active.'))).toBe(
      INACTIVE_ACCOUNT_MESSAGE,
    );
  });

  it('treats a 422 (e.g. password under 8 characters) as invalid credentials', () => {
    expect(loginErrorMessage(new ApiError(422, 'Some fields are invalid.'))).toBe(
      'Invalid email or password.',
    );
  });

  it('passes through connection problems', () => {
    expect(loginErrorMessage(new ApiError(0, 'Cannot reach the server.'))).toBe(
      'Cannot reach the server.',
    );
  });
});
