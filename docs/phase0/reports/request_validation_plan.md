# Request Validation Plan

Generated from `openapi.json`: 65 operations.

This is a test plan, not evidence of runtime success. No API requests are sent by this generator.

| Method | Path | Operation ID | Request Schema | Required Fields | Path Parameters |
|---|---|---|---|---|---|
| POST | /auth/register | register_auth_register_post | RegisterRequest | email, full_name, password | none |
| POST | /auth/login | login_auth_login_post | LoginRequest | email, password | none |
| POST | /auth/change-password | change_password_auth_change_password_post | ChangePasswordRequest | current_password, new_password | none |
| GET | /users/me | get_current_user_profile_users_me_get | none | none | none |
| PATCH | /users/me | update_current_user_profile_users_me_patch | UpdateProfileRequest | none | none |
| GET | /brokers/accounts | list_broker_accounts_brokers_accounts_get | none | none | none |
| POST | /brokers/accounts | create_broker_account_brokers_accounts_post | CreateBrokerAccountRequest | api_key, api_secret, broker_name, broker_user_id | none |
| GET | /brokers/accounts/{broker_account_id} | get_broker_account_brokers_accounts__broker_account_id__get | none | none | broker_account_id |
| PATCH | /brokers/accounts/{broker_account_id} | update_broker_account_brokers_accounts__broker_account_id__patch | UpdateBrokerAccountRequest | none | broker_account_id |
| DELETE | /brokers/accounts/{broker_account_id} | delete_broker_account_brokers_accounts__broker_account_id__delete | none | none | broker_account_id |
| POST | /brokers/accounts/{broker_account_id}/connect | connect_broker_account_brokers_accounts__broker_account_id__connect_post | ConnectBrokerAccountRequest | access_token | broker_account_id |
| POST | /brokers/accounts/{broker_account_id}/disconnect | disconnect_broker_account_brokers_accounts__broker_account_id__disconnect_post | none | none | broker_account_id |
| GET | /strategies | list_strategies_strategies_get | none | none | none |
| POST | /strategies | create_strategy_strategies_post | CreateStrategyRequest | name, strategy_config, strategy_type | none |
| GET | /strategies/{strategy_id} | get_strategy_strategies__strategy_id__get | none | none | strategy_id |
| PATCH | /strategies/{strategy_id} | update_strategy_strategies__strategy_id__patch | UpdateStrategyRequest | none | strategy_id |
| DELETE | /strategies/{strategy_id} | delete_strategy_strategies__strategy_id__delete | none | none | strategy_id |
| POST | /instruments | create_instrument_instruments_post | CreateInstrumentRequest | exchange, instrument_type, name, symbol, trading_symbol | none |
| GET | /instruments | list_instruments_instruments_get | none | none | none |
| GET | /instruments/{instrument_id} | get_instrument_instruments__instrument_id__get | none | none | instrument_id |
| PATCH | /instruments/{instrument_id} | update_instrument_instruments__instrument_id__patch | UpdateInstrumentRequest | none | instrument_id |
| DELETE | /instruments/{instrument_id} | delete_instrument_instruments__instrument_id__delete | none | none | instrument_id |
| GET | /executions | list_executions_executions_get | none | none | none |
| POST | /executions | create_execution_executions_post | CreateExecutionRequest | execution_type, initial_capital, instrument_id, status, strategy_id, timeframe | none |
| GET | /executions/{execution_id} | get_execution_executions__execution_id__get | none | none | execution_id |
| PATCH | /executions/{execution_id} | update_execution_executions__execution_id__patch | UpdateExecutionRequest | none | execution_id |
| DELETE | /executions/{execution_id} | delete_execution_executions__execution_id__delete | none | none | execution_id |
| POST | /executions/{execution_id}/start | start_execution_executions__execution_id__start_post | none | none | execution_id |
| POST | /executions/{execution_id}/complete | complete_execution_executions__execution_id__complete_post | none | none | execution_id |
| POST | /executions/{execution_id}/fail | fail_execution_executions__execution_id__fail_post | FailExecutionRequest | error_message | execution_id |
| POST | /executions/{execution_id}/cancel | cancel_execution_executions__execution_id__cancel_post | none | none | execution_id |
| POST | /backtests | create_backtest_backtests_post | CreateBacktestRequest | initial_capital, instrument_id, strategy_id, strategy_key, timeframe | none |
| GET | /orders | list_orders_orders_get | none | none | none |
| POST | /orders | create_order_orders_post | CreateOrderRequest | execution_id, filled_quantity, instrument_id, order_side, order_type, price, quantity, status | none |
| GET | /orders/{order_id} | get_order_orders__order_id__get | none | none | order_id |
| PATCH | /orders/{order_id} | update_order_orders__order_id__patch | UpdateOrderRequest | none | order_id |
| DELETE | /orders/{order_id} | delete_order_orders__order_id__delete | none | none | order_id |
| POST | /orders/{order_id}/reject | reject_order_orders__order_id__reject_post | none | none | order_id |
| POST | /orders/{order_id}/cancel | cancel_order_orders__order_id__cancel_post | none | none | order_id |
| POST | /orders/{order_id}/complete | complete_order_orders__order_id__complete_post | none | none | order_id |
| POST | /orders/{order_id}/open | open_order_orders__order_id__open_post | none | none | order_id |
| GET | /trades | list_trades_trades_get | none | none | none |
| POST | /trades | create_trade_trades_post | CreateTradeRequest | executed_price, executed_quantity, order_id | none |
| POST | /trades/execute | execute_trade_trades_execute_post | CreateTradeRequest | executed_price, executed_quantity, order_id | none |
| GET | /trades/{trade_id} | get_trade_trades__trade_id__get | none | none | trade_id |
| PATCH | /trades/{trade_id} | update_trade_trades__trade_id__patch | UpdateTradeRequest | none | trade_id |
| DELETE | /trades/{trade_id} | delete_trade_trades__trade_id__delete | none | none | trade_id |
| GET | /positions | list_positions_positions_get | none | none | none |
| POST | /positions | create_position_positions_post | CreatePositionRequest | average_price, execution_id, instrument_id, last_updated_at, quantity | none |
| GET | /positions/{position_id} | get_position_positions__position_id__get | none | none | position_id |
| PATCH | /positions/{position_id} | update_position_positions__position_id__patch | UpdatePositionRequest | none | position_id |
| DELETE | /positions/{position_id} | delete_position_positions__position_id__delete | none | none | position_id |
| POST | /portfolio/target | calculate_target_portfolio_target_post | TargetPortfolioRequest | candidates, capital | none |
| POST | /portfolio/rebalance | propose_rebalance_portfolio_rebalance_post | PortfolioRebalanceRequest | candidates, cash, holdings, prices | none |
| GET | /portfolio/accounts | list_portfolios_portfolio_accounts_get | none | none | none |
| POST | /portfolio/accounts | create_portfolio_portfolio_accounts_post | CreatePortfolioRequest | initial_capital, name | none |
| GET | /portfolio/accounts/{portfolio_id} | get_portfolio_state_portfolio_accounts__portfolio_id__get | none | none | portfolio_id |
| PUT | /portfolio/accounts/{portfolio_id}/state | update_portfolio_state_portfolio_accounts__portfolio_id__state_put | UpdatePortfolioStateRequest | cash | portfolio_id |
| POST | /notifications | create_notification_notifications_post | CreateNotificationRequest | message, notification_type, title, user_id | none |
| GET | /notifications | list_notifications_notifications_get | none | none | none |
| POST | /notifications/execution | create_execution_notification_notifications_execution_post | CreateNotificationRequest | message, notification_type, title, user_id | none |
| GET | /notifications/{notification_id} | get_notification_notifications__notification_id__get | none | none | notification_id |
| PATCH | /notifications/{notification_id} | update_notification_notifications__notification_id__patch | UpdateNotificationRequest | none | notification_id |
| DELETE | /notifications/{notification_id} | delete_notification_notifications__notification_id__delete | none | none | notification_id |
| GET | / | home__get | none | none | none |
