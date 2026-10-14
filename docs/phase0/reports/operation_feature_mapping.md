# Operation-Level Feature Mapping

Source: `openapi.json`. 65 operations across 39 paths.

> Initial mapping only. Inventory does not prove runtime behavior, security, or acceptance.

| Method | Path | Operation ID | Feature ID | Status |
|---|---|---|---|---|
| POST | /auth/register | register_auth_register_post | F-01 | INVENTORIED: runtime verification pending |
| POST | /auth/login | login_auth_login_post | F-01 | INVENTORIED: runtime verification pending |
| POST | /auth/change-password | change_password_auth_change_password_post | F-01 | INVENTORIED: runtime verification pending |
| GET | /users/me | get_current_user_profile_users_me_get | F-02 | INVENTORIED: runtime verification pending |
| PATCH | /users/me | update_current_user_profile_users_me_patch | F-02 | INVENTORIED: runtime verification pending |
| GET | /brokers/accounts | list_broker_accounts_brokers_accounts_get | F-03 | INVENTORIED: runtime verification pending |
| POST | /brokers/accounts | create_broker_account_brokers_accounts_post | F-03 | INVENTORIED: runtime verification pending |
| GET | /brokers/accounts/{broker_account_id} | get_broker_account_brokers_accounts__broker_account_id__get | F-03 | INVENTORIED: runtime verification pending |
| PATCH | /brokers/accounts/{broker_account_id} | update_broker_account_brokers_accounts__broker_account_id__patch | F-03 | INVENTORIED: runtime verification pending |
| DELETE | /brokers/accounts/{broker_account_id} | delete_broker_account_brokers_accounts__broker_account_id__delete | F-03 | INVENTORIED: runtime verification pending |
| POST | /brokers/accounts/{broker_account_id}/connect | connect_broker_account_brokers_accounts__broker_account_id__connect_post | F-03 | INVENTORIED: runtime verification pending |
| POST | /brokers/accounts/{broker_account_id}/disconnect | disconnect_broker_account_brokers_accounts__broker_account_id__disconnect_post | F-03 | INVENTORIED: runtime verification pending |
| GET | /strategies | list_strategies_strategies_get | F-04 | INVENTORIED: runtime verification pending |
| POST | /strategies | create_strategy_strategies_post | F-04 | INVENTORIED: runtime verification pending |
| GET | /strategies/{strategy_id} | get_strategy_strategies__strategy_id__get | F-04 | INVENTORIED: runtime verification pending |
| PATCH | /strategies/{strategy_id} | update_strategy_strategies__strategy_id__patch | F-04 | INVENTORIED: runtime verification pending |
| DELETE | /strategies/{strategy_id} | delete_strategy_strategies__strategy_id__delete | F-04 | INVENTORIED: runtime verification pending |
| POST | /instruments | create_instrument_instruments_post | F-05 | INVENTORIED: runtime verification pending |
| GET | /instruments | list_instruments_instruments_get | F-05 | INVENTORIED: runtime verification pending |
| GET | /instruments/{instrument_id} | get_instrument_instruments__instrument_id__get | F-05 | INVENTORIED: runtime verification pending |
| PATCH | /instruments/{instrument_id} | update_instrument_instruments__instrument_id__patch | F-05 | INVENTORIED: runtime verification pending |
| DELETE | /instruments/{instrument_id} | delete_instrument_instruments__instrument_id__delete | F-05 | INVENTORIED: runtime verification pending |
| GET | /executions | list_executions_executions_get | F-10 | REVIEW: security and ownership |
| POST | /executions | create_execution_executions_post | F-10 | REVIEW: security and ownership |
| GET | /executions/{execution_id} | get_execution_executions__execution_id__get | F-10 | REVIEW: security and ownership |
| PATCH | /executions/{execution_id} | update_execution_executions__execution_id__patch | F-10 | REVIEW: security and ownership |
| DELETE | /executions/{execution_id} | delete_execution_executions__execution_id__delete | F-10 | REVIEW: security and ownership |
| POST | /executions/{execution_id}/start | start_execution_executions__execution_id__start_post | F-10 | REVIEW: security and ownership |
| POST | /executions/{execution_id}/complete | complete_execution_executions__execution_id__complete_post | F-10 | REVIEW: security and ownership |
| POST | /executions/{execution_id}/fail | fail_execution_executions__execution_id__fail_post | F-10 | REVIEW: security and ownership |
| POST | /executions/{execution_id}/cancel | cancel_execution_executions__execution_id__cancel_post | F-10 | REVIEW: security and ownership |
| POST | /backtests | create_backtest_backtests_post | F-07 | REVIEW: security and ownership |
| GET | /orders | list_orders_orders_get | F-11 | REVIEW: security and ownership |
| POST | /orders | create_order_orders_post | F-11 | REVIEW: security and ownership |
| GET | /orders/{order_id} | get_order_orders__order_id__get | F-11 | REVIEW: security and ownership |
| PATCH | /orders/{order_id} | update_order_orders__order_id__patch | F-11 | REVIEW: security and ownership |
| DELETE | /orders/{order_id} | delete_order_orders__order_id__delete | F-11 | REVIEW: security and ownership |
| POST | /orders/{order_id}/reject | reject_order_orders__order_id__reject_post | F-11 | REVIEW: security and ownership |
| POST | /orders/{order_id}/cancel | cancel_order_orders__order_id__cancel_post | F-11 | REVIEW: security and ownership |
| POST | /orders/{order_id}/complete | complete_order_orders__order_id__complete_post | F-11 | REVIEW: security and ownership |
| POST | /orders/{order_id}/open | open_order_orders__order_id__open_post | F-11 | REVIEW: security and ownership |
| GET | /trades | list_trades_trades_get | F-12 | REVIEW: security and ownership |
| POST | /trades | create_trade_trades_post | F-12 | REVIEW: security and ownership |
| POST | /trades/execute | execute_trade_trades_execute_post | F-12 | REVIEW: security and ownership |
| GET | /trades/{trade_id} | get_trade_trades__trade_id__get | F-12 | REVIEW: security and ownership |
| PATCH | /trades/{trade_id} | update_trade_trades__trade_id__patch | F-12 | REVIEW: security and ownership |
| DELETE | /trades/{trade_id} | delete_trade_trades__trade_id__delete | F-12 | REVIEW: security and ownership |
| GET | /positions | list_positions_positions_get | F-13 | REVIEW: security and ownership |
| POST | /positions | create_position_positions_post | F-13 | REVIEW: security and ownership |
| GET | /positions/{position_id} | get_position_positions__position_id__get | F-13 | REVIEW: security and ownership |
| PATCH | /positions/{position_id} | update_position_positions__position_id__patch | F-13 | REVIEW: security and ownership |
| DELETE | /positions/{position_id} | delete_position_positions__position_id__delete | F-13 | REVIEW: security and ownership |
| POST | /portfolio/target | calculate_target_portfolio_target_post | F-14 | INVENTORIED: runtime verification pending |
| POST | /portfolio/rebalance | propose_rebalance_portfolio_rebalance_post | F-14 | INVENTORIED: runtime verification pending |
| GET | /portfolio/accounts | list_portfolios_portfolio_accounts_get | F-14 | INVENTORIED: runtime verification pending |
| POST | /portfolio/accounts | create_portfolio_portfolio_accounts_post | F-14 | INVENTORIED: runtime verification pending |
| GET | /portfolio/accounts/{portfolio_id} | get_portfolio_state_portfolio_accounts__portfolio_id__get | F-14 | INVENTORIED: runtime verification pending |
| PUT | /portfolio/accounts/{portfolio_id}/state | update_portfolio_state_portfolio_accounts__portfolio_id__state_put | F-14 | INVENTORIED: runtime verification pending |
| POST | /notifications | create_notification_notifications_post | F-15 | INVENTORIED: runtime verification pending |
| GET | /notifications | list_notifications_notifications_get | F-15 | INVENTORIED: runtime verification pending |
| POST | /notifications/execution | create_execution_notification_notifications_execution_post | F-15 | INVENTORIED: runtime verification pending |
| GET | /notifications/{notification_id} | get_notification_notifications__notification_id__get | F-15 | INVENTORIED: runtime verification pending |
| PATCH | /notifications/{notification_id} | update_notification_notifications__notification_id__patch | F-15 | INVENTORIED: runtime verification pending |
| DELETE | /notifications/{notification_id} | delete_notification_notifications__notification_id__delete | F-15 | INVENTORIED: runtime verification pending |
| GET | / | home__get | F-22 | INVENTORIED: runtime verification pending |
