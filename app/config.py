"""Application settings loaded from environment / .env file."""

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Thresh application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Reddit API credentials
    REDDIT_CLIENT_ID: Optional[str] = None
    REDDIT_CLIENT_SECRET: Optional[str] = None
    REDDIT_USER_AGENT: Optional[str] = None

    # App settings
    THRESH_DB_PATH: str = "thresh.db"
    THRESH_EXPORT_DIR: str = "exports"
    THRESH_DEBUG: bool = False
    THRESH_VERSION: str = "0.1.0"


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()
