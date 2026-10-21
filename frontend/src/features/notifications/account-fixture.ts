import type { BrokerAccount } from '@/features/brokers/broker-model';
import type { Profile } from '@/features/profile/profile-model';
import type { Notification } from './notification-model';

/**
 * Phase 16 answers made by the backend's own code (only ids are fixed):
 * notifications the backend created when four runs finished (a completed
 * backtest, a failed validation, a cancelled backtest marked read, and a completed
 * run marked read whose run was then deleted), the unread count, broker accounts
 * (Zerodha connected, Upstox inactive), the 409 duplicate, connect / disconnect,
 * and the profile: GET, a 422 and a saved PATCH. Stored as compact JSON text.
 */
const NOTIFICATIONS_JSON = [
  '[{"id":"a0000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000016","execution_id":"e0000000-0000-4000-8000-000000001601","',
  'execution_type":"BACKTEST","execution_status":"COMPLETED","notification_type":"INFO","priority":"MEDIUM","title":"Backtest completed","message":"Backt',
  'est of \\"Momentum A\\" completed.","is_read":false,"read_at":null,"notification_data":{"event":"EXECUTION_FINISHED","status":"COMPLETED","strategy_name',
  '":"Momentum A","execution_type":"BACKTEST"},"created_at":"2026-10-17T18:00:12.368290+00:00","updated_at":"2026-10-17T18:00:12.368290+00:00"},{"id":"a0',
  '000000-0000-4000-8000-000000000002","user_id":"00000000-0000-4000-8000-000000000016","execution_id":"e0000000-0000-4000-8000-000000001602","execution_',
  'type":"VALIDATION","execution_status":"FAILED","notification_type":"ERROR","priority":"HIGH","title":"Validation failed","message":"Validation of \\"Mo',
  'mentum check\\" failed. No market data for RELIANCE in the chosen range.","is_read":false,"read_at":null,"notification_data":{"event":"EXECUTION_FINISH',
  'ED","status":"FAILED","strategy_name":"Momentum check","execution_type":"VALIDATION"},"created_at":"2026-10-17T18:00:12.343016+00:00","updated_at":"20',
  '26-10-17T18:00:12.343016+00:00"},{"id":"a0000000-0000-4000-8000-000000000003","user_id":"00000000-0000-4000-8000-000000000016","execution_id":"e000000',
  '0-0000-4000-8000-000000001603","execution_type":"BACKTEST","execution_status":"CANCELLED","notification_type":"WARNING","priority":"LOW","title":"Back',
  'test was cancelled","message":"Backtest of \\"Mean reversion test\\" was cancelled.","is_read":true,"read_at":"2026-10-17T18:00:12.930882+00:00","notifi',
  'cation_data":{"event":"EXECUTION_FINISHED","status":"CANCELLED","strategy_name":"Mean reversion test","execution_type":"BACKTEST"},"created_at":"2026-',
  '10-17T18:00:12.316071+00:00","updated_at":"2026-10-17T18:00:12.902751+00:00"},{"id":"a0000000-0000-4000-8000-000000000004","user_id":"00000000-0000-40',
  '00-8000-000000000016","execution_id":null,"execution_type":null,"execution_status":null,"notification_type":"INFO","priority":"MEDIUM","title":"Backte',
  'st completed","message":"Backtest of \\"Old breakout\\" completed.","is_read":true,"read_at":"2026-10-17T18:00:12.895114+00:00","notification_data":{"ev',
  'ent":"EXECUTION_FINISHED","status":"COMPLETED","strategy_name":"Old breakout","execution_type":"BACKTEST"},"created_at":"2026-10-17T18:00:12.285566+00',
  ':00","updated_at":"2026-10-17T18:00:12.864333+00:00"}]',
].join('');

const UNREAD_JSON = ['{"unread":2}'].join('');

const MARKED_READ_JSON = [
  '{"id":"a0000000-0000-4000-8000-000000000001","user_id":"00000000-0000-4000-8000-000000000016","execution_id":"e0000000-0000-4000-8000-000000001601","e',
  'xecution_type":"BACKTEST","execution_status":"COMPLETED","notification_type":"INFO","priority":"MEDIUM","title":"Backtest completed","message":"Backte',
  'st of \\"Momentum A\\" completed.","is_read":true,"read_at":"2026-10-17T18:00:13.022781+00:00","notification_data":{"event":"EXECUTION_FINISHED","status',
  '":"COMPLETED","strategy_name":"Momentum A","execution_type":"BACKTEST"},"created_at":"2026-10-17T18:00:12.368290+00:00","updated_at":"2026-10-17T18:00',
  ':12.993693+00:00"}',
].join('');

const BROKERS_JSON = [
  '[{"id":"b0000000-0000-4000-8000-000000000002","broker_name":"UPSTOX","broker_user_id":"7XK9Q2","account_alias":null,"connection_status":"DISCONNECTED"',
  ',"is_active":false,"last_synced_at":null,"created_at":"2026-10-17T18:00:13.096105+00:00"},{"id":"b0000000-0000-4000-8000-000000000001","broker_name":"',
  'ZERODHA","broker_user_id":"AB1234","account_alias":"Main","connection_status":"CONNECTED","is_active":true,"last_synced_at":null,"created_at":"2026-10',
  '-17T18:00:13.070859+00:00"}]',
].join('');

const BROKER_DUPLICATE_JSON = [
  '{"detail":"This broker account is already connected to your account."}',
].join('');

const BROKER_CONNECTED_JSON = [
  '{"id":"b0000000-0000-4000-8000-000000000002","broker_name":"UPSTOX","broker_user_id":"7XK9Q2","account_alias":null,"connection_status":"CONNECTED","is',
  '_active":false,"last_synced_at":null,"created_at":"2026-10-17T18:00:13.096105+00:00"}',
].join('');

const BROKER_DISCONNECTED_JSON = [
  '{"id":"b0000000-0000-4000-8000-000000000002","broker_name":"UPSTOX","broker_user_id":"7XK9Q2","account_alias":null,"connection_status":"DISCONNECTED",',
  '"is_active":false,"last_synced_at":null,"created_at":"2026-10-17T18:00:13.096105+00:00"}',
].join('');

const PROFILE_JSON = [
  '{"id":"00000000-0000-4000-8000-000000000016","full_name":"Asha Rao","email":"asha@example.com","account_status":"ACTIVE","email_verified":false,"phone',
  '_number":"+91 98765 43210","profile_image_url":null,"last_login_at":"2026-10-17T18:00:12.726999+00:00","created_at":"2026-10-17T18:00:12.234285+00:00"',
  '}',
].join('');

const PROFILE_INVALID_JSON = [
  '{"detail":[{"type":"value_error","loc":["body","profile_image_url"],"msg":"Value error, Profile image URL must start with http:// or https://.","input',
  '":"ftp://x","ctx":{"error":{}}}]}',
].join('');

const PROFILE_SAVED_JSON = [
  '{"id":"00000000-0000-4000-8000-000000000016","full_name":"Asha R. Rao","email":"asha@example.com","account_status":"ACTIVE","email_verified":false,"ph',
  'one_number":null,"profile_image_url":null,"last_login_at":"2026-10-17T18:00:12.726999+00:00","created_at":"2026-10-17T18:00:12.234285+00:00"}',
].join('');

export const FX_NOTIFICATIONS = JSON.parse(NOTIFICATIONS_JSON) as Notification[];
export const FX_UNREAD = JSON.parse(UNREAD_JSON) as { unread: number };
export const FX_MARKED_READ = JSON.parse(MARKED_READ_JSON) as Notification;
export const FX_BROKERS = JSON.parse(BROKERS_JSON) as BrokerAccount[];
export const FX_BROKER_DUPLICATE = JSON.parse(BROKER_DUPLICATE_JSON) as { detail: string };
export const FX_BROKER_CONNECTED = JSON.parse(BROKER_CONNECTED_JSON) as BrokerAccount;
export const FX_BROKER_DISCONNECTED = JSON.parse(BROKER_DISCONNECTED_JSON) as BrokerAccount;
export const FX_PROFILE = JSON.parse(PROFILE_JSON) as Profile;
export const FX_PROFILE_INVALID = JSON.parse(PROFILE_INVALID_JSON) as {
  detail: { loc: string[]; msg: string }[];
};
export const FX_PROFILE_SAVED = JSON.parse(PROFILE_SAVED_JSON) as Profile;
