import type { Execution, Order, Position, RecordCounts, Trade } from './records-model';

/**
 * Trading records answers made by the backend's own code: a seeded backtest
 * (execution ...15, strategy "Momentum flip") stored as records. RELIANCE: BUY 10 @ 100,
 * SELL 20 @ 90 (an open short 10 valued at 120); NIFTYBEES: BUY 5 @ 50, SELL 5 @ 55
 * (closed). Execution ...16 has no stored records. REFUSED is the 400 for opening a
 * completed order. Stored as compact JSON text.
 */
const ORDERS_JSON = [
  '[{"id":"0d000000-0000-4000-8000-000000000004","execution_id":"e0000000-0000-4000-8000-000000000015","instrument_id":"b2c1f0aa-0000-4000-8000-000000000',
  '002","broker_order_id":null,"order_type":"MARKET","order_side":"SELL","status":"COMPLETED","quantity":5,"filled_quantity":5,"price":55.0,"average_fill',
  '_price":55.0,"order_timestamp":"2025-01-09T09:15:00Z","created_at":"2026-10-17T16:24:14.378536Z","updated_at":"2026-10-17T16:24:14.378536Z"},{"id":"0d',
  '000000-0000-4000-8000-000000000003","execution_id":"e0000000-0000-4000-8000-000000000015","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","brok',
  'er_order_id":null,"order_type":"MARKET","order_side":"SELL","status":"COMPLETED","quantity":20,"filled_quantity":20,"price":90.0,"average_fill_price":',
  '90.0,"order_timestamp":"2025-01-08T09:15:00Z","created_at":"2026-10-17T16:24:14.378536Z","updated_at":"2026-10-17T16:24:14.378536Z"},{"id":"0d000000-0',
  '000-4000-8000-000000000002","execution_id":"e0000000-0000-4000-8000-000000000015","instrument_id":"b2c1f0aa-0000-4000-8000-000000000002","broker_order',
  '_id":null,"order_type":"MARKET","order_side":"BUY","status":"COMPLETED","quantity":5,"filled_quantity":5,"price":52.0,"average_fill_price":50.0,"order',
  '_timestamp":"2025-01-07T09:15:00Z","created_at":"2026-10-17T16:24:14.378536Z","updated_at":"2026-10-17T16:24:14.378536Z"},{"id":"0d000000-0000-4000-80',
  '00-000000000001","execution_id":"e0000000-0000-4000-8000-000000000015","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","broker_order_id":null,"',
  'order_type":"MARKET","order_side":"BUY","status":"COMPLETED","quantity":10,"filled_quantity":10,"price":100.0,"average_fill_price":100.0,"order_timest',
  'amp":"2025-01-06T09:15:00Z","created_at":"2026-10-17T16:24:14.378536Z","updated_at":"2026-10-17T16:24:14.378536Z"}]',
].join('');

const TRADES_JSON = [
  '[{"id":"7d000000-0000-4000-8000-000000000004","order_id":"0d000000-0000-4000-8000-000000000004","execution_id":"e0000000-0000-4000-8000-000000000015",',
  '"instrument_id":"b2c1f0aa-0000-4000-8000-000000000002","order_side":"SELL","broker_trade_id":null,"executed_quantity":5,"executed_price":55.0,"brokera',
  'ge":0.5,"total_charges":1.0,"trade_timestamp":"2025-01-09T09:15:00Z","created_at":"2026-10-17T16:24:14.378536Z","updated_at":"2026-10-17T16:24:14.3785',
  '36Z"},{"id":"7d000000-0000-4000-8000-000000000003","order_id":"0d000000-0000-4000-8000-000000000003","execution_id":"e0000000-0000-4000-8000-000000000',
  '015","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","order_side":"SELL","broker_trade_id":null,"executed_quantity":20,"executed_price":90.0,"b',
  'rokerage":1.5,"total_charges":3.0,"trade_timestamp":"2025-01-08T09:15:00Z","created_at":"2026-10-17T16:24:14.378536Z","updated_at":"2026-10-17T16:24:1',
  '4.378536Z"},{"id":"7d000000-0000-4000-8000-000000000002","order_id":"0d000000-0000-4000-8000-000000000002","execution_id":"e0000000-0000-4000-8000-000',
  '000000015","instrument_id":"b2c1f0aa-0000-4000-8000-000000000002","order_side":"BUY","broker_trade_id":null,"executed_quantity":5,"executed_price":50.',
  '0,"brokerage":0.5,"total_charges":1.0,"trade_timestamp":"2025-01-07T09:15:00Z","created_at":"2026-10-17T16:24:14.378536Z","updated_at":"2026-10-17T16:',
  '24:14.378536Z"},{"id":"7d000000-0000-4000-8000-000000000001","order_id":"0d000000-0000-4000-8000-000000000001","execution_id":"e0000000-0000-4000-8000',
  '-000000000015","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","order_side":"BUY","broker_trade_id":null,"executed_quantity":10,"executed_price',
  '":100.0,"brokerage":1.0,"total_charges":2.0,"trade_timestamp":"2025-01-06T09:15:00Z","created_at":"2026-10-17T16:24:14.378536Z","updated_at":"2026-10-',
  '17T16:24:14.378536Z"}]',
].join('');

const POSITIONS_JSON = [
  '[{"id":"9d000000-0000-4000-8000-000000000002","execution_id":"e0000000-0000-4000-8000-000000000015","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b',
  '8f2","broker_account_id":null,"direction":"SHORT","quantity":10,"average_price":90.0,"current_price":120.0,"market_value":1200.0,"realized_pnl":-100.0',
  ',"unrealized_pnl":-300.0,"position_status":"OPEN","last_updated_at":"2025-01-09T09:15:00Z","closed_at":null,"created_at":"2026-10-17T16:24:14.378536Z"',
  ',"updated_at":"2026-10-17T16:24:14.378536Z"},{"id":"9d000000-0000-4000-8000-000000000001","execution_id":"e0000000-0000-4000-8000-000000000015","instr',
  'ument_id":"b2c1f0aa-0000-4000-8000-000000000002","broker_account_id":null,"direction":"LONG","quantity":0,"average_price":50.0,"current_price":55.0,"m',
  'arket_value":0.0,"realized_pnl":25.0,"unrealized_pnl":0.0,"position_status":"CLOSED","last_updated_at":"2025-01-09T09:15:00Z","closed_at":"2025-01-09T',
  '09:15:00Z","created_at":"2026-10-17T16:24:14.378536Z","updated_at":"2026-10-17T16:24:14.378536Z"}]',
].join('');

const COUNTS_JSON = [
  '{"execution_id":"e0000000-0000-4000-8000-000000000015","stored":true,"orders":4,"trades":4,"positions":2}',
].join('');

const COUNTS_EMPTY_JSON = [
  '{"execution_id":"e0000000-0000-4000-8000-000000000016","stored":false,"orders":0,"trades":0,"positions":0}',
].join('');

const EXECUTIONS_JSON = [
  '[{"id":"e0000000-0000-4000-8000-000000000016","strategy_id":"5c000000-0000-4000-8000-000000000015","broker_account_id":null,"instrument_id":"31d5a446-',
  '1ba0-4f4d-ad0e-d6dddce2b8f2","execution_type":"BACKTEST","status":"COMPLETED","timeframe":"1D","initial_capital":10000.0,"execution_config":{},"execut',
  'ion_metrics":{"canonical_result":{"trades":[{"side":"BUY","price":100.0,"quantity":10.0,"brokerage":1.0,"timestamp":"2025-01-06T09:15:00+00:00","instr',
  'ument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","total_charges":2.0},{"side":"BUY","price":50.0,"quantity":5.0,"brokerage":0.5,"timestamp":"2025-01-0',
  '7T09:15:00+00:00","instrument_id":"b2c1f0aa-0000-4000-8000-000000000002","total_charges":1.0},{"side":"SELL","price":90.0,"quantity":20.0,"brokerage":',
  '1.5,"timestamp":"2025-01-08T09:15:00+00:00","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","total_charges":3.0},{"side":"SELL","price":55.0,"q',
  'uantity":5.0,"brokerage":0.5,"timestamp":"2025-01-09T09:15:00+00:00","instrument_id":"b2c1f0aa-0000-4000-8000-000000000002","total_charges":1.0}],"met',
  'adata":{"instrument_ids":["31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","b2c1f0aa-0000-4000-8000-000000000002"]},"provenance":{},"equity_curve":[{"timestamp"',
  ':"2025-01-06T09:15:00+00:00","portfolio_value":10000.0},{"timestamp":"2025-01-07T09:15:00+00:00","portfolio_value":10110.0},{"timestamp":"2025-01-08T0',
  '9:15:00+00:00","portfolio_value":9905.0},{"timestamp":"2025-01-09T09:15:00+00:00","portfolio_value":9625.0}]}},"run_settings":{"strategy_key":"momentu',
  'm"},"error_message":null,"error":null,"started_at":null,"completed_at":null,"created_at":"2026-10-01T10:01:00Z","updated_at":"2026-10-17T16:24:14.2618',
  '93Z"},{"id":"e0000000-0000-4000-8000-000000000015","strategy_id":"5c000000-0000-4000-8000-000000000015","broker_account_id":null,"instrument_id":"31d5',
  'a446-1ba0-4f4d-ad0e-d6dddce2b8f2","execution_type":"BACKTEST","status":"COMPLETED","timeframe":"1D","initial_capital":10000.0,"execution_config":{},"e',
  'xecution_metrics":{"canonical_result":{"trades":[{"side":"BUY","price":100.0,"quantity":10.0,"brokerage":1.0,"timestamp":"2025-01-06T09:15:00+00:00","',
  'instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","total_charges":2.0},{"side":"BUY","price":50.0,"quantity":5.0,"brokerage":0.5,"timestamp":"2025',
  '-01-07T09:15:00+00:00","instrument_id":"b2c1f0aa-0000-4000-8000-000000000002","total_charges":1.0},{"side":"SELL","price":90.0,"quantity":20.0,"broker',
  'age":1.5,"timestamp":"2025-01-08T09:15:00+00:00","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","total_charges":3.0},{"side":"SELL","price":55',
  '.0,"quantity":5.0,"brokerage":0.5,"timestamp":"2025-01-09T09:15:00+00:00","instrument_id":"b2c1f0aa-0000-4000-8000-000000000002","total_charges":1.0}]',
  ',"metadata":{"instrument_ids":["31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","b2c1f0aa-0000-4000-8000-000000000002"]},"provenance":{},"equity_curve":[{"times',
  'tamp":"2025-01-06T09:15:00+00:00","portfolio_value":10000.0},{"timestamp":"2025-01-07T09:15:00+00:00","portfolio_value":10110.0},{"timestamp":"2025-01',
  '-08T09:15:00+00:00","portfolio_value":9905.0},{"timestamp":"2025-01-09T09:15:00+00:00","portfolio_value":9625.0}]}},"run_settings":{"strategy_key":"mo',
  'mentum"},"error_message":null,"error":null,"started_at":null,"completed_at":null,"created_at":"2026-10-01T10:00:00Z","updated_at":"2026-10-17T16:24:14',
  '.261893Z"}]',
].join('');

const REFUSED_JSON = ['{"detail":"Invalid order transition: COMPLETED -> OPEN."}'].join('');

export const RECORDS_ORDERS = JSON.parse(ORDERS_JSON) as Order[];
export const RECORDS_TRADES = JSON.parse(TRADES_JSON) as Trade[];
export const RECORDS_POSITIONS = JSON.parse(POSITIONS_JSON) as Position[];
export const RECORDS_COUNTS = JSON.parse(COUNTS_JSON) as RecordCounts;
export const RECORDS_COUNTS_EMPTY = JSON.parse(COUNTS_EMPTY_JSON) as RecordCounts;
export const RECORDS_EXECUTIONS = JSON.parse(EXECUTIONS_JSON) as Execution[];
export const RECORDS_REFUSED = JSON.parse(REFUSED_JSON) as { detail: string };
export const RECORDS_EXECUTION_ID = 'e0000000-0000-4000-8000-000000000015';
export const RECORDS_OLD_EXECUTION_ID = 'e0000000-0000-4000-8000-000000000016';
export const RECORDS_STRATEGY = {
  id: '5c000000-0000-4000-8000-000000000015',
  name: 'Momentum flip',
};
