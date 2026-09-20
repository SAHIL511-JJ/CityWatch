from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "incident-reporter-api"
    ENV: str = "dev"
    # Disabled by default. The API-only KAN-38 demo fixture writes marked
    # records to the one shared Supabase database only when this is enabled.
    ENABLE_DEMO_FIXTURES: bool = False

    # Supabase (DB + Storage only; no Auth/Functions/Realtime/RLS)
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_DB_URL_POOLER: str = ""  # port 6543, transaction mode (runtime)
    SUPABASE_DB_URL_DIRECT: str = ""  # port 5432 (alembic migrations)
    STORAGE_BUCKET: str = "incident-photos"

    # Auth
    JWT_SECRET: str = "dev-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MIN: int = 60 * 24 * 30  # 30 days (mobile sessions are long-lived)

    # Queue / worker
    REDIS_URL: str = "redis://localhost:6379/0"

    # Push + AI (stubs until keys provided)
    FCM_CRED_JSON: str = ""  # path to firebase service-account json, or "" = stub
    AI_API_KEY: str = ""  # legacy alias; prefer GEMINI_API_KEY below
    GEMINI_API_KEY: str = (
        ""  # from https://aistudio.google.com (Get API key), "" = fake-AI stub
    )
    GEMINI_MODEL: str = "gemini-3.6-flash"  # vision model, free tier

    # Upload guardrails
    MAX_PHOTO_MB: int = 8

    # CORS for browser callers (CRM on :3000). Comma-separated extra origins.
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def DATABASE_URL(self) -> str:
        # CityWatch always runs against Supabase Postgres. Missing
        # configuration must fail at startup instead of creating a divergent
        # local database.
        if not self.SUPABASE_DB_URL_POOLER:
            raise RuntimeError("SUPABASE_DB_URL_POOLER is required; SQLite is not supported")
        if not self.SUPABASE_DB_URL_POOLER.startswith(("postgresql://", "postgresql+psycopg2://")):
            raise RuntimeError("SUPABASE_DB_URL_POOLER must be a PostgreSQL connection URL")
        return self.SUPABASE_DB_URL_POOLER


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
