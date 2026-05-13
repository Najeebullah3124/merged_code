from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="SIS_", extra="ignore")

    host: str = "0.0.0.0"
    port: int = 8090
    cors_origins: str = "*"

    platform_commission_pct: float = Field(0.12, ge=0.0, le=0.5)
    booking_units_per_slot: float = Field(24.0, ge=0.0)

    """Sync interval model (hours): step refreshes for staleness multipliers."""
    sync_interval_hours: int = Field(3, ge=1, le=168)

    upstream_lodging_base_url: str | None = None
    upstream_car_base_url: str | None = None
    upstream_commission_base_url: str | None = None

    redis_url: str | None = None
    cache_ttl_seconds: int = Field(600, ge=0, description="Doc: 5–15 minutes typical; 600s default")

    request_timeout_seconds: float = 8.0
    max_upstream_retries: int = Field(2, ge=0, le=5)

    rate_limit_per_minute: int = Field(120, ge=0)
    metrics_enabled: bool = True
    log_level: str = "INFO"
    service_version: str = "1.1.0"


@lru_cache
def get_settings() -> Settings:
    return Settings()
