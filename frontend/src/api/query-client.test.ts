import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { createQueryClient } from './query-client';

type RetryFn = (failureCount: number, error: unknown) => boolean;
const retry = createQueryClient().getDefaultOptions().queries?.retry as RetryFn;

describe('query retry rules', () => {
  it('never retries 4xx errors', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(retry(0, new ApiError(status, 'x'))).toBe(false);
    }
  });

  it('retries network and server errors up to 2 times', () => {
    expect(retry(0, new ApiError(0, 'offline'))).toBe(true);
    expect(retry(1, new ApiError(500, 'server'))).toBe(true);
    expect(retry(2, new ApiError(500, 'server'))).toBe(false);
  });

  it('never retries mutations', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });
});
