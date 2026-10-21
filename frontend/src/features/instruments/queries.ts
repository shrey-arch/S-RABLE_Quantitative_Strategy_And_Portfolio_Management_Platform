import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import type { components } from '@/api/schema';

export type Instrument = components['schemas']['InstrumentResponse'];
export type CreateInstrumentBody = components['schemas']['CreateInstrumentRequest'];
export type UpdateInstrumentBody = components['schemas']['UpdateInstrumentRequest'];

/** Every instrument, active and inactive (GET /instruments). */
export function useInstruments() {
  return useQuery({
    queryKey: queryKeys.instruments.list(),
    queryFn: () => unwrap(api.GET('/instruments')),
  });
}

export function useInstrument(id: string) {
  return useQuery({
    queryKey: queryKeys.instruments.detail(id),
    queryFn: () =>
      unwrap(api.GET('/instruments/{instrument_id}', { params: { path: { instrument_id: id } } })),
  });
}

/** POST /instruments. A duplicate trading symbol is a 409. */
export function useCreateInstrument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInstrumentBody) => unwrap(api.POST('/instruments', { body })),
    onSuccess: (instrument) => {
      queryClient.setQueryData(queryKeys.instruments.detail(instrument.id), instrument);
      void queryClient.invalidateQueries({ queryKey: queryKeys.instruments.all });
      toast.success(`${instrument.symbol} was added.`);
    },
  });
}

/** PATCH /instruments/{id} with only the changed fields. */
export function useUpdateInstrument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateInstrumentBody }) =>
      unwrap(
        api.PATCH('/instruments/{instrument_id}', {
          params: { path: { instrument_id: vars.id } },
          body: vars.body,
        }),
      ),
    onSuccess: (instrument) => {
      queryClient.setQueryData(queryKeys.instruments.detail(instrument.id), instrument);
      void queryClient.invalidateQueries({ queryKey: queryKeys.instruments.all });
    },
  });
}

/** Activate / deactivate. The list is refreshed from the server afterwards. */
export function useSetInstrumentActive() {
  const update = useUpdateInstrument();
  return {
    ...update,
    setActive: (instrument: Instrument, isActive: boolean) =>
      update.mutate(
        { id: instrument.id, body: { is_active: isActive } },
        {
          onSuccess: (saved) =>
            toast.success(`${saved.symbol} is now ${saved.is_active ? 'active' : 'inactive'}.`),
          onError: (error) => toast.error(`Could not change the status: ${error.message}`),
        },
      ),
  };
}

/** DELETE /instruments/{id}. An instrument with stored data is a 409 (deactivate instead). */
export function useDeleteInstrument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instrument: Pick<Instrument, 'id' | 'symbol'>) =>
      unwrap(
        api.DELETE('/instruments/{instrument_id}', {
          params: { path: { instrument_id: instrument.id } },
        }),
      ).then(() => instrument),
    onSuccess: (instrument) => {
      queryClient.removeQueries({ queryKey: queryKeys.instruments.detail(instrument.id) });
      toast.success(`${instrument.symbol} was deleted.`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.instruments.all }),
  });
}
