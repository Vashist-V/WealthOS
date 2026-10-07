from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    demo_enabled: bool = True
    data_dir: str = str(BACKEND_DIR / ".data")
    cache_dir: str = str(BACKEND_DIR / ".cache")
    # Deployment. Point web_dir at the built frontend (frontend/dist) and this one
    # service answers for the app as well as the API. Blank in development, where
    # the frontend runs on its own server.
    web_dir: str = ""
    # The address people reach the deployed app at, e.g. https://wealthos.example.com.
    # Link previews need it to find the share picture.
    public_url: str = ""
    risk_free_rate: float = 0.065
    benchmark: str = "^NSEI"
    # Stock assistant. With no key at all it answers from the app's own data only.
    # "auto" uses Gemini when its key is set, otherwise Claude.
    assistant_provider: str = "auto"
    assistant_web_search: bool = True
    # One key, or several separated by commas: each is tried in turn. Keys made in
    # the same Google project share one allowance, so extra ones only help when
    # they come from different projects.
    gemini_api_key: str = ""
    # 2.5 Flash is the model whose free tier includes Google Search grounding.
    assistant_gemini_model: str = "gemini-2.5-flash"
    # The free plan gives each model its own small daily allowance (20 requests a
    # day for 2.5 Flash in October 2026), so the models to step down through when
    # one is used up or busy, in order. The "-latest" names follow Google's newest.
    assistant_gemini_fallback: str = "gemini-flash-latest,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.1-flash-lite"
    anthropic_api_key: str = ""
    assistant_model: str = "claude-opus-5-5"
    assistant_effort: str = "medium"
    # A second free service, tried when Gemini's quota is used up (or on its own).
    # Anything that speaks the OpenAI chat API works: Groq by default, or Cerebras,
    # OpenRouter, Mistral and others by changing the address and model.
    llm_api_key: str = Field(default="", validation_alias=AliasChoices("llm_api_key", "groq_api_key"))
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_model: str = "openai/gpt-oss-120b"

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
