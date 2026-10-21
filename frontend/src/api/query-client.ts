import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors';

/**
 * One QueryClient for the whole app.
 *
 * Rules:
 * - Reads (queries) retry up to 2 times only for network/server errors.
 *   4xx errors (401, 404, 422…) are never retried — repeating won't fix them.
 * - Writes (mutations) are never retried automatically (avoid duplicate creates).
 * - Data is considered fresh for 30 s; no refetch just because the tab regains focus.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
