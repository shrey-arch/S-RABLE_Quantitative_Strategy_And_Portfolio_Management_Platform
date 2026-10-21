import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import type { Weights } from './scoring-model';

/** Factors, directions, default weights and regime rules (GET /scoring/definitions). */
export function useScoringDefinitions() {
  return useQuery({
    queryKey: queryKeys.scoring.definitions(),
    queryFn: () => unwrap(api.GET('/scoring/definitions')),
    staleTime: Infinity,
  });
}

/**
 * The user's strategies scored and ranked (POST /scoring). Custom weights are sent
 * with the request and never saved; null uses the defaults. POST only because the
 * weights travel in the body: nothing is created.
 */
export function useScores(weights: Weights | null) {
  return useQuery({
    queryKey: queryKeys.scoring.scores(weights),
    queryFn: () => unwrap(api.POST('/scoring', { body: weights ? { weights } : {} })),
    // Keep the last ranking on screen while new weights are scored.
    placeholderData: (previous) => previous,
  });
}

/** Each core strategy's compatibility with the current regime (GET /scoring/regime-fit). */
export function useRegimeFit() {
  return useQuery({
    queryKey: queryKeys.scoring.regimeFit(),
    queryFn: () => unwrap(api.GET('/scoring/regime-fit')),
  });
}
