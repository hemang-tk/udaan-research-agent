"""Concrete default providers for the Python services.

- OllamaLLMProvider: local LLM over HTTP (Qwen2.5 by config). Temperature 0
  (Anthropic must NOT do this — adaptive thinking instead).
- HashingEmbeddingProvider: deterministic, dependency-free embedding so the
  pipeline runs without sentence-transformers. A real embedding provider
  (sentence-transformers) overrides "local" in the parsing service when the
  `ml` extra is installed.
"""

from __future__ import annotations

import hashlib
import math

import httpx

from .config import Config
from .providers import register_embedding_provider, register_llm_provider


class OllamaLLMProvider:
    def __init__(self, ollama_url: str, model: str) -> None:
        self._url = ollama_url
        self._model = model

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        json_schema: dict | None = None,
        max_tokens: int | None = None,
    ) -> str:
        full = ([{"role": "system", "content": system}] if system else []) + messages
        body: dict = {"model": self._model, "messages": full, "stream": False, "options": {"temperature": 0}}
        if json_schema is not None:
            body["format"] = "json"
        resp = httpx.post(f"{self._url}/api/chat", json=body, timeout=120.0)
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "")


class HashingEmbeddingProvider:
    """Hashing-trick embedding (deterministic, offline fallback). Produces
    semantically meaningless vectors, so a run using it is DEGRADED (issue #17)."""

    # Quality markers read by the service /health probes.
    degraded = True
    implementation = "hashing"

    def __init__(self, dim: int = 384) -> None:
        self.dim = dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def _vec(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for token in text.lower().split():
            h = int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16)
            vec[h % self.dim] += 1.0 if (h >> 8) & 1 else -1.0
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]


def register_defaults() -> None:
    """Register the dependency-light defaults. Heavier providers (e.g.
    sentence-transformers) re-register their name in the service that needs them."""
    register_llm_provider("ollama", lambda config: OllamaLLMProvider(config.ollama_url, config.llm_model))
    register_embedding_provider("local", lambda config: HashingEmbeddingProvider())
