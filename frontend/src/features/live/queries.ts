import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import {
  isLiveNow,
  LIVE_POLL_MS,
  type CreateLiveSessionBody,
  type LiveEvent,
  type LiveSession,
} from './live-model';

const path = (id: string) => ({ params: { path: { session_id: id } } });

export function useLiveSessions() {
  return useQuery({
    queryKey: queryKeys.live.sessions(),
    queryFn: () => unwrap(api.GET('/live/sessions')),
    refetchInterval: (q) => (q.state.data?.some(isLiveNow) ? LIVE_POLL_MS : false),
  });
}

/**
 * One session. While the stream is connected it keeps this up to date (each
 * snapshot is written into the cache); otherwise it is polled while live.
 */
export function useLiveSession(id: string, streaming: () => boolean = () => false) {
  return useQuery({
    queryKey: queryKeys.live.detail(id),
    queryFn: () => unwrap(api.GET('/live/sessions/{session_id}', path(id))),
    refetchInterval: (q) =>
      !streaming() && q.state.data && isLiveNow(q.state.data) ? LIVE_POLL_MS : false,
  });
}

export function useLiveBars(id: string, poll: boolean) {
  return useQuery({
    queryKey: queryKeys.live.bars(id),
    queryFn: () => unwrap(api.GET('/live/sessions/{session_id}/bars', path(id))),
    refetchInterval: poll ? LIVE_POLL_MS : false,
  });
}

export function useLiveEvents(id: string, poll: boolean) {
  return useQuery({
    queryKey: queryKeys.live.events(id),
    queryFn: () =>
      unwrap(
        api.GET('/live/sessions/{session_id}/events', {
          params: { path: { session_id: id }, query: { limit: 2000 } },
        }),
      ),
    refetchInterval: poll ? LIVE_POLL_MS : false,
  });
}

export function useLiveFills(id: string, poll: boolean) {
  return useQuery({
    queryKey: queryKeys.live.fills(id),
    queryFn: () => unwrap(api.GET('/live/sessions/{session_id}/fills', path(id))),
    refetchInterval: poll ? LIVE_POLL_MS : false,
  });
}

export function useReplayDays(instrumentId: string) {
  return useQuery({
    queryKey: queryKeys.live.replayDays(instrumentId),
    queryFn: () =>
      unwrap(api.GET('/live/replay-days', { params: { query: { instrument_id: instrumentId } } })),
    enabled: instrumentId !== '',
  });
}

export function useLiveStatus() {
  return useQuery({
    queryKey: queryKeys.live.status(),
    queryFn: () => unwrap(api.GET('/live/status')),
    refetchInterval: 30_000,
  });
}

function useLiveMutation<T, R>(run: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (data) => {
      const s = data as unknown as LiveSession | undefined;
      if (s && typeof s === 'object' && 'id' in s && 'clock' in s)
        queryClient.setQueryData(queryKeys.live.detail(s.id), s);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.live.all });
      // Live fills move the paper account's cash.
      void queryClient.invalidateQueries({ queryKey: queryKeys.paper.all });
    },
  });
}

export function useCreateLiveSession() {
  return useLiveMutation((body: CreateLiveSessionBody) =>
    unwrap(api.POST('/live/sessions', { body })),
  );
}

export function useStopLiveSession() {
  return useLiveMutation((input: { id: string; squareOff: boolean }) =>
    unwrap(
      api.POST('/live/sessions/{session_id}/stop', {
        ...path(input.id),
        body: { square_off: input.squareOff },
      }),
    ),
  );
}

export function usePauseLiveSession() {
  return useLiveMutation((id: string) =>
    unwrap(api.POST('/live/sessions/{session_id}/pause', path(id))),
  );
}

export function useResumeLiveSession() {
  return useLiveMutation((id: string) =>
    unwrap(api.POST('/live/sessions/{session_id}/resume', path(id))),
  );
}

export function useStopAllLive() {
  return useLiveMutation((_: void) => unwrap(api.POST('/live/stop-all')));
}

export type { LiveEvent };
