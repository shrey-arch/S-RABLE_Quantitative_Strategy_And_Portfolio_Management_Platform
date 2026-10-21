import type {
  ChargesTable,
  OrderPreview,
  PaperAccount,
  PaperFill,
  PaperHolding,
  PaperOrder,
  QuoteRow,
} from './paper-model';

/**
 * Paper trading answers made by the backend's own code (only ids are fixed), on a
 * fixed clock (Wed 14 Oct 2026, 10:30 IST) with stand-in quotes: RELIANCE bought at
 * market (20), an open NIFTYBEES limit buy, a RELIANCE stop-loss sell waiting for its
 * trigger and a cancelled limit buy. Stored as compact JSON text.
 */
const ACCOUNT_JSON = [
  '{"id":"a1000000-0000-4000-8000-000000000001","initial_cash":1000000.0,"cash":971705.47,"blocked_cash":27532.63,"available_cash":944172.84,"invested":2',
  '8261.0,"holdings_value":28410.0,"unrealised_pnl":149.0,"realised_pnl":0.0,"total_charges":33.53,"equity":1000115.47,"total_pnl":115.47,"holdings_count',
  '":1,"all_priced":true,"slippage_bps":5.0,"brokerage_per_order":0.0,"watchlist":["31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","b2c1f0aa-0000-4000-8000-000000',
  '000002"],"reset_count":0,"last_reset_at":null,"created_at":"2026-10-17T20:45:59.941941+00:00","market":{"is_open":true,"now":"2026-10-14T10:30:00+05:3',
  '0","session":"09:15-15:30 IST","closes_at":"2026-10-14T15:30:00+05:30","next_open":null},"price_source":{"name":"Yahoo Finance","delayed":true,"note":',
  '"Prices from Yahoo Finance may be delayed by up to about 15 minutes."},"simulation_only":true}',
].join('');

const ORDERS_JSON = [
  '[{"id":"0e000000-0000-4000-8000-000000000004","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","symbol":"RELIANCE","side":"BUY","order_type":"LI',
  'MIT","product":"CNC","quantity":5,"price":1300.0,"trigger_price":null,"status":"CANCELLED","status_message":"Cancelled by you.","session_date":"2026-1',
  '0-14","after_market":false,"placed_at":"2026-10-17T20:46:00.028350+00:00","triggered_at":null,"filled_at":null,"average_price":null,"reserved_amount":',
  '6507.72,"source":"MANUAL","deployment_id":null,"note":null,"tags":[]},{"id":"0e000000-0000-4000-8000-000000000003","instrument_id":"31d5a446-1ba0-4f4d',
  '-ad0e-d6dddce2b8f2","symbol":"RELIANCE","side":"SELL","order_type":"SL","product":"CNC","quantity":10,"price":1380.0,"trigger_price":1385.0,"status":"',
  'TRIGGER_PENDING","status_message":null,"session_date":"2026-10-14","after_market":false,"placed_at":"2026-10-17T20:46:00.017202+00:00","triggered_at":',
  'null,"filled_at":null,"average_price":null,"reserved_amount":null,"source":"MANUAL","deployment_id":null,"note":null,"tags":[]},{"id":"0e000000-0000-4',
  '000-8000-000000000002","instrument_id":"b2c1f0aa-0000-4000-8000-000000000002","symbol":"NIFTYBEES","side":"BUY","order_type":"LIMIT","product":"CNC","',
  'quantity":100,"price":275.0,"trigger_price":null,"status":"OPEN","status_message":null,"session_date":"2026-10-14","after_market":false,"placed_at":"2',
  '026-10-17T20:46:00.004780+00:00","triggered_at":null,"filled_at":null,"average_price":null,"reserved_amount":27532.63,"source":"MANUAL","deployment_id',
  '":null,"note":null,"tags":[]},{"id":"0e000000-0000-4000-8000-000000000001","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","symbol":"RELIANCE",',
  '"side":"BUY","order_type":"MARKET","product":"CNC","quantity":20,"price":null,"trigger_price":null,"status":"FILLED","status_message":null,"session_da',
  'te":"2026-10-14","after_market":false,"placed_at":"2026-10-17T20:45:59.979709+00:00","triggered_at":null,"filled_at":"2026-10-14T04:30:00+00:00","aver',
  'age_price":1413.05,"reserved_amount":null,"source":"MANUAL","deployment_id":null,"note":null,"tags":[]}]',
].join('');

const HOLDINGS_JSON = [
  '[{"instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","symbol":"RELIANCE","quantity":20,"average_price":1413.05,"invested":28261.0,"last_price":142',
  '0.5,"quote":{"price":1420.5,"time":"2026-10-14T04:42:00+00:00","previous_close":1398.6,"change":21.9,"change_percent":1.5659,"source":"Yahoo Finance",',
  '"delayed":true,"age_seconds":1080},"quote_problem":null,"market_value":28410.0,"unrealised_pnl":149.0}]',
].join('');

const FILLS_JSON = [
  '[{"id":"0f000000-0000-4000-8000-000000000001","order_id":"0e000000-0000-4000-8000-000000000001","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2"',
  ',"symbol":"RELIANCE","side":"BUY","quantity":20,"price":1413.05,"quote_price":1412.3,"quote_time":"2026-10-14T04:28:00+00:00","trade_value":28261.0,"c',
  'harges":{"gst":0.16,"stt":28.26,"sebi":0.03,"total":33.53,"exchange":0.84,"brokerage":0.0,"stamp_duty":4.24},"total_charges":33.53,"net_amount":-28294',
  '.53,"realised_pnl":null,"filled_at":"2026-10-14T04:30:00+00:00"}]',
].join('');

const QUOTES_JSON = [
  '[{"instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","symbol":"RELIANCE","name":"Reliance Industries","quote":{"price":1420.5,"time":"2026-10-14T0',
  '4:42:00+00:00","previous_close":1398.6,"change":21.9,"change_percent":1.5659,"source":"Yahoo Finance","delayed":true,"age_seconds":1080},"problem":nul',
  'l},{"instrument_id":"b2c1f0aa-0000-4000-8000-000000000002","symbol":"NIFTYBEES","name":"Nippon India ETF Nifty 50 BeES","quote":{"price":280.1,"time":',
  '"2026-10-14T04:42:00+00:00","previous_close":280.9,"change":-0.8,"change_percent":-0.2848,"source":"Yahoo Finance","delayed":true,"age_seconds":1080},',
  '"problem":null}]',
].join('');

const CHARGES_JSON = [
  '{"as_of":"2024-10-01","product":"CNC (equity delivery)","rates":[{"key":"stt","label":"STT (securities transaction tax)","rate":0.001,"applies_to":"BU',
  'Y and SELL","basis":"0.1% of the trade value"},{"key":"exchange","label":"Exchange transaction charge (NSE)","rate":2.97e-05,"applies_to":"BUY and SEL',
  'L","basis":"0.00297% of the trade value"},{"key":"sebi","label":"SEBI turnover fee","rate":1e-06,"applies_to":"BUY and SELL","basis":"Rs 10 per crore ',
  'of the trade value"},{"key":"stamp_duty","label":"Stamp duty","rate":0.00015,"applies_to":"BUY only","basis":"0.015% of the trade value"},{"key":"gst"',
  ',"label":"GST","rate":0.18,"applies_to":"BUY and SELL","basis":"18% of brokerage + exchange charge + SEBI fee"}],"brokerage":"Flat amount per executed',
  ' order, set on the paper account (default Rs 0).","not_included":"DP charges on sells (depository fee, broker-specific)."}',
].join('');

const PREVIEW_JSON = [
  '{"estimated_price":1421.25,"estimated_value":14212.5,"charges":{"brokerage":0.0,"stt":14.21,"exchange":0.42,"sebi":0.01,"stamp_duty":2.13,"gst":0.08,"',
  'total":16.85},"estimated_total":14229.35,"available_cash":944172.84,"quote":{"price":1420.5,"time":"2026-10-14T04:42:00+00:00","previous_close":1398.6',
  ',"change":21.9,"change_percent":1.5659,"source":"Yahoo Finance","delayed":true,"age_seconds":1080},"quote_problem":null,"session_date":"2026-10-14","a',
  'fter_market":false,"allowed":true,"problem":null}',
].join('');

const NO_FUNDS_JSON = [
  '{"detail":"Insufficient funds: this order needs Rs 14,01,660.72 and Rs 9,44,172.84 is available."}',
].join('');

const NO_SHORT_JSON = [
  '{"detail":"You can sell at most 0: you hold 0 and 0 are in open sell orders. Short selling is not allowed."}',
].join('');

export const PAPER_ACCOUNT = JSON.parse(ACCOUNT_JSON) as PaperAccount;
export const PAPER_ORDERS = JSON.parse(ORDERS_JSON) as PaperOrder[];
export const PAPER_HOLDINGS = JSON.parse(HOLDINGS_JSON) as PaperHolding[];
export const PAPER_FILLS = JSON.parse(FILLS_JSON) as PaperFill[];
export const PAPER_QUOTES = JSON.parse(QUOTES_JSON) as QuoteRow[];
export const PAPER_CHARGES = JSON.parse(CHARGES_JSON) as ChargesTable;
export const PAPER_PREVIEW = JSON.parse(PREVIEW_JSON) as OrderPreview;
export const PAPER_NO_FUNDS = JSON.parse(NO_FUNDS_JSON) as { detail: string };
export const PAPER_NO_SHORT = JSON.parse(NO_SHORT_JSON) as { detail: string };
