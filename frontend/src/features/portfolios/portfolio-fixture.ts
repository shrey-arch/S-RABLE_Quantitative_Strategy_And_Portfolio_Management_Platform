import type { CurrentRegime } from '@/features/regime/regime-model';
import type { ScoringResult } from '@/features/scoring/scoring-model';
import type {
  AssetPrice,
  PortfolioAccount,
  PortfolioSummary,
  RebalancePlan,
  TargetPortfolio,
} from './portfolio-model';

/**
 * The portfolio API's answers made by the backend's own code, on the same eight
 * saved strategies as the scoring fixture (RELIANCE-EQ and NIFTYBEES-EQ are
 * synthetic daily closes). Core portfolio: 10,00,000 capital; TARGET with no
 * limits, TARGET_LIMITS with cash reserve 1,00,000 / max strategy 30% / max asset
 * 45%, TARGET_REGIME filtered by the current regime; REBALANCE from cash with
 * those limits, ACCOUNT_SAVED after applying it, REBALANCE_HELD from there with
 * max asset 35% (sells and buys). Stored as compact JSON text.
 */
const LIST_JSON = [
  '[{"id":"9f000000-0000-4000-8000-000000000002","name":"Empty idea","description":null,"initial_capital":"250000.00","cash":"250000.00","invested_value"',
  ':"0.00","total_equity":"250000.00","holdings_count":0,"simulation_only":true},{"id":"9f000000-0000-4000-8000-000000000001","name":"Core portfolio","de',
  'scription":"Template strategies, simulated","initial_capital":"1000000.00","cash":"104133.78","invested_value":"895866.22","total_equity":"1000000.00"',
  ',"holdings_count":2,"simulation_only":true}]',
].join('');

const ACCOUNT_EMPTY_JSON = [
  '{"id":"9f000000-0000-4000-8000-000000000001","name":"Core portfolio","description":"Template strategies, simulated","initial_capital":"1000000.00","ca',
  'sh":"1000000.00","invested_value":"0.00","total_equity":"1000000.00","allocation_weights":{},"cash_weight":"1","holdings":[],"simulation_only":true}',
].join('');

const ACCOUNT_SAVED_JSON = [
  '{"id":"9f000000-0000-4000-8000-000000000001","name":"Core portfolio","description":"Template strategies, simulated","initial_capital":"1000000.00","ca',
  'sh":"104133.78","invested_value":"895866.22","total_equity":"1000000.00","allocation_weights":{"RELIANCE-EQ":"0.445976","NIFTYBEES-EQ":"0.449891"},"ca',
  'sh_weight":"0.104133","holdings":[{"asset":"RELIANCE-EQ","quantity":3673,"price":"121.42","average_price":"121.42","market_value":"445975.66","weight"',
  ':"0.445976"},{"asset":"NIFTYBEES-EQ","quantity":1568,"price":"286.92","average_price":"286.92","market_value":"449890.56","weight":"0.449891"}],"simul',
  'ation_only":true}',
].join('');

const TARGET_JSON = [
  '{"capital":"1000000.00","regime":null,"regime_label":null,"invested_capital":"1000000.00","cash_reserve":"0.00","positions":[{"strategy":"5c000000-000',
  '0-4000-8000-000000000002","strategy_id":"5c000000-0000-4000-8000-000000000002","name":"Bank mean reversion","strategy_key":"mean_reversion","asset":"N',
  'IFTYBEES-EQ","score":0.8362417327962529,"amount":"302806.02","weight":"0.302806"},{"strategy":"5c000000-0000-4000-8000-000000000004","strategy_id":"5c',
  '000000-0000-4000-8000-000000000004","name":"Index rotation","strategy_key":"tactical_asset_allocation","asset":"RELIANCE-EQ","score":0.724089192593598',
  '7,"amount":"262195.21","weight":"0.262195"},{"strategy":"5c000000-0000-4000-8000-000000000001","strategy_id":"5c000000-0000-4000-8000-000000000001","n',
  'ame":"Nifty momentum","strategy_key":"momentum","asset":"RELIANCE-EQ","score":0.6408611834435716,"amount":"232058.05","weight":"0.232058"},{"strategy"',
  ':"5c000000-0000-4000-8000-000000000005","strategy_id":"5c000000-0000-4000-8000-000000000005","name":"Volatility edge","strategy_key":"volatility_arbit',
  'rage","asset":"NIFTYBEES-EQ","score":0.5604495507099088,"amount":"202940.72","weight":"0.202941"}],"excluded":[{"strategy_id":"5c000000-0000-4000-8000',
  '-000000000003","name":"Pairs RELIANCE/NIFTYBEES","strategy_key":"statistical_arbitrage","asset":null,"score":0.5194991469865784,"reason":"Pair strateg',
  'ies trade two instruments against each other, so there is no single asset to hold; they are not allocated."},{"strategy_id":"5c000000-0000-4000-8000-0',
  '00000000006","name":"My SMA rules","strategy_key":"no_code_rules","asset":null,"score":null,"reason":"Only strategies made from the five core template',
  's have a factor model; no-code rules and custom Python code are not scored."},{"strategy_id":"5c000000-0000-4000-8000-000000000007","name":"Fresh mome',
  'ntum idea","strategy_key":null,"asset":null,"score":null,"reason":"No completed backtest yet. Backtest it to score it."},{"strategy_id":"5c000000-0000',
  '-4000-8000-000000000008","name":"Short history","strategy_key":"momentum","asset":null,"score":null,"reason":"The factors could not be computed: Insuf',
  'ficient history: need at least 21 observations; received 15."}],"target_values":{"NIFTYBEES-EQ":"505746.74","RELIANCE-EQ":"494253.26"},"strategy_weigh',
  'ts":{"5c000000-0000-4000-8000-000000000002":"0.302806","5c000000-0000-4000-8000-000000000004":"0.262195","5c000000-0000-4000-8000-000000000001":"0.232',
  '058","5c000000-0000-4000-8000-000000000005":"0.202941"},"asset_weights":{"NIFTYBEES-EQ":"0.505747","RELIANCE-EQ":"0.494253"},"cash_weight":"0.000000",',
  '"binding_limits":[],"simulation_only":true}',
].join('');

const TARGET_LIMITS_JSON = [
  '{"capital":"1000000.00","regime":null,"regime_label":null,"invested_capital":"896079.64","cash_reserve":"103920.36","positions":[{"strategy":"5c000000',
  '-0000-4000-8000-000000000002","strategy_id":"5c000000-0000-4000-8000-000000000002","name":"Bank mean reversion","strategy_key":"mean_reversion","asset',
  '":"NIFTYBEES-EQ","score":0.8362417327962529,"amount":"268421.28","weight":"0.268421"},{"strategy":"5c000000-0000-4000-8000-000000000004","strategy_id"',
  ':"5c000000-0000-4000-8000-000000000004","name":"Index rotation","strategy_key":"tactical_asset_allocation","asset":"RELIANCE-EQ","score":0.72408919259',
  '35987,"amount":"236639.70","weight":"0.236640"},{"strategy":"5c000000-0000-4000-8000-000000000001","strategy_id":"5c000000-0000-4000-8000-000000000001',
  '","name":"Nifty momentum","strategy_key":"momentum","asset":"RELIANCE-EQ","score":0.6408611834435716,"amount":"209439.94","weight":"0.209440"},{"strat',
  'egy":"5c000000-0000-4000-8000-000000000005","strategy_id":"5c000000-0000-4000-8000-000000000005","name":"Volatility edge","strategy_key":"volatility_a',
  'rbitrage","asset":"NIFTYBEES-EQ","score":0.5604495507099088,"amount":"181578.72","weight":"0.181579"}],"excluded":[{"strategy_id":"5c000000-0000-4000-',
  '8000-000000000003","name":"Pairs RELIANCE/NIFTYBEES","strategy_key":"statistical_arbitrage","asset":null,"score":0.5194991469865784,"reason":"Pair str',
  'ategies trade two instruments against each other, so there is no single asset to hold; they are not allocated."},{"strategy_id":"5c000000-0000-4000-80',
  '00-000000000006","name":"My SMA rules","strategy_key":"no_code_rules","asset":null,"score":null,"reason":"Only strategies made from the five core temp',
  'lates have a factor model; no-code rules and custom Python code are not scored."},{"strategy_id":"5c000000-0000-4000-8000-000000000007","name":"Fresh ',
  'momentum idea","strategy_key":null,"asset":null,"score":null,"reason":"No completed backtest yet. Backtest it to score it."},{"strategy_id":"5c000000-',
  '0000-4000-8000-000000000008","name":"Short history","strategy_key":"momentum","asset":null,"score":null,"reason":"The factors could not be computed: I',
  'nsufficient history: need at least 21 observations; received 15."}],"target_values":{"NIFTYBEES-EQ":"450000.00","RELIANCE-EQ":"446079.64"},"strategy_w',
  'eights":{"5c000000-0000-4000-8000-000000000002":"0.268421","5c000000-0000-4000-8000-000000000004":"0.236640","5c000000-0000-4000-8000-000000000001":"0',
  '.209440","5c000000-0000-4000-8000-000000000005":"0.181579"},"asset_weights":{"NIFTYBEES-EQ":"0.450000","RELIANCE-EQ":"0.446080"},"cash_weight":"0.1039',
  '20","binding_limits":[{"limit":"cash_reserve","value":"100000","affected":[],"detail":"100000 of the 1000000.00 capital is kept as cash."},{"limit":"m',
  'ax_strategy_weight","value":"0.3","affected":["5c000000-0000-4000-8000-000000000002"],"detail":"Strategies above 30.00% of capital were cut to 300000.',
  '00; the rest stays as cash."},{"limit":"max_asset_weight","value":"0.45","affected":["NIFTYBEES-EQ"],"detail":"Assets above 45.00% of capital, countin',
  'g every strategy that holds them, were cut to 450000.00; the rest stays as cash."}],"simulation_only":true}',
].join('');

const TARGET_REGIME_JSON = [
  '{"capital":"1000000.00","regime":"R1","regime_label":{"code":"R1","name":"Low volatility, uptrend","volatility_state":"Low volatility","trend_state":"',
  'Uptrend","model_number":1},"invested_capital":"1000000.00","cash_reserve":"0.00","positions":[{"strategy":"5c000000-0000-4000-8000-000000000004","stra',
  'tegy_id":"5c000000-0000-4000-8000-000000000004","name":"Index rotation","strategy_key":"tactical_asset_allocation","asset":"RELIANCE-EQ","score":0.724',
  '0891925935987,"amount":"530487.56","weight":"0.530488"},{"strategy":"5c000000-0000-4000-8000-000000000001","strategy_id":"5c000000-0000-4000-8000-0000',
  '00000001","name":"Nifty momentum","strategy_key":"momentum","asset":"RELIANCE-EQ","score":0.6408611834435716,"amount":"469512.44","weight":"0.469512"}',
  '],"excluded":[{"strategy_id":"5c000000-0000-4000-8000-000000000002","name":"Bank mean reversion","strategy_key":"mean_reversion","asset":"NIFTYBEES-EQ',
  '","score":0.8362417327962529,"reason":"Suits a sideways market: it bets on prices returning to their average. Chosen regime: Low volatility, uptrend."',
  '},{"strategy_id":"5c000000-0000-4000-8000-000000000003","name":"Pairs RELIANCE/NIFTYBEES","strategy_key":"statistical_arbitrage","asset":null,"score":',
  '0.5194991469865784,"reason":"Pair strategies trade two instruments against each other, so there is no single asset to hold; they are not allocated."},',
  '{"strategy_id":"5c000000-0000-4000-8000-000000000005","name":"Volatility edge","strategy_key":"volatility_arbitrage","asset":"NIFTYBEES-EQ","score":0.',
  '5604495507099088,"reason":"Suits high volatility: it trades the gap between short- and long-term volatility. Chosen regime: Low volatility, uptrend."}',
  ',{"strategy_id":"5c000000-0000-4000-8000-000000000006","name":"My SMA rules","strategy_key":"no_code_rules","asset":null,"score":null,"reason":"Only s',
  'trategies made from the five core templates have a factor model; no-code rules and custom Python code are not scored."},{"strategy_id":"5c000000-0000-',
  '4000-8000-000000000007","name":"Fresh momentum idea","strategy_key":null,"asset":null,"score":null,"reason":"No completed backtest yet. Backtest it to',
  ' score it."},{"strategy_id":"5c000000-0000-4000-8000-000000000008","name":"Short history","strategy_key":"momentum","asset":null,"score":null,"reason"',
  ':"The factors could not be computed: Insufficient history: need at least 21 observations; received 15."}],"target_values":{"RELIANCE-EQ":"1000000.00"}',
  ',"strategy_weights":{"5c000000-0000-4000-8000-000000000004":"0.530488","5c000000-0000-4000-8000-000000000001":"0.469512"},"asset_weights":{"RELIANCE-E',
  'Q":"1.000000"},"cash_weight":"0.000000","binding_limits":[],"simulation_only":true}',
].join('');

const PRICES_JSON = [
  '[{"asset":"RELIANCE-EQ","instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","price":"121.42","as_of":"2023-02-24T00:00:00+00:00","reason":null},{"a',
  'sset":"NIFTYBEES-EQ","instrument_id":"b2c1f0aa-0000-4000-8000-000000000002","price":"286.92","as_of":"2023-02-24T00:00:00+00:00","reason":null}]',
].join('');

const REBALANCE_JSON = [
  '{"current_state":{"cash":"1000000.00","invested_value":"0.00","total_equity":"1000000.00","holdings":[]},"target":{"capital":"1000000.00","regime":nul',
  'l,"regime_label":null,"invested_capital":"896079.64","cash_reserve":"103920.36","positions":[{"strategy":"5c000000-0000-4000-8000-000000000002","strat',
  'egy_id":"5c000000-0000-4000-8000-000000000002","name":"Bank mean reversion","strategy_key":"mean_reversion","asset":"NIFTYBEES-EQ","score":0.836241732',
  '7962529,"amount":"268421.28","weight":"0.268421"},{"strategy":"5c000000-0000-4000-8000-000000000004","strategy_id":"5c000000-0000-4000-8000-0000000000',
  '04","name":"Index rotation","strategy_key":"tactical_asset_allocation","asset":"RELIANCE-EQ","score":0.7240891925935987,"amount":"236639.70","weight":',
  '"0.236640"},{"strategy":"5c000000-0000-4000-8000-000000000001","strategy_id":"5c000000-0000-4000-8000-000000000001","name":"Nifty momentum","strategy_',
  'key":"momentum","asset":"RELIANCE-EQ","score":0.6408611834435716,"amount":"209439.94","weight":"0.209440"},{"strategy":"5c000000-0000-4000-8000-000000',
  '000005","strategy_id":"5c000000-0000-4000-8000-000000000005","name":"Volatility edge","strategy_key":"volatility_arbitrage","asset":"NIFTYBEES-EQ","sc',
  'ore":0.5604495507099088,"amount":"181578.72","weight":"0.181579"}],"excluded":[{"strategy_id":"5c000000-0000-4000-8000-000000000003","name":"Pairs REL',
  'IANCE/NIFTYBEES","strategy_key":"statistical_arbitrage","asset":null,"score":0.5194991469865784,"reason":"Pair strategies trade two instruments agains',
  't each other, so there is no single asset to hold; they are not allocated."},{"strategy_id":"5c000000-0000-4000-8000-000000000006","name":"My SMA rule',
  's","strategy_key":"no_code_rules","asset":null,"score":null,"reason":"Only strategies made from the five core templates have a factor model; no-code r',
  'ules and custom Python code are not scored."},{"strategy_id":"5c000000-0000-4000-8000-000000000007","name":"Fresh momentum idea","strategy_key":null,"',
  'asset":null,"score":null,"reason":"No completed backtest yet. Backtest it to score it."},{"strategy_id":"5c000000-0000-4000-8000-000000000008","name":',
  '"Short history","strategy_key":"momentum","asset":null,"score":null,"reason":"The factors could not be computed: Insufficient history: need at least 2',
  '1 observations; received 15."}],"target_values":{"NIFTYBEES-EQ":"450000.00","RELIANCE-EQ":"446079.64"},"strategy_weights":{"5c000000-0000-4000-8000-00',
  '0000000002":"0.268421","5c000000-0000-4000-8000-000000000004":"0.236640","5c000000-0000-4000-8000-000000000001":"0.209440","5c000000-0000-4000-8000-00',
  '0000000005":"0.181579"},"asset_weights":{"NIFTYBEES-EQ":"0.450000","RELIANCE-EQ":"0.446080"},"cash_weight":"0.103920","binding_limits":[{"limit":"cash',
  '_reserve","value":"100000","affected":[],"detail":"100000 of the 1000000.00 capital is kept as cash."},{"limit":"max_strategy_weight","value":"0.3","a',
  'ffected":["5c000000-0000-4000-8000-000000000002"],"detail":"Strategies above 30.00% of capital were cut to 300000.00; the rest stays as cash."},{"limi',
  't":"max_asset_weight","value":"0.45","affected":["NIFTYBEES-EQ"],"detail":"Assets above 45.00% of capital, counting every strategy that holds them, we',
  're cut to 450000.00; the rest stays as cash."}],"simulation_only":true},"rebalancing":{"starting_cash":"1000000.00","ending_cash":"104133.78","target_',
  'values":{"NIFTYBEES-EQ":"450000.00","RELIANCE-EQ":"446079.64"},"trades":[{"asset":"RELIANCE-EQ","side":"BUY","quantity":3673,"price":"121.42","value":',
  '"445975.66"},{"asset":"NIFTYBEES-EQ","side":"BUY","quantity":1568,"price":"286.92","value":"449890.56"}]},"assets":[{"asset":"RELIANCE-EQ","price":"12',
  '1.42","current_quantity":0,"current_value":"0.00","current_weight":"0.000000","target_value":"446079.64","target_weight":"0.446080","action":"BUY","tr',
  'ade_quantity":3673,"trade_value":"445975.66","ending_quantity":3673,"ending_value":"445975.66"},{"asset":"NIFTYBEES-EQ","price":"286.92","current_quan',
  'tity":0,"current_value":"0.00","current_weight":"0.000000","target_value":"450000.00","target_weight":"0.450000","action":"BUY","trade_quantity":1568,',
  '"trade_value":"449890.56","ending_quantity":1568,"ending_value":"449890.56"}],"ending_state":{"cash":"104133.78","invested_value":"895866.22","total_e',
  'quity":"1000000.00","holdings":[{"asset":"RELIANCE-EQ","quantity":3673,"price":"121.42"},{"asset":"NIFTYBEES-EQ","quantity":1568,"price":"286.92"}]},"',
  'prices":[{"asset":"RELIANCE-EQ","price":"121.42","source":"given","as_of":null},{"asset":"NIFTYBEES-EQ","price":"286.92","source":"given","as_of":null',
  '}],"simulation_only":true}',
].join('');

const REBALANCE_HELD_JSON = [
  '{"current_state":{"cash":"104133.78","invested_value":"895866.22","total_equity":"1000000.00","holdings":[{"asset":"RELIANCE-EQ","quantity":3673,"pric',
  'e":"121.42","market_value":"445975.66"},{"asset":"NIFTYBEES-EQ","quantity":1568,"price":"286.92","market_value":"449890.56"}]},"target":{"capital":"10',
  '00000.00","regime":null,"regime_label":null,"invested_capital":"700000.00","cash_reserve":"300000.00","positions":[{"strategy":"5c000000-0000-4000-800',
  '0-000000000002","strategy_id":"5c000000-0000-4000-8000-000000000002","name":"Bank mean reversion","strategy_key":"mean_reversion","asset":"NIFTYBEES-E',
  'Q","score":0.8362417327962529,"amount":"209555.68","weight":"0.209556"},{"strategy":"5c000000-0000-4000-8000-000000000004","strategy_id":"5c000000-000',
  '0-4000-8000-000000000004","name":"Index rotation","strategy_key":"tactical_asset_allocation","asset":"RELIANCE-EQ","score":0.7240891925935987,"amount"',
  ':"185670.64","weight":"0.185671"},{"strategy":"5c000000-0000-4000-8000-000000000001","strategy_id":"5c000000-0000-4000-8000-000000000001","name":"Nift',
  'y momentum","strategy_key":"momentum","asset":"RELIANCE-EQ","score":0.6408611834435716,"amount":"164329.36","weight":"0.164329"},{"strategy":"5c000000',
  '-0000-4000-8000-000000000005","strategy_id":"5c000000-0000-4000-8000-000000000005","name":"Volatility edge","strategy_key":"volatility_arbitrage","ass',
  'et":"NIFTYBEES-EQ","score":0.5604495507099088,"amount":"140444.32","weight":"0.140444"}],"excluded":[{"strategy_id":"5c000000-0000-4000-8000-000000000',
  '003","name":"Pairs RELIANCE/NIFTYBEES","strategy_key":"statistical_arbitrage","asset":null,"score":0.5194991469865784,"reason":"Pair strategies trade ',
  'two instruments against each other, so there is no single asset to hold; they are not allocated."},{"strategy_id":"5c000000-0000-4000-8000-00000000000',
  '6","name":"My SMA rules","strategy_key":"no_code_rules","asset":null,"score":null,"reason":"Only strategies made from the five core templates have a f',
  'actor model; no-code rules and custom Python code are not scored."},{"strategy_id":"5c000000-0000-4000-8000-000000000007","name":"Fresh momentum idea"',
  ',"strategy_key":null,"asset":null,"score":null,"reason":"No completed backtest yet. Backtest it to score it."},{"strategy_id":"5c000000-0000-4000-8000',
  '-000000000008","name":"Short history","strategy_key":"momentum","asset":null,"score":null,"reason":"The factors could not be computed: Insufficient hi',
  'story: need at least 21 observations; received 15."}],"target_values":{"NIFTYBEES-EQ":"350000.00","RELIANCE-EQ":"350000.00"},"strategy_weights":{"5c00',
  '0000-0000-4000-8000-000000000002":"0.209556","5c000000-0000-4000-8000-000000000004":"0.185671","5c000000-0000-4000-8000-000000000001":"0.164329","5c00',
  '0000-0000-4000-8000-000000000005":"0.140444"},"asset_weights":{"NIFTYBEES-EQ":"0.350000","RELIANCE-EQ":"0.350000"},"cash_weight":"0.300000","binding_l',
  'imits":[{"limit":"max_asset_weight","value":"0.35","affected":["RELIANCE-EQ","NIFTYBEES-EQ"],"detail":"Assets above 35.00% of capital, counting every ',
  'strategy that holds them, were cut to 350000.00; the rest stays as cash."}],"simulation_only":true},"rebalancing":{"starting_cash":"104133.78","ending',
  '_cash":"299903.74","target_values":{"NIFTYBEES-EQ":"350000.00","RELIANCE-EQ":"350000.00"},"trades":[{"asset":"RELIANCE-EQ","side":"SELL","quantity":79',
  '0,"price":"121.42","value":"95921.80"},{"asset":"NIFTYBEES-EQ","side":"SELL","quantity":348,"price":"286.92","value":"99848.16"}]},"assets":[{"asset":',
  '"RELIANCE-EQ","price":"121.42","current_quantity":3673,"current_value":"445975.66","current_weight":"0.445976","target_value":"350000.00","target_weig',
  'ht":"0.350000","action":"SELL","trade_quantity":790,"trade_value":"95921.80","ending_quantity":2883,"ending_value":"350053.86"},{"asset":"NIFTYBEES-EQ',
  '","price":"286.92","current_quantity":1568,"current_value":"449890.56","current_weight":"0.449891","target_value":"350000.00","target_weight":"0.35000',
  '0","action":"SELL","trade_quantity":348,"trade_value":"99848.16","ending_quantity":1220,"ending_value":"350042.40"}],"ending_state":{"cash":"299903.74',
  '","invested_value":"700096.26","total_equity":"1000000.00","holdings":[{"asset":"RELIANCE-EQ","quantity":2883,"price":"121.42"},{"asset":"NIFTYBEES-EQ',
  '","quantity":1220,"price":"286.92"}]},"prices":[{"asset":"RELIANCE-EQ","price":"121.42","source":"given","as_of":null},{"asset":"NIFTYBEES-EQ","price"',
  ':"286.92","source":"given","as_of":null}],"simulation_only":true}',
].join('');

const SCORES_JSON = [
  '{"regime":{"model_number":1,"model_version":"gmm-regime-v1","instrument_symbol":"RELIANCE","as_of":"2023-02-24T00:00:00+00:00","code":"R1","name":"Low',
  ' volatility, uptrend","volatility_state":"Low volatility","trend_state":"Uptrend","confidence":0.9857637137654727},"weights":{"momentum":{"trend_stren',
  'gth":1.0,"relative_momentum":1.0,"volatility_suitability":1.0},"mean_reversion":{"price_deviation":1.0,"trend_suitability":1.0,"volatility_suitability',
  '":1.0},"statistical_arbitrage":{"spread_deviation":1.0,"spread_stability":1.0,"volatility_suitability":1.0},"tactical_asset_allocation":{"relative_mom',
  'entum":1.0,"volatility_suitability":1.0},"volatility_arbitrage":{"volatility_relationship":1.0,"volatility_stability":1.0}},"custom_weights":false,"ro',
  'ws":[{"strategy_id":"5c000000-0000-4000-8000-000000000002","name":"Bank mean reversion","strategy_type":"PYTHON","version":1,"is_active":true,"status"',
  ':"SCORED","reason":null,"strategy_key":"mean_reversion","rank":1,"composite_score":0.8362417327962529,"factors":[{"factor":"price_deviation","label":"',
  'Price deviation","direction":"magnitude","raw":-2.190717995480093,"normalized":-0.7302393318266975,"suitability":0.7302393318266975,"weight":1.0,"weig',
  'ht_share":0.3333333333333333,"contribution":0.24341311060889917},{"factor":"trend_suitability","label":"Trend suitability","direction":"suitability","',
  'raw":-0.04625431555384954,"normalized":0.9845818948153835,"suitability":0.9845818948153835,"weight":1.0,"weight_share":0.3333333333333333,"contributio',
  'n":0.32819396493846115},{"factor":"volatility_suitability","label":"Volatility suitability","direction":"suitability","raw":0.010304801412666117,"norm',
  'alized":0.7939039717466777,"suitability":0.7939039717466777,"weight":1.0,"weight_share":0.3333333333333333,"contribution":0.26463465724889257}],"as_of',
  '":"2023-02-24T00:00:00+00:00","instruments":[{"id":"b2c1f0aa-0000-4000-8000-000000000002","symbol":"NIFTYBEES"}],"source_execution_id":"e0000000-0000-',
  '4000-8000-000000000002","source_completed_at":"2026-10-01T00:02:00Z","regime_compatibility":{"status":"NOT_COMPATIBLE","reason":"Suits a sideways mark',
  'et: it bets on prices returning to their average. Current regime: Low volatility, uptrend."}},{"strategy_id":"5c000000-0000-4000-8000-000000000004","n',
  'ame":"Index rotation","strategy_type":"PYTHON","version":1,"is_active":true,"status":"SCORED","reason":null,"strategy_key":"tactical_asset_allocation"',
  ',"rank":2,"composite_score":0.7240891925935987,"factors":[{"factor":"relative_momentum","label":"Relative momentum","direction":"higher_is_better","ra',
  'w":0.024987438077939572,"normalized":0.12493719038969786,"suitability":0.5624685951948489,"weight":1.0,"weight_share":0.5,"contribution":0.28123429759',
  '742447},{"factor":"volatility_suitability","label":"Volatility suitability","direction":"suitability","raw":0.0057145105003825756,"normalized":0.88570',
  '97899923485,"suitability":0.8857097899923485,"weight":1.0,"weight_share":0.5,"contribution":0.44285489499617425}],"as_of":"2023-02-24T00:00:00+00:00",',
  '"instruments":[{"id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","symbol":"RELIANCE"},{"id":"b2c1f0aa-0000-4000-8000-000000000002","symbol":"NIFTYBEES"}],"',
  'source_execution_id":"e0000000-0000-4000-8000-000000000004","source_completed_at":"2026-10-01T00:04:00Z","regime_compatibility":{"status":"COMPATIBLE"',
  ',"reason":"Suits an uptrend: it only buys the strongest assets. Current regime: Low volatility, uptrend."}},{"strategy_id":"5c000000-0000-4000-8000-00',
  '0000000001","name":"Nifty momentum","strategy_type":"PYTHON","version":1,"is_active":true,"status":"SCORED","reason":null,"strategy_key":"momentum","r',
  'ank":3,"composite_score":0.6408611834435716,"factors":[{"factor":"trend_strength","label":"Trend strength","direction":"higher_is_better","raw":0.2187',
  '8820616221595,"normalized":0.07292940205407206,"suitability":0.536464701027036,"weight":1.0,"weight_share":0.3333333333333333,"contribution":0.1788215',
  '67009012},{"factor":"relative_momentum","label":"Relative momentum","direction":"higher_is_better","raw":0.00016362372453215812,"normalized":0.0008181',
  '186226607906,"suitability":0.5004090593113304,"weight":1.0,"weight_share":0.3333333333333333,"contribution":0.16680301977044346},{"factor":"volatility',
  '_suitability","label":"Volatility suitability","direction":"suitability","raw":0.0057145105003825756,"normalized":0.8857097899923485,"suitability":0.8',
  '857097899923485,"weight":1.0,"weight_share":0.3333333333333333,"contribution":0.29523659666411617}],"as_of":"2023-02-24T00:00:00+00:00","instruments":',
  '[{"id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","symbol":"RELIANCE"}],"source_execution_id":"e0000000-0000-4000-8000-000000000001","source_completed_at"',
  ':"2026-10-01T00:01:00Z","regime_compatibility":{"status":"COMPATIBLE","reason":"Suits a trend in either direction: it goes long or short with the tren',
  'd. Current regime: Low volatility, uptrend."}},{"strategy_id":"5c000000-0000-4000-8000-000000000005","name":"Volatility edge","strategy_type":"PYTHON"',
  ',"version":1,"is_active":true,"status":"SCORED","reason":null,"strategy_key":"volatility_arbitrage","rank":4,"composite_score":0.5604495507099088,"fac',
  'tors":[{"factor":"volatility_relationship","label":"Volatility relationship","direction":"magnitude","raw":0.21436605019663557,"normalized":0.21436605',
  '019663557,"suitability":0.21436605019663557,"weight":1.0,"weight_share":0.5,"contribution":0.10718302509831779},{"factor":"volatility_stability","labe',
  'l":"Volatility stability","direction":"suitability","raw":0.09346694877681795,"normalized":0.9065330512231821,"suitability":0.9065330512231821,"weight',
  '":1.0,"weight_share":0.5,"contribution":0.45326652561159103}],"as_of":"2023-02-24T00:00:00+00:00","instruments":[{"id":"b2c1f0aa-0000-4000-8000-000000',
  '000002","symbol":"NIFTYBEES"}],"source_execution_id":"e0000000-0000-4000-8000-000000000005","source_completed_at":"2026-10-01T00:05:00Z","regime_compa',
  'tibility":{"status":"NOT_COMPATIBLE","reason":"Suits high volatility: it trades the gap between short- and long-term volatility. Current regime: Low v',
  'olatility, uptrend."}},{"strategy_id":"5c000000-0000-4000-8000-000000000003","name":"Pairs RELIANCE/NIFTYBEES","strategy_type":"PYTHON","version":1,"i',
  's_active":true,"status":"SCORED","reason":null,"strategy_key":"statistical_arbitrage","rank":5,"composite_score":0.5194991469865784,"factors":[{"facto',
  'r":"spread_deviation","label":"Spread deviation","direction":"magnitude","raw":1.9417722606986687,"normalized":0.6472574202328893,"suitability":0.6472',
  '574202328893,"weight":1.0,"weight_share":0.3333333333333333,"contribution":0.21575247341096312},{"factor":"spread_stability","label":"Spread stability',
  '","direction":"suitability","raw":0.9285668601426672,"normalized":0.0714331398573328,"suitability":0.0714331398573328,"weight":1.0,"weight_share":0.33',
  '33333333333333,"contribution":0.02381104661911093},{"factor":"volatility_suitability","label":"Volatility suitability","direction":"suitability","raw"',
  ':0.008009655956524347,"normalized":0.839806880869513,"suitability":0.839806880869513,"weight":1.0,"weight_share":0.3333333333333333,"contribution":0.2',
  '7993562695650437}],"as_of":"2023-02-24T00:00:00+00:00","instruments":[{"id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","symbol":"RELIANCE"},{"id":"b2c1f0a',
  'a-0000-4000-8000-000000000002","symbol":"NIFTYBEES"}],"source_execution_id":"e0000000-0000-4000-8000-000000000003","source_completed_at":"2026-10-01T0',
  '0:03:00Z","regime_compatibility":{"status":"COMPATIBLE","reason":"Suits any regime: it trades the spread between two instruments, not the market\'s dir',
  'ection. Current regime: Low volatility, uptrend."}},{"strategy_id":"5c000000-0000-4000-8000-000000000007","name":"Fresh momentum idea","strategy_type"',
  ':"PYTHON","version":1,"is_active":true,"status":"UNSCORED","reason":"No completed backtest yet. Backtest it to score it.","strategy_key":null,"rank":n',
  'ull,"composite_score":null,"factors":[],"as_of":null,"instruments":[],"source_execution_id":null,"source_completed_at":null,"regime_compatibility":nul',
  'l},{"strategy_id":"5c000000-0000-4000-8000-000000000006","name":"My SMA rules","strategy_type":"NO_CODE","version":1,"is_active":true,"status":"UNSCOR',
  'ED","reason":"Only strategies made from the five core templates have a factor model; no-code rules and custom Python code are not scored.","strategy_k',
  'ey":"no_code_rules","rank":null,"composite_score":null,"factors":[],"as_of":null,"instruments":[{"id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","symbol":',
  '"RELIANCE"}],"source_execution_id":"e0000000-0000-4000-8000-000000000006","source_completed_at":"2026-10-01T00:06:00Z","regime_compatibility":null},{"',
  'strategy_id":"5c000000-0000-4000-8000-000000000008","name":"Short history","strategy_type":"PYTHON","version":1,"is_active":true,"status":"UNSCORED","',
  'reason":"The factors could not be computed: Insufficient history: need at least 21 observations; received 15.","strategy_key":"momentum","rank":null,"',
  'composite_score":null,"factors":[],"as_of":null,"instruments":[{"id":"b2c1f0aa-0000-4000-8000-000000000003","symbol":"GOLDM"}],"source_execution_id":"',
  'e0000000-0000-4000-8000-000000000008","source_completed_at":"2026-10-01T00:08:00Z","regime_compatibility":null}]}',
].join('');

const CURRENT_REGIME_JSON = [
  '{"statement":"The regime is the model\'s classification of the market\'s recent behaviour (volatility and trend). It describes the past; it is not a for',
  'ecast.","model":{"id":"f0c390c7-f75b-4dfa-adc9-5bda6d320fde","number":1,"status":"READY","is_active":true,"model_version":"gmm-regime-v1","instrument"',
  ':{"id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","symbol":"RELIANCE","trading_symbol":"RELIANCE-EQ"},"settings":{"end_date":null,"start_date":null,"rando',
  'm_state":7,"trend_window":20,"instrument_id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","volatility_window":20,"candidate_components":[2,3,4]},"trained_by',
  '_you":true,"error_message":null,"created_at":"2026-10-17T14:28:20.290340Z","started_at":"2026-10-17T14:28:20.316451Z","completed_at":"2026-10-17T14:28',
  ':20.725616Z"},"instrument":{"id":"31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2","symbol":"RELIANCE","trading_symbol":"RELIANCE-EQ"},"as_of":"2023-02-24T00:00:',
  '00+00:00","regime":{"regime_id":0,"code":"R1","name":"Low volatility, uptrend","volatility_state":"Low volatility","trend_state":"Uptrend","mean_log_r',
  'eturn":0.0019003851432317208,"mean_realized_volatility":0.004914226358894916,"mean_trend_strength":0.37234380630030156,"annualized_return":0.478897056',
  '09439365,"annualized_volatility":0.07801092499148636,"training_days":106,"training_share":0.5408163265306123},"confidence":0.9857637137654727,"probabi',
  'lities":[{"regime_id":0,"code":"R1","name":"Low volatility, uptrend","probability":0.9857637137654727},{"regime_id":1,"code":"R2","name":"High volatil',
  'ity, sideways","probability":0.014236286234527346}]}',
].join('');

export const PORTFOLIO_LIST = JSON.parse(LIST_JSON) as PortfolioSummary[];
export const PORTFOLIO_ACCOUNT_EMPTY = JSON.parse(ACCOUNT_EMPTY_JSON) as PortfolioAccount;
export const PORTFOLIO_ACCOUNT_SAVED = JSON.parse(ACCOUNT_SAVED_JSON) as PortfolioAccount;
export const PORTFOLIO_TARGET = JSON.parse(TARGET_JSON) as TargetPortfolio;
export const PORTFOLIO_TARGET_LIMITS = JSON.parse(TARGET_LIMITS_JSON) as TargetPortfolio;
export const PORTFOLIO_TARGET_REGIME = JSON.parse(TARGET_REGIME_JSON) as TargetPortfolio;
export const PORTFOLIO_PRICES = JSON.parse(PRICES_JSON) as AssetPrice[];
export const PORTFOLIO_REBALANCE = JSON.parse(REBALANCE_JSON) as RebalancePlan;
export const PORTFOLIO_REBALANCE_HELD = JSON.parse(REBALANCE_HELD_JSON) as RebalancePlan;
export const PORTFOLIO_SCORES = JSON.parse(SCORES_JSON) as ScoringResult;
export const PORTFOLIO_CURRENT_REGIME = JSON.parse(CURRENT_REGIME_JSON) as CurrentRegime;
