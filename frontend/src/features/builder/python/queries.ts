import { useMutation, useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import type { TestRunBody } from './sandbox-model';

/** The context API, the rules and the limits, exactly as the backend enforces them. */
export function useSandboxReference() {
  return useQuery({
    queryKey: queryKeys.sandbox.reference(),
    queryFn: () => unwrap(api.GET('/sandbox/reference')),
    staleTime: Infinity,
  });
}

/** Run the saved code over recent bars. Nothing is stored. */
export function useTestRun(strategyId: string | undefined) {
  return useMutation({
    mutationFn: (body: TestRunBody) =>
      unwrap(
        api.POST('/strategies/{strategy_id}/test-run', {
          params: { path: { strategy_id: strategyId ?? '' } },
          body,
        }),
      ),
  });
}
