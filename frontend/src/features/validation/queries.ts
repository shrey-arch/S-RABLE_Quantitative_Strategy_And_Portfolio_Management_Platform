import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import { isTerminal, POLL_MS } from '@/features/backtests/backtest-model';
import type { ValidationRequest } from './validation-model';

/**
 * One validation run with its stages (GET /validations/{id}; 404 if it is not the
 * user's). Asked for again every POLL_MS while it is PENDING or RUNNING, so the
 * stages fill in as they finish; polling stops at a terminal status.
 */
export function useValidation(id: string) {
  return useQuery({
    queryKey: queryKeys.validations.detail(id),
    queryFn: () =>
      unwrap(api.GET('/validations/{execution_id}', { params: { path: { execution_id: id } } })),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && !isTerminal(status) ? POLL_MS : false;
    },
  });
}

/** The user's validation runs, newest first, with their verdicts (GET /validations). */
export function useValidations() {
  return useQuery({
    queryKey: queryKeys.validations.list(),
    queryFn: () => unwrap(api.GET('/validations', { params: { query: { limit: 500 } } })),
    refetchInterval: (q) => (q.state.data?.some((v) => !isTerminal(v.status)) ? POLL_MS : false),
  });
}

/** POST /validations. 409 = another backtest or validation is running; 422 = the reason. */
export function useSubmitValidation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ValidationRequest) => unwrap(api.POST('/validations', { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.validations.all });
    },
  });
}
