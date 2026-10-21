import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import type { BrokerAccount, ConnectBrokerBody, CreateBrokerBody } from './broker-model';

/** The user's broker accounts (GET /brokers/accounts). Secrets are never returned. */
export function useBrokerAccounts() {
  return useQuery({
    queryKey: queryKeys.brokers.list(),
    queryFn: () => unwrap(api.GET('/brokers/accounts')),
  });
}

function useBrokerMutation<T>(run: (input: T) => Promise<BrokerAccount | void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.brokers.all }),
  });
}

const path = (id: string) => ({ params: { path: { broker_account_id: id } } });

export const useCreateBroker = () =>
  useBrokerMutation((body: CreateBrokerBody) => unwrap(api.POST('/brokers/accounts', { body })));

export const useUpdateBroker = () =>
  useBrokerMutation((input: { id: string; account_alias?: string; is_active?: boolean }) =>
    unwrap(
      api.PATCH('/brokers/accounts/{broker_account_id}', {
        ...path(input.id),
        body: { account_alias: input.account_alias, is_active: input.is_active },
      }),
    ),
  );

export const useConnectBroker = () =>
  useBrokerMutation((input: { id: string; body: ConnectBrokerBody }) =>
    unwrap(
      api.POST('/brokers/accounts/{broker_account_id}/connect', {
        ...path(input.id),
        body: input.body,
      }),
    ),
  );

export const useDisconnectBroker = () =>
  useBrokerMutation((id: string) =>
    unwrap(api.POST('/brokers/accounts/{broker_account_id}/disconnect', path(id))),
  );

export const useDeleteBroker = () =>
  useBrokerMutation(async (id: string) => {
    await unwrap(api.DELETE('/brokers/accounts/{broker_account_id}', path(id)));
  });
