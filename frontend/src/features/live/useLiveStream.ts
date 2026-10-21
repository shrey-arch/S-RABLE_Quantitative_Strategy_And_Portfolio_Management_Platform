import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { queryKeys } from '@/api/query-keys';
import { tokenStore } from '@/api/token';
import {
  barFromEvent,
  mergeBar,
  mergeEvents,
  parseSse,
  type FormingBar,
  type LiveBars,
  type LiveEvent,
  type LiveSession,
} from './live-model';

export type StreamState = 'idle' | 'connecting' | 'open' | 'retrying' | 'ended';

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const RETRY_MS = 3_000;

/**
 * GET /live/sessions/{id}/stream, read with fetch (EventSource cannot send the
 * login header). Each message goes into the query cache: the snapshot replaces
 * the session, log events are added once each, a BAR event adds its bar and a
 * FILL refreshes the fills and the paper account. The forming bar is kept here.
 * On a dropped connection it reconnects after 3 s from the last event it had.
 */
export function useLiveStream(id: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>('idle');
  const [forming, setForming] = useState<FormingBar | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState('idle');
      return;
    }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const handle = (event: string, data: unknown) => {
      if (event === 'snapshot') {
        queryClient.setQueryData(queryKeys.live.detail(id), data as LiveSession);
        return;
      }
      if (event === 'forming') {
        const f = data as Partial<FormingBar>;
        setForming(f && typeof f.time === 'string' ? (f as FormingBar) : null);
        return;
      }
      if (event === 'end') {
        stopped = true;
        setState('ended');
        setForming(null);
        void queryClient.invalidateQueries({ queryKey: queryKeys.live.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.paper.all });
        return;
      }
      const e = data as LiveEvent;
      if (typeof e?.id !== 'number') return;
      last.current = Math.max(last.current, e.id);
      queryClient.setQueryData<LiveEvent[]>(queryKeys.live.events(id), (old) =>
        mergeEvents(old ?? [], [e]),
      );
      const bar = barFromEvent(e);
      if (bar)
        queryClient.setQueryData<LiveBars>(queryKeys.live.bars(id), (old) =>
          old ? { ...old, bars: mergeBar(old.bars, bar) } : old,
        );
      if (e.kind === 'FILL') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.live.fills(id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.paper.all });
      }
      if (e.kind === 'STATUS')
        void queryClient.invalidateQueries({ queryKey: queryKeys.live.sessions() });
    };

    const connect = async () => {
      setState((s) => (s === 'retrying' ? s : 'connecting'));
      try {
        const token = tokenStore.get();
        const response = await fetch(
          `${baseUrl}/live/sessions/${id}/stream?after=${last.current}`,
          {
            headers: {
              Accept: 'text/event-stream',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: abort.signal,
          },
        );
        if (response.status === 401 || response.status === 404) {
          stopped = true;
          setState('idle');
          return;
        }
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
        setState('open');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSse(buffer);
          buffer = parsed.rest;
          for (const m of parsed.messages) handle(m.event, m.data);
          if (stopped) return;
        }
        const tail = parseSse(`${buffer}\n\n`);
        for (const m of tail.messages) handle(m.event, m.data);
      } catch {
        if (abort.signal.aborted) return;
      }
      if (stopped || abort.signal.aborted) return;
      setState('retrying');
      timer = setTimeout(() => void connect(), RETRY_MS);
    };

    void connect();
    return () => {
      stopped = true;
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id, enabled, queryClient]);

  return { state, forming };
}
