"""Concrete default providers for the Python services.

- OllamaLLMProvider: local LLM over HTTP (Qwen2.5 by config). Temperature 0.
- HashingEmbeddingProvider: deterministic, dependency-free fallback.
- GeminiLLMProvider: Google AI Studio generateContent.
- GroqLLMProvider: OpenAI-compatible /chat/completions.
- AnthropicLLMProvider: Anthropic Messages API.
  CRITICAL: DO NOT send temperature or top_p — they 400 on Opus 4.8/4.7.
- CohereEmbeddingProvider: Cohere embed-v3.

All classes are defined before register_defaults() so lambdas can capture them.
"""
from __future__ import annotations

import hashlib
import math
import os
import time

import httpx

from .config import Config
from .providers import register_embedding_provider, register_llm_provider

# Bound the chat call so a hung model can't stall the pipeline indefinitely, and
# retry once on a transient transport error. Override via OLLAMA_TIMEOUT_S.
_DEFAULT_OLLAMA_TIMEOUT_S = 120.0
_OLLAMA_RETRIES = 1


def _ollama_timeout() -> float:
    raw = os.environ.get("OLLAMA_TIMEOUT_S")
    if raw:
        try:
            value = float(raw)
            if value > 0:
                return value
        except ValueError:
            pass
    return _DEFAULT_OLLAMA_TIMEOUT_S


_LLM_MAX_RETRIES = int(os.environ.get("LLM_MAX_RETRIES", "6"))


def _post_with_retry(
    url: str, *, json: dict, headers: dict | None = None, timeout: float = 60.0
) -> httpx.Response:
    """POST with bounded exponential backoff on 429 (rate limit) and 5xx/transient
    errors, honoring a numeric Retry-After. Free LLM tiers (e.g. Groq) rate-limit the
    per-chunk extraction calls, so without this the pipeline 500s under load."""
    delay = 1.0
    for attempt in range(_LLM_MAX_RETRIES + 1):
        try:
            resp = httpx.post(url, json=json, headers=headers, timeout=timeout)
        except (httpx.TimeoutException, httpx.TransportError):
            if attempt == _LLM_MAX_RETRIES:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 30.0)
            continue
        if resp.status_code == 429 or resp.status_code >= 500:
            if attempt == _LLM_MAX_RETRIES:
                resp.raise_for_status()
            ra = resp.headers.get("retry-after")
            wait = float(ra) if ra and ra.replace(".", "", 1).isdigit() else delay
            time.sleep(min(wait, 60.0))
            delay = min(delay * 2, 30.0)
            continue
        resp.raise_for_status()
        return resp
    raise RuntimeError("unreachable")  # pragma: no cover


class OllamaLLMProvider:
    def __init__(self, ollama_url: str, model: str, timeout_s: float | None = None) -> None:
        self._url = ollama_url
        self._model = model
        self._timeout_s = timeout_s if timeout_s is not None else _ollama_timeout()

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        json_schema: dict | None = None,
        max_tokens: int | None = None,
    ) -> str:
        full = ([{"role": "system", "content": system}] if system else []) + messages
        body: dict = {
            "model": self._model,
            "messages": full,
            "stream": False,
            "options": {"temperature": 0},
        }
        if json_schema is not None:
            body["format"] = "json"

        last_error: Exception | None = None
        for attempt in range(_OLLAMA_RETRIES + 1):
            try:
                resp = httpx.post(f"{self._url}/api/chat", json=body, timeout=self._timeout_s)
                resp.raise_for_status()
                return resp.json().get("message", {}).get("content", "")
            except (httpx.TransportError, httpx.HTTPStatusError) as err:
                # Timeouts/connection resets and 5xx are transient; retry once.
                status = getattr(getattr(err, "response", None), "status_code", None)
                if isinstance(err, httpx.HTTPStatusError) and status is not None and status < 500:
                    raise
                last_error = err
                if attempt == _OLLAMA_RETRIES:
                    break
        assert last_error is not None
        raise last_error


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


class GeminiLLMProvider:
    """Google AI Studio generateContent. JSON mode via responseMimeType."""

    def __init__(self, config: Config) -> None:
        self._api_key = config.api_keys.get("gemini")
        if not self._api_key:
            raise ValueError(
                "GEMINI_API_KEY is not set. It is required when LLM_PROVIDER=gemini."
            )
        self._model = config.llm_model

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        json_schema: dict | None = None,
        max_tokens: int | None = None,
    ) -> str:
        # Gemini uses "user"/"model" roles.
        contents = [
            {
                "role": "model" if m["role"] == "assistant" else "user",
                "parts": [{"text": m["content"]}],
            }
            for m in messages
            if m["role"] != "system"
        ]

        generation_config: dict = {"temperature": 0}
        if max_tokens is not None:
            generation_config["maxOutputTokens"] = max_tokens
        if json_schema is not None:
            generation_config["responseMimeType"] = "application/json"
            generation_config["responseSchema"] = json_schema

        body: dict = {"contents": contents, "generationConfig": generation_config}
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self._model}:generateContent?key={self._api_key}"
        )
        resp = httpx.post(url, json=body, timeout=60.0)
        resp.raise_for_status()
        data = resp.json()
        return (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )


class GroqLLMProvider:
    """Groq OpenAI-compatible /chat/completions. JSON mode via response_format."""

    _BASE_URL = "https://api.groq.com/openai/v1"

    def __init__(self, config: Config) -> None:
        self._api_key = config.api_keys.get("groq")
        if not self._api_key:
            raise ValueError(
                "GROQ_API_KEY is not set. It is required when LLM_PROVIDER=groq."
            )
        self._model = config.llm_model

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        json_schema: dict | None = None,
        max_tokens: int | None = None,
    ) -> str:
        full = ([{"role": "system", "content": system}] if system else []) + messages
        body: dict = {
            "model": self._model,
            "messages": full,
            "temperature": 0,
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if json_schema is not None:
            body["response_format"] = {"type": "json_object"}

        resp = _post_with_retry(
            f"{self._BASE_URL}/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {self._api_key}"},
            timeout=60.0,
        )
        return resp.json()["choices"][0]["message"]["content"]


class AnthropicLLMProvider:
    """Anthropic Messages API.

    ⚠️  CRITICAL: DO NOT send temperature or top_p.
    They cause a 400 on claude-opus-4-8 / claude-opus-4-7.
    Use thinking: {type: adaptive} instead.
    """

    _API_URL = "https://api.anthropic.com/v1/messages"

    def __init__(self, config: Config) -> None:
        self._api_key = config.api_keys.get("anthropic")
        if not self._api_key:
            raise ValueError(
                "ANTHROPIC_API_KEY is not set. It is required when LLM_PROVIDER=anthropic."
            )
        self._model = config.llm_model

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        json_schema: dict | None = None,
        max_tokens: int | None = None,
    ) -> str:
        # Anthropic does not allow "system" in the messages array; it's a top-level field.
        anthropic_messages = [m for m in messages if m.get("role") != "system"]

        payload: dict = {
            "model": self._model,
            "messages": anthropic_messages,
            "max_tokens": max_tokens or 4096,
            "thinking": {"type": "adaptive"},
            # ⚠️  NO temperature, NO top_p
        }
        if system:
            payload["system"] = system

        # JSON mode: force a tool call so the model returns structured output.
        if json_schema is not None:
            payload["tools"] = [
                {
                    "name": "__json_output__",
                    "description": "Return the response as a JSON object.",
                    "input_schema": json_schema,
                }
            ]
            payload["tool_choice"] = {"type": "tool", "name": "__json_output__"}

        resp = httpx.post(
            self._API_URL,
            json=payload,
            headers={
                "x-api-key": self._api_key,
                "anthropic-version": "2023-06-01",
            },
            timeout=120.0,
        )
        resp.raise_for_status()
        content = resp.json().get("content", [])

        if json_schema is not None:
            for block in content:
                if block.get("type") == "tool_use":
                    import json
                    return json.dumps(block.get("input", {}))

        # Return joined text blocks.
        return "".join(
            block.get("text", "") for block in content if block.get("type") == "text"
        )


class CohereEmbeddingProvider:
    """Cohere embed-v3 embedding provider."""

    def __init__(self, config: Config) -> None:
        self._api_key = config.api_keys.get("cohere")
        if not self._api_key:
            raise ValueError(
                "COHERE_API_KEY is not set. It is required when EMBEDDING_PROVIDER=cohere."
            )
        self._model = "embed-english-v3.0"

    def embed(self, texts: list[str]) -> list[list[float]]:
        resp = httpx.post(
            "https://api.cohere.ai/v1/embed",
            json={"texts": texts, "model": self._model, "input_type": "search_document"},
            headers={"Authorization": f"Bearer {self._api_key}"},
            timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()["embeddings"]


def register_defaults() -> None:
    register_llm_provider(
        "ollama",
        lambda config: OllamaLLMProvider(config.ollama_url, config.llm_model),
    )
    register_embedding_provider(
        "local",
        lambda config: HashingEmbeddingProvider(),
    )
    register_llm_provider("gemini", lambda config: GeminiLLMProvider(config))
    register_llm_provider("groq", lambda config: GroqLLMProvider(config))
    register_llm_provider("anthropic", lambda config: AnthropicLLMProvider(config))
    register_embedding_provider("cohere", lambda config: CohereEmbeddingProvider(config))