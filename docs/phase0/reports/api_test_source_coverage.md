# API Test Source Coverage

- OpenAPI operations: 65
- Operations with matching test-source calls: 53
- Operations without matching calls: 12

> Static source matching only. A matching call does not prove that the test passes or that success, failure, authentication, and ownership cases are all covered.

| Method | Path | Operation ID | Matching Test Files |
|---|---|---|---|
| POST | /auth/register | register_auth_register_post | NONE FOUND |
| POST | /auth/login | login_auth_login_post | NONE FOUND |
| POST | /auth/change-password | change_password_auth_change_password_post | NONE FOUND |
| GET | /users/me | get_current_user_profile_users_me_get | NONE FOUND |
| PATCH | /users/me | update_current_user_profile_users_me_patch | NONE FOUND |
| GET | /brokers/accounts | list_broker_accounts_brokers_accounts_get | test_broker_account_api.py |
| POST | /brokers/accounts | create_broker_account_brokers_accounts_post | test_broker_account_api.py |
| GET | /brokers/accounts/{broker_account_id} | get_broker_account_brokers_accounts__broker_account_id__get | NONE FOUND |
| PATCH | /brokers/accounts/{broker_account_id} | update_broker_account_brokers_accounts__broker_account_id__patch | NONE FOUND |
| DELETE | /brokers/accounts/{broker_account_id} | delete_broker_account_brokers_accounts__broker_account_id__delete | NONE FOUND |
| POST | /brokers/accounts/{broker_account_id}/connect | connect_broker_account_brokers_accounts__broker_account_id__connect_post | test_broker_account_api.py |
| POST | /brokers/accounts/{broker_account_id}/disconnect | disconnect_broker_account_brokers_accounts__broker_account_id__disconnect_post | test_broker_account_api.py |
| GET | /strategies | list_strategies_strategies_get | test_strategy_api.py |
| POST | /strategies | create_strategy_strategies_post | test_strategy_api.py |
| GET | /strategies/{strategy_id} | get_strategy_strategies__strategy_id__get | test_strategy_api.py |
| PATCH | /strategies/{strategy_id} | update_strategy_strategies__strategy_id__patch | test_strategy_api.py |
| DELETE | /strategies/{strategy_id} | delete_strategy_strategies__strategy_id__delete | test_strategy_api.py |
| POST | /instruments | create_instrument_instruments_post | test_instrument_api.py |
| GET | /instruments | list_instruments_instruments_get | test_instrument_api.py |
| GET | /instruments/{instrument_id} | get_instrument_instruments__instrument_id__get | test_instrument_api.py |
| PATCH | /instruments/{instrument_id} | update_instrument_instruments__instrument_id__patch | test_instrument_api.py |
| DELETE | /instruments/{instrument_id} | delete_instrument_instruments__instrument_id__delete | test_instrument_api.py |
| GET | /executions | list_executions_executions_get | test_execution_api.py |
| POST | /executions | create_execution_executions_post | test_execution_api.py |
| GET | /executions/{execution_id} | get_execution_executions__execution_id__get | test_execution_api.py |
| PATCH | /executions/{execution_id} | update_execution_executions__execution_id__patch | test_execution_api.py |
| DELETE | /executions/{execution_id} | delete_execution_executions__execution_id__delete | test_execution_api.py |
| POST | /executions/{execution_id}/start | start_execution_executions__execution_id__start_post | test_execution_api.py |
| POST | /executions/{execution_id}/complete | complete_execution_executions__execution_id__complete_post | test_execution_api.py |
| POST | /executions/{execution_id}/fail | fail_execution_executions__execution_id__fail_post | test_execution_api.py |
| POST | /executions/{execution_id}/cancel | cancel_execution_executions__execution_id__cancel_post | test_execution_api.py |
| POST | /backtests | create_backtest_backtests_post | test_execution_api.py |
| GET | /orders | list_orders_orders_get | test_order_api.py |
| POST | /orders | create_order_orders_post | test_order_api.py |
| GET | /orders/{order_id} | get_order_orders__order_id__get | test_order_api.py |
| PATCH | /orders/{order_id} | update_order_orders__order_id__patch | test_order_api.py |
| DELETE | /orders/{order_id} | delete_order_orders__order_id__delete | test_order_api.py |
| POST | /orders/{order_id}/reject | reject_order_orders__order_id__reject_post | test_order_api.py |
| POST | /orders/{order_id}/cancel | cancel_order_orders__order_id__cancel_post | test_order_api.py |
| POST | /orders/{order_id}/complete | complete_order_orders__order_id__complete_post | test_order_api.py |
| POST | /orders/{order_id}/open | open_order_orders__order_id__open_post | test_order_api.py |
| GET | /trades | list_trades_trades_get | test_trade_api.py |
| POST | /trades | create_trade_trades_post | test_trade_api.py |
| POST | /trades/execute | execute_trade_trades_execute_post | test_trade_api.py |
| GET | /trades/{trade_id} | get_trade_trades__trade_id__get | test_trade_api.py |
| PATCH | /trades/{trade_id} | update_trade_trades__trade_id__patch | test_trade_api.py |
| DELETE | /trades/{trade_id} | delete_trade_trades__trade_id__delete | test_trade_api.py |
| GET | /positions | list_positions_positions_get | test_position_api.py |
| POST | /positions | create_position_positions_post | test_position_api.py |
| GET | /positions/{position_id} | get_position_positions__position_id__get | test_position_api.py |
| PATCH | /positions/{position_id} | update_position_positions__position_id__patch | test_position_api.py |
| DELETE | /positions/{position_id} | delete_position_positions__position_id__delete | test_position_api.py |
| POST | /portfolio/target | calculate_target_portfolio_target_post | test_portfolio_api.py |
| POST | /portfolio/rebalance | propose_rebalance_portfolio_rebalance_post | test_portfolio_api.py |
| GET | /portfolio/accounts | list_portfolios_portfolio_accounts_get | NONE FOUND |
| POST | /portfolio/accounts | create_portfolio_portfolio_accounts_post | NONE FOUND |
| GET | /portfolio/accounts/{portfolio_id} | get_portfolio_state_portfolio_accounts__portfolio_id__get | NONE FOUND |
| PUT | /portfolio/accounts/{portfolio_id}/state | update_portfolio_state_portfolio_accounts__portfolio_id__state_put | NONE FOUND |
| POST | /notifications | create_notification_notifications_post | test_notification_api.py |
| GET | /notifications | list_notifications_notifications_get | test_notification_api.py |
| POST | /notifications/execution | create_execution_notification_notifications_execution_post | test_notification_api.py |
| GET | /notifications/{notification_id} | get_notification_notifications__notification_id__get | test_notification_api.py |
| PATCH | /notifications/{notification_id} | update_notification_notifications__notification_id__patch | test_notification_api.py |
| DELETE | /notifications/{notification_id} | delete_notification_notifications__notification_id__delete | test_notification_api.py |
| GET | / | home__get | test_broker_account_api.py |
