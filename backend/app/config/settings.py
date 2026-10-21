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
    # A validation run (Phase 11) runs many backtests (walk-forward windows, the
    # parameter grid, Monte Carlo), so it may take longer.
    validation_timeout_seconds: int = Field(default=1800, gt=0)
    backtest_cache_dir: Path = BASE_DIR / ".cache" / "backtests"
    backtest_log_retention_days: int = Field(default=30, ge=0)
    backtest_temporary_retention_hours: int = Field(default=24, ge=0)
    # Paper trading (Feature 1): match open orders every minute in market hours.
    paper_matcher_enabled: bool = True
    # Feature 7: the live paper session runner (a loop in the FastAPI process).
    live_runner_enabled: bool = True
    # Feature 6: which sandbox runs custom Python strategies.
    #   "auto"    - Docker when it is running and the image is built, else a
    #               guarded separate process (the default);
    #   "docker"  - Docker only; a run fails if Docker is not available;
    #   "process" - the guarded separate process only.
    sandbox_backend: str = "auto"

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
