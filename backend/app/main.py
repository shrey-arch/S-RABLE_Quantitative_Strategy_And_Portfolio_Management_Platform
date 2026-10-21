from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.auth.routes import router as auth_router
from app.api.users.routes import router as users_router
from app.api.brokers.routes import router as brokers_router
from app.api.strategies.routes import router as strategies_router
from app.api.sandbox.routes import router as sandbox_router
from app.api.strategies.registry_routes import router as strategy_registry_router
from app.api.instruments.routes import router as instruments_router
from app.api.market_data.routes import router as market_data_router
from app.api.indicators.routes import router as indicators_router
from app.api.indicators.routes import series_router as indicator_series_router
from app.api.executions.routes import router as executions_router
from app.api.backtesting.routes import router as backtesting_router
from app.api.validation.routes import router as validation_router
from app.api.regime.routes import router as regime_router
from app.api.scoring.routes import router as scoring_router
from app.api.records.routes import router as records_router
from app.api.orders.routes import router as orders_router
from app.api.trades.routes import router as trades_router
from app.api.positions.routes import router as positions_router
from app.api.portfolio.routes import router as portfolio_router
from app.api.notifications.routes import router as notifications_router
from app.api.paper.routes import router as paper_router
from app.api.live.routes import router as live_router
from app.api.portfolio_backtest.routes import router as portfolio_backtest_router
from app.config import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    from app.services.backtesting.startup import fail_stranded_backtests
    from app.services.regime.service import fail_stranded_training

    try:
        fail_stranded_backtests()
        fail_stranded_training()
    except Exception:  # the API must still start if the database is not ready
        import logging

        logging.getLogger(__name__).exception("Could not check for stranded runs.")
    matcher = None
    if settings.paper_matcher_enabled:
        import asyncio

        from app.services.paper.matcher import matcher_loop

        matcher = asyncio.create_task(matcher_loop())
    live = None
    if settings.live_runner_enabled:
        import asyncio

        from app.services.live.worker import runner_loop

        live = asyncio.create_task(runner_loop())
    yield
    if matcher is not None:
        matcher.cancel()
    if live is not None:
        live.cancel()


app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    lifespan=lifespan,
)


app.include_router(auth_router)
app.include_router(users_router)
app.include_router(brokers_router)
app.include_router(strategies_router)
app.include_router(sandbox_router)
app.include_router(strategy_registry_router)
app.include_router(instruments_router)
app.include_router(market_data_router)
app.include_router(indicators_router)
app.include_router(indicator_series_router)
app.include_router(executions_router)
app.include_router(backtesting_router)
app.include_router(validation_router)
app.include_router(regime_router)
app.include_router(scoring_router)
app.include_router(records_router)
app.include_router(orders_router)
app.include_router(trades_router)
app.include_router(positions_router)
app.include_router(portfolio_router)
app.include_router(portfolio_backtest_router)
app.include_router(live_router)
app.include_router(notifications_router)
app.include_router(paper_router)


@app.get("/")
def home():
    return {
        "message": f"Welcome to {settings.app_name}!"
    }
