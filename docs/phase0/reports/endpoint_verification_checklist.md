# Endpoint Verification Checklist

Source: openapi.json. This checklist tracks all documented operations; entries are pending until explicitly tested.

- Total operations: 65
- Success examples: PENDING
- Failure examples: PENDING
- Runtime verification: PENDING

| Method | Path | Operation ID | Success Example | Failure Example | Runtime Verified |
|---|---|---|---|---|---|
| POST | /auth/register | register_auth_register_post | PENDING | PENDING | NO |
| POST | /auth/login | login_auth_login_post | PENDING | PENDING | NO |
| POST | /auth/change-password | change_password_auth_change_password_post | PENDING | PENDING | NO |
| GET | /users/me | get_current_user_profile_users_me_get | PENDING | PENDING | NO |
| PATCH | /users/me | update_current_user_profile_users_me_patch | PENDING | PENDING | NO |
| GET | /brokers/accounts | list_broker_accounts_brokers_accounts_get | PENDING | PENDING | NO |
| POST | /brokers/accounts | create_broker_account_brokers_accounts_post | PENDING | PENDING | NO |
| GET | /brokers/accounts/{broker_account_id} | get_broker_account_brokers_accounts__broker_account_id__get | PENDING | PENDING | NO |
| PATCH | /brokers/accounts/{broker_account_id} | update_broker_account_brokers_accounts__broker_account_id__patch | PENDING | PENDING | NO |
| DELETE | /brokers/accounts/{broker_account_id} | delete_broker_account_brokers_accounts__broker_account_id__delete | PENDING | PENDING | NO |
| POST | /brokers/accounts/{broker_account_id}/connect | connect_broker_account_brokers_accounts__broker_account_id__connect_post | PENDING | PENDING | NO |
| POST | /brokers/accounts/{broker_account_id}/disconnect | disconnect_broker_account_brokers_accounts__broker_account_id__disconnect_post | PENDING | PENDING | NO |
| GET | /strategies | list_strategies_strategies_get | PENDING | PENDING | NO |
| POST | /strategies | create_strategy_strategies_post | PENDING | PENDING | NO |
| GET | /strategies/{strategy_id} | get_strategy_strategies__strategy_id__get | PENDING | PENDING | NO |
| PATCH | /strategies/{strategy_id} | update_strategy_strategies__strategy_id__patch | PENDING | PENDING | NO |
| DELETE | /strategies/{strategy_id} | delete_strategy_strategies__strategy_id__delete | PENDING | PENDING | NO |
| POST | /instruments | create_instrument_instruments_post | PENDING | PENDING | NO |
| GET | /instruments | list_instruments_instruments_get | PENDING | PENDING | NO |
| GET | /instruments/{instrument_id} | get_instrument_instruments__instrument_id__get | PENDING | PENDING | NO |
| PATCH | /instruments/{instrument_id} | update_instrument_instruments__instrument_id__patch | PENDING | PENDING | NO |
| DELETE | /instruments/{instrument_id} | delete_instrument_instruments__instrument_id__delete | PENDING | PENDING | NO |
| GET | /executions | list_executions_executions_get | PENDING | PENDING | NO |
| POST | /executions | create_execution_executions_post | PENDING | PENDING | NO |
| GET | /executions/{execution_id} | get_execution_executions__execution_id__get | PENDING | PENDING | NO |
| PATCH | /executions/{execution_id} | update_execution_executions__execution_id__patch | PENDING | PENDING | NO |
| DELETE | /executions/{execution_id} | delete_execution_executions__execution_id__delete | PENDING | PENDING | NO |
| POST | /executions/{execution_id}/start | start_execution_executions__execution_id__start_post | PENDING | PENDING | NO |
| POST | /executions/{execution_id}/complete | complete_execution_executions__execution_id__complete_post | PENDING | PENDING | NO |
| POST | /executions/{execution_id}/fail | fail_execution_executions__execution_id__fail_post | PENDING | PENDING | NO |
| POST | /executions/{execution_id}/cancel | cancel_execution_executions__execution_id__cancel_post | PENDING | PENDING | NO |
| POST | /backtests | create_backtest_backtests_post | PENDING | PENDING | NO |
| GET | /orders | list_orders_orders_get | PENDING | PENDING | NO |
| POST | /orders | create_order_orders_post | PENDING | PENDING | NO |
| GET | /orders/{order_id} | get_order_orders__order_id__get | PENDING | PENDING | NO |
| PATCH | /orders/{order_id} | update_order_orders__order_id__patch | PENDING | PENDING | NO |
| DELETE | /orders/{order_id} | delete_order_orders__order_id__delete | PENDING | PENDING | NO |
| POST | /orders/{order_id}/reject | reject_order_orders__order_id__reject_post | PENDING | PENDING | NO |
| POST | /orders/{order_id}/cancel | cancel_order_orders__order_id__cancel_post | PENDING | PENDING | NO |
| POST | /orders/{order_id}/complete | complete_order_orders__order_id__complete_post | PENDING | PENDING | NO |
| POST | /orders/{order_id}/open | open_order_orders__order_id__open_post | PENDING | PENDING | NO |
| GET | /trades | list_trades_trades_get | PENDING | PENDING | NO |
| POST | /trades | create_trade_trades_post | PENDING | PENDING | NO |
| POST | /trades/execute | execute_trade_trades_execute_post | PENDING | PENDING | NO |
| GET | /trades/{trade_id} | get_trade_trades__trade_id__get | PENDING | PENDING | NO |
| PATCH | /trades/{trade_id} | update_trade_trades__trade_id__patch | PENDING | PENDING | NO |
| DELETE | /trades/{trade_id} | delete_trade_trades__trade_id__delete | PENDING | PENDING | NO |
| GET | /positions | list_positions_positions_get | PENDING | PENDING | NO |
| POST | /positions | create_position_positions_post | PENDING | PENDING | NO |
| GET | /positions/{position_id} | get_position_positions__position_id__get | PENDING | PENDING | NO |
| PATCH | /positions/{position_id} | update_position_positions__position_id__patch | PENDING | PENDING | NO |
| DELETE | /positions/{position_id} | delete_position_positions__position_id__delete | PENDING | PENDING | NO |
| POST | /portfolio/target | calculate_target_portfolio_target_post | PENDING | PENDING | NO |
| POST | /portfolio/rebalance | propose_rebalance_portfolio_rebalance_post | PENDING | PENDING | NO |
| GET | /portfolio/accounts | list_portfolios_portfolio_accounts_get | PENDING | PENDING | NO |
| POST | /portfolio/accounts | create_portfolio_portfolio_accounts_post | PENDING | PENDING | NO |
| GET | /portfolio/accounts/{portfolio_id} | get_portfolio_state_portfolio_accounts__portfolio_id__get | PENDING | PENDING | NO |
| PUT | /portfolio/accounts/{portfolio_id}/state | update_portfolio_state_portfolio_accounts__portfolio_id__state_put | PENDING | PENDING | NO |
| POST | /notifications | create_notification_notifications_post | PENDING | PENDING | NO |
| GET | /notifications | list_notifications_notifications_get | PENDING | PENDING | NO |
| POST | /notifications/execution | create_execution_notification_notifications_execution_post | PENDING | PENDING | NO |
| GET | /notifications/{notification_id} | get_notification_notifications__notification_id__get | PENDING | PENDING | NO |
| PATCH | /notifications/{notification_id} | update_notification_notifications__notification_id__patch | PENDING | PENDING | NO |
| DELETE | /notifications/{notification_id} | delete_notification_notifications__notification_id__delete | PENDING | PENDING | NO |
| GET | / | home__get | PENDING | PENDING | NO |
