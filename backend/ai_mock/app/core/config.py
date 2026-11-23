from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AI Mock Interview Platform API"
    app_env: str = "development"
    debug: bool = Field(False, validation_alias="APP_DEBUG")
    database_url: str
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout: int = 30
    db_pool_recycle: int = 1800
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    evaluation_provider: str = "mock"
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    groq_timeout_seconds: float = 30.0
    groq_max_retries: int = 2
    question_generation_provider: str = "predefined"
    question_generation_max_questions: int = 10
    resume_storage_dir: str = "storage/resumes"
    resume_max_size_bytes: int = 5242880
    company_search_provider: str = "tavily"
    tavily_api_key: str | None = None
    tavily_search_depth: str = "advanced"
    tavily_max_results: int = 8
    company_research_max_search_calls: int = 3
    company_research_max_pages: int = 5
    company_research_max_content_bytes: int = 200000
    company_research_max_search_content_bytes: int = 100000
    company_research_timeout_seconds: float = 8.0
    company_research_max_retries: int = 1
    company_research_user_agent: str = "AI-Mock-Interview-Platform/1.0"
    company_research_cache_ttl_hours: int = 24

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
