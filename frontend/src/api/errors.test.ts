import { describe, expect, it } from 'vitest';
import { ApiError, networkError, toApiError } from './errors';

describe('toApiError', () => {
  it('reads FastAPI string detail (e.g. 401)', () => {
    const e = toApiError(401, { detail: 'Not authenticated' });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(401);
    expect(e.message).toBe('Not authenticated');
    expect(e.isUnauthorized).toBe(true);
  });

  it('turns a 422 list into field errors, dropping the "body" prefix', () => {
    // Shape recorded in Phase 0 runtime verification (POST /auth/register with empty body)
    const e = toApiError(422, {
      detail: [
        { type: 'missing', loc: ['body', 'full_name'], msg: 'Field required' },
        { type: 'missing', loc: ['body', 'email'], msg: 'Field required' },
        { type: 'missing', loc: ['body', 'password'], msg: 'Field required' },
      ],
    });
    expect(e.isValidation).toBe(true);
    expect(e.message).toBe('Some fields are invalid.');
    expect(e.fieldErrors).toEqual({
      full_name: 'Field required',
      email: 'Field required',
      password: 'Field required',
    });
  });

  it('keeps nested field paths and joins multiple messages for one field', () => {
    const e = toApiError(422, {
      detail: [
        { loc: ['body', 'strategy_config', 'indicators', 0, 'name'], msg: 'Field required' },
        { loc: ['body', 'password'], msg: 'Too short' },
        { loc: ['body', 'password'], msg: 'Needs a number' },
      ],
    });
    expect(e.fieldErrors['strategy_config.indicators.0.name']).toBe('Field required');
    expect(e.fieldErrors.password).toBe('Too short; Needs a number');
  });

  it('never reveals whether a 404 record exists or belongs to someone else', () => {
    const e = toApiError(404, { detail: 'Strategy 123 belongs to another user' });
    expect(e.message).toBe('Not found or not available to you.');
    expect(e.isNotFound).toBe(true);
  });

  it('never shows server internals for 5xx', () => {
    const e = toApiError(500, { detail: 'Traceback (most recent call last): psycopg2...' });
    expect(e.message).toBe('The server had a problem. Please try again.');
  });

  it('keeps the backend message for 409 conflicts', () => {
    const e = toApiError(409, {
      detail: 'This broker account is already connected to your account.',
    });
    expect(e.message).toMatch(/already connected/);
  });

  it('falls back to a default message when the body is empty', () => {
    expect(toApiError(401, undefined).message).toBe('Your session has ended. Please log in again.');
    expect(toApiError(418, null).message).toBe('Request failed (418).');
  });

  it('marks network failures with status 0', () => {
    const e = networkError();
    expect(e.status).toBe(0);
    expect(e.isNetworkError).toBe(true);
  });
});
