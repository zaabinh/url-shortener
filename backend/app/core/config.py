from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings.

    Values come from environment variables. During local development they can
    also come from backend/.env. Real environment variables always win over
    the .env file, which is how Docker passes configuration in.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "URL Shortener"

    # Public origin used to build short links, e.g. http://localhost:8080/aB3dE9x
    base_url: str = "http://localhost:8000"

    # Comma-separated origins allowed to call the API cross-origin (local dev only)
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    short_code_length: int = 7

    # Phase 2+. No default on purpose: a missing value must fail loudly
    # instead of silently connecting to the wrong database.
    database_url: str = ""

    # Phase 8+. Empty string disables caching.
    redis_url: str = ""
    cache_ttl_seconds: int = 3600

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def short_url(self, short_code: str) -> str:
        return f"{self.base_url.rstrip('/')}/{short_code}"


settings = Settings()