import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';

/**
 * Results of a completed run (GET /executions/{id}/results), computed by the backend
 * from the stored result. A completed run never changes, so it is read once.
 * 409 = not completed (or no stored result); 404 = not the user's run.
 */
export function useExecutionResults(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.executions.results(id),
    queryFn: () =>
      unwrap(
        api.GET('/executions/{execution_id}/results', {
          params: { path: { execution_id: id } },
        }),
      ),
    enabled: enabled && Boolean(id),
    staleTime: Infinity,
  });
}
