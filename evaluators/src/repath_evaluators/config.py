"""Configuration loaded from environment variables.

All settings have sensible defaults except database/redis URLs and API keys,
which must be provided explicitly. Pydantic-settings validates types at startup
so misconfiguration surfaces immediately rather than at runtime.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the evaluation worker.

    Environment variable names are uppercased field names prefixed with REPATH_.
    Example: REPATH_DATABASE_URL, REPATH_REDIS_URL, REPATH_OPENAI_API_KEY
    """

    model_config = SettingsConfigDict(
        env_prefix="REPATH_",
        env_file=".env",
        env_file_encoding="utf-8",
        # Don't crash if .env doesn't exist — environment vars take precedence
        env_ignore_empty=True,
        extra="ignore",
    )

    # ── Infrastructure ────────────────────────────────────────────────────
    database_url: str = Field(
        description="PostgreSQL connection string",
        examples=["postgres://repath:password@localhost:5432/repath"],
    )
    redis_url: str = Field(
        default="redis://localhost:6379",
        description="Redis connection string",
    )

    # ── Redis Stream settings ─────────────────────────────────────────────
    eval_stream_name: str = Field(
        default="repath:evaluations",
        description="Redis Stream key to consume from",
    )
    consumer_group: str = Field(
        default="repath-evaluators",
        description="Redis Consumer Group name",
    )
    consumer_name: str = Field(
        default="worker-1",
        description="Unique name for this worker instance within the group",
    )
    # How long a message can be pending before another worker reclaims it (ms)
    pending_timeout_ms: int = Field(
        default=60_000,
        description="Milliseconds before a pending message is reclaimed",
    )
    # Max messages to fetch per XREADGROUP call
    batch_size: int = Field(
        default=10,
        description="Messages to fetch per batch",
    )

    # ── LLM Judge settings ────────────────────────────────────────────────
    openai_api_key: str = Field(
        default="",
        description="OpenAI API key for LLM-as-judge evaluation",
    )
    llm_judge_model: str = Field(
        default="gpt-4o-mini",
        description="Model to use as judge (should be fast + cheap)",
    )
    # Fraction of canary responses to evaluate with LLM judge (0.0 – 1.0)
    # Full programmatic evaluation runs on every response regardless.
    llm_judge_sample_rate: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Fraction of responses to evaluate with LLM judge",
    )
    # Max seconds to wait for a judge response before giving up
    llm_judge_timeout_secs: int = Field(
        default=30,
        description="Timeout for each LLM judge API call",
    )

    # ── Programmatic evaluator settings ───────────────────────────────────
    min_response_length: int = Field(
        default=10,
        description="Minimum character length for a non-empty response",
    )
    max_latency_ms: int = Field(
        default=30_000,
        description="Latency above this marks as slow (contributes to score)",
    )

    # ── Observability ─────────────────────────────────────────────────────
    log_level: str = Field(
        default="INFO",
        description="Logging level (DEBUG, INFO, WARNING, ERROR)",
    )
    log_format: str = Field(
        default="json",
        description="Log format: 'json' for production, 'console' for development",
    )


# Module-level singleton — loaded once at import time.
# Workers import this directly: `from repath_evaluators.config import settings`
settings = Settings()
