"""12-factor config loader (Python mirror of packages/shared/src/config.ts).

Every endpoint/credential/model comes from the environment — no hardcoded
``localhost`` in code, so deploy is a config change.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def _optional(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value else default


@dataclass(frozen=True)
class S3Config:
    endpoint: str
    bucket: str
    access_key: str
    secret_key: str
    region: str


@dataclass(frozen=True)
class Config:
    qdrant_url: str
    qdrant_api_key: str | None
    redis_url: str
    s3: S3Config
    llm_provider: str
    embedding_provider: str
    rerank_provider: str
    ollama_url: str
    llm_model: str
    embedding_model: str
    rerank_model: str
    api_keys: dict[str, str | None]
    services: dict[str, str]


def load_config() -> Config:
    return Config(
        qdrant_url=_required("QDRANT_URL"),
        # Qdrant Cloud requires an API key; a local/docker Qdrant does not (None).
        qdrant_api_key=_optional("QDRANT_API_KEY"),
        redis_url=_required("REDIS_URL"),
        s3=S3Config(
            endpoint=_required("S3_ENDPOINT"),
            bucket=_required("S3_BUCKET"),
            access_key=_required("S3_ACCESS_KEY"),
            secret_key=_required("S3_SECRET_KEY"),
            region=_optional("S3_REGION", "us-east-1") or "us-east-1",
        ),
        llm_provider=_optional("LLM_PROVIDER", "ollama") or "ollama",
        embedding_provider=_optional("EMBEDDING_PROVIDER", "local") or "local",
        rerank_provider=_optional("RERANK_PROVIDER", "local") or "local",
        ollama_url=_required("OLLAMA_URL"),
        llm_model=_required("LLM_MODEL"),
        embedding_model=_required("EMBEDDING_MODEL"),
        rerank_model=_required("RERANK_MODEL"),
        api_keys={
            "gemini": _optional("GEMINI_API_KEY"),
            "groq": _optional("GROQ_API_KEY"),
            "anthropic": _optional("ANTHROPIC_API_KEY"),
            "cohere": _optional("COHERE_API_KEY"),
        },
        services={
            "ranking": _required("RANKING_SERVICE_URL"),
            "parsing": _required("PARSING_SERVICE_URL"),
            "synthesis": _required("SYNTHESIS_SERVICE_URL"),
        },
    )
