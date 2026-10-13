from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str
    app_env: str
    debug: bool

    host: str
    port: int

    database_url: str

    secret_key: str
    algorithm: str
    access_token_expire_minutes: int

    market_data_provider: str = "yahoo_finance"

    backtest_timeout_seconds: int = Field(default=300, gt=0)
    backtest_cache_dir: Path = BASE_DIR / ".cache" / "backtests"
    backtest_log_retention_days: int = Field(default=30, ge=0)
    backtest_temporary_retention_hours: int = Field(default=24, ge=0)

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
