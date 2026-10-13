from fastapi import FastAPI

from app.api.auth.routes import router as auth_router
from app.api.users.routes import router as users_router
from app.api.brokers.routes import router as brokers_router
from app.api.strategies.routes import router as strategies_router
from app.api.instruments.routes import router as instruments_router
from app.api.executions.routes import router as executions_router
from app.api.backtesting.routes import router as backtesting_router
from app.api.orders.routes import router as orders_router
from app.api.trades.routes import router as trades_router
from app.api.positions.routes import router as positions_router
from app.api.portfolio.routes import router as portfolio_router
from app.api.notifications.routes import router as notifications_router
from app.config import settings


app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
)


app.include_router(auth_router)
app.include_router(users_router)
app.include_router(brokers_router)
app.include_router(strategies_router)
app.include_router(instruments_router)
app.include_router(executions_router)
app.include_router(backtesting_router)
app.include_router(orders_router)
app.include_router(trades_router)
app.include_router(positions_router)
app.include_router(portfolio_router)
app.include_router(notifications_router)


@app.get("/")
def home():
    return {
        "message": f"Welcome to {settings.app_name}!"
    }
