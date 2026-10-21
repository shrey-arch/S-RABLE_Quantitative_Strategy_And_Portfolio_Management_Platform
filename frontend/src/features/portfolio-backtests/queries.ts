import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import { isTerminal, POLL_MS } from '@/features/backtests/backtest-model';
import type { PortfolioBacktestRequest } from './pb-model';

/** The user's portfolio backtests, newest first; asked for again while one is running. */
export function usePortfolioBacktests() {
  return useQuery({
    queryKey: queryKeys.portfolioBacktests.list(),
    queryFn: () => unwrap(api.GET('/portfolio-backtests')),
    refetchInterval: (q) => (q.state.data?.some((r) => !isTerminal(r.status)) ? POLL_MS : false),
  });
}

/**
 * One run and its settings (404 if it is not the user's). Asked for again every
 * POLL_MS while it is PENDING or RUNNING; polling stops at a terminal status.
 */
export function usePortfolioBacktest(id: string) {
  return useQuery({
    queryKey: queryKeys.portfolioBacktests.detail(id),
    queryFn: () =>
      unwrap(api.GET('/portfolio-backtests/{run_id}', { params: { path: { run_id: id } } })),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && !isTerminal(status) ? POLL_MS : false;
    },
  });
}

/** Everything the results page shows, stored when the run completed (409 before that). */
export function usePortfolioBacktestResults(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.portfolioBacktests.results(id),
    queryFn: () =>
      unwrap(
        api.GET('/portfolio-backtests/{run_id}/results', { params: { path: { run_id: id } } }),
      ),
    enabled: Boolean(id) && enabled,
    staleTime: Infinity,
  });
}

/** POST /portfolio-backtests. 409 = another run is in progress; 422 = the reason. */
export function useSubmitPortfolioBacktest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PortfolioBacktestRequest) =>
      unwrap(api.POST('/portfolio-backtests', { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.portfolioBacktests.all });
    },
  });
}
