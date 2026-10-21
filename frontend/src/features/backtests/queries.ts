import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import type { operations } from '@/api/schema';
import { isTerminal, POLL_MS, type BacktestRequest, type Execution } from './backtest-model';

/**
 * One run (GET /executions/{id}; 404 if it is not the user's).
 * While it is PENDING or RUNNING it is asked for again every POLL_MS; polling
 * stops at a terminal status and when the page is left (the query unmounts).
 */
export function useExecution(id: string, options: { poll?: boolean } = {}) {
  const poll = options.poll ?? true;
  return useQuery({
    queryKey: queryKeys.executions.detail(id),
    queryFn: () =>
      unwrap(api.GET('/executions/{execution_id}', { params: { path: { execution_id: id } } })),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return poll && status !== undefined && !isTerminal(status) ? POLL_MS : false;
    },
  });
}

/** POST /backtests. 409 = another backtest is running; 422 = the backend's reason. */
export function useSubmitBacktest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BacktestRequest) => unwrap(api.POST('/backtests', { body })),
    onSuccess: (execution) => {
      queryClient.setQueryData(queryKeys.executions.detail(execution.id), execution);
      void queryClient.invalidateQueries({ queryKey: ['executions', 'list'] });
    },
  });
}

/**
 * POST /executions/{id}/cancel. 409 = it finished meanwhile; either way the run
 * is read again so the page shows what the backend has.
 */
export function useCancelExecution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST('/executions/{execution_id}/cancel', { params: { path: { execution_id: id } } }),
      ),
    onSuccess: (execution: Execution) => {
      queryClient.setQueryData(queryKeys.executions.detail(execution.id), execution);
    },
    onSettled: (_data, _error, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.executions.detail(id) });
      void queryClient.invalidateQueries({ queryKey: ['executions', 'list'] });
    },
  });
}

/** Filters of GET /executions, as the backend names them. Empty values are left out. */
export type ExecutionFilters = Omit<
  NonNullable<operations['list_executions_executions_get']['parameters']['query']>,
  'limit'
>;

/**
 * The user's runs, newest first (GET /executions). While any listed run is
 * PENDING or RUNNING the list is asked for again every POLL_MS.
 */
export function useExecutions(filters: ExecutionFilters) {
  const query = Object.fromEntries(
    Object.entries(filters).filter(([, v]) => Boolean(v)),
  ) as ExecutionFilters;
  return useQuery({
    queryKey: queryKeys.executions.list(query as Record<string, string>),
    queryFn: () => unwrap(api.GET('/executions', { params: { query: { ...query, limit: 500 } } })),
    refetchInterval: (q) => (q.state.data?.some((e) => !isTerminal(e.status)) ? POLL_MS : false),
  });
}
