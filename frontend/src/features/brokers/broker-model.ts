import type { components } from '@/api/schema';
import { BROKER_NAMES } from '@/lib/enums';

type Schemas = components['schemas'];
export type BrokerAccount = Schemas['BrokerAccountResponse'];
export type BrokerName = Schemas['BrokerName'];
export type CreateBrokerBody = Schemas['CreateBrokerAccountRequest'];
export type ConnectBrokerBody = Schemas['ConnectBrokerAccountRequest'];

export { BROKER_NAMES };

export const BROKER_LABELS: Record<BrokerName, string> = {
  ZERODHA: 'Zerodha',
  UPSTOX: 'Upstox',
  ANGEL_ONE: 'Angel One',
  DHAN: 'Dhan',
};

export const brokerLabel = (name: string) => BROKER_LABELS[name as BrokerName] ?? name;

export const CONNECTION_NOTE =
  'Connection status is shown exactly as the backend stores it. CONNECTED only means an access token is saved: S-RABLE never places live orders or trades through a broker.';

export const SECRET_NOTE =
  'The API key, API secret and tokens are sent to the backend once and never shown again.';

/** "Zerodha - Main" or "Zerodha - AB1234" when there is no alias. */
export const accountName = (a: BrokerAccount) =>
  `${brokerLabel(a.broker_name)} \u00b7 ${a.account_alias || a.broker_user_id}`;

export interface AccountDraft {
  broker_name: BrokerName;
  broker_user_id: string;
  account_alias: string;
  api_key: string;
  api_secret: string;
}

export const EMPTY_DRAFT: AccountDraft = {
  broker_name: 'ZERODHA',
  broker_user_id: '',
  account_alias: '',
  api_key: '',
  api_secret: '',
};

type Built<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

/** Same limits as CreateBrokerAccountRequest; the backend checks again. */
export function buildCreateBody(d: AccountDraft): Built<CreateBrokerBody> {
  const errors: Record<string, string> = {};
  const userId = d.broker_user_id.trim();
  const alias = d.account_alias.trim();
  if (!userId) errors.broker_user_id = 'Enter the broker user ID.';
  else if (userId.length > 100) errors.broker_user_id = 'At most 100 characters.';
  if (alias.length > 100) errors.account_alias = 'At most 100 characters.';
  if (!d.api_key) errors.api_key = 'Enter the API key.';
  else if (d.api_key.length > 255) errors.api_key = 'At most 255 characters.';
  if (!d.api_secret) errors.api_secret = 'Enter the API secret.';
  else if (d.api_secret.length > 255) errors.api_secret = 'At most 255 characters.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      broker_name: d.broker_name,
      broker_user_id: userId,
      account_alias: alias || null,
      api_key: d.api_key,
      api_secret: d.api_secret,
    },
  };
}

export function buildConnectBody(d: {
  access_token: string;
  refresh_token: string;
}): Built<ConnectBrokerBody> {
  const errors: Record<string, string> = {};
  if (!d.access_token) errors.access_token = 'Enter the access token.';
  else if (d.access_token.length > 500) errors.access_token = 'At most 500 characters.';
  if (d.refresh_token.length > 500) errors.refresh_token = 'At most 500 characters.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { access_token: d.access_token, refresh_token: d.refresh_token || null },
  };
}
