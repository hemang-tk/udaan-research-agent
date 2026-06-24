"""Concrete default providers for the Python services.

- GeminiLLMProvider: Google AI Studio generateContent.
- GroqLLMProvider: OpenAI-compatible /chat/completions.
- AnthropicLLMProvider: Anthropic Messages API.
  CRITICAL: DO NOT send temperature or top_p — they 400 on Opus 4.8/4.7.
- CohereEmbeddingProvider: Cohere embed-v3.

All classes are defined before register_defaults() so lambdas can capture them.
"""
from __future__ import annotations

import os
import time

import httpx

from .config import Config
from .providers import register_embedding_provider, register_llm_provider

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
            f"{self._model}:generateContent"
        )
        # Retry on 429 (free-tier RPM) / 5xx with backoff, honouring Retry-After —
        # Gemini free tiers rate-limit the per-chunk extraction, so a bare POST
        # fails every ingest (0 claims). Key goes in a header, not the query string,
        # so it never leaks into request logs / error URLs.
        resp = _post_with_retry(
            url, json=body, headers={"x-goog-api-key": self._api_key}, timeout=60.0
        )
        data = resp.json()
        return (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )


class MultiLLMProvider:
    """Round-robin across several LLM providers, failing over on error. Independent
    free tiers (e.g. Gemini + Groq) share the per-chunk extraction load, so a run
    only stalls if EVERY provider is rate-limited at once. Each provider keeps its
    own internal retry; this adds the cross-provider failover."""

    def __init__(
        self, providers: list, names: list[str] | None = None, *, round_robin: bool = True
    ) -> None:
        if not providers:
            raise ValueError("MultiLLMProvider needs at least one provider")
        self._providers = providers
        self._names = names or [type(p).__name__ for p in providers]
        self._next = 0
        # round_robin=True spreads load across free tiers (the token-heavy run).
        # round_robin=False is strict priority: always try providers[0] first and
        # only fail over on error — used for chat, where we want the free provider
        # (Groq) first and the paid one (Anthropic) purely as a backstop.
        self._round_robin = round_robin

    def complete(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        json_schema: dict | None = None,
        max_tokens: int | None = None,
    ) -> str:
        n = len(self._providers)
        start = self._next
        if self._round_robin:
            self._next = (self._next + 1) % n  # round-robin the starting provider
        last_error: Exception | None = None
        for i in range(n):
            idx = (start + i) % n
            try:
                return self._providers[idx].complete(
                    messages, system=system, json_schema=json_schema, max_tokens=max_tokens
                )
            except Exception as err:  # noqa: BLE001 — failover to the next provider
                last_error = err
        raise RuntimeError(f"All LLM providers failed ({', '.join(self._names)}): {last_error}")


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
            # ⚠️  NO temperature, NO top_p (400 on Opus 4.x)
        }
        # Adaptive thinking only where it's valid: Haiku 4.5 doesn't support it (400),
        # and it cannot be combined with a forced tool_choice (400) — the json_schema
        # path below forces a tool, so thinking is skipped there too.
        if json_schema is None and "haiku" not in self._model.lower():
            payload["thinking"] = {"type": "adaptive"}
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

        resp = _post_with_retry(
            self._API_URL,
            json=payload,
            headers={
                "x-api-key": self._api_key,
                "anthropic-version": "2023-06-01",
            },
            timeout=120.0,
        )
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

    def embed(self, texts: list[str], input_type: str = "search_document") -> list[list[float]]:
        # Stored documents (chunks/claims) use "search_document"; a retrieval query
        # uses "search_query" — Cohere v3 embeds the two asymmetrically for better
        # query/document matching.
        resp = httpx.post(
            "https://api.cohere.ai/v1/embed",
            json={"texts": texts, "model": self._model, "input_type": input_type},
            headers={"Authorization": f"Bearer {self._api_key}"},
            timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()["embeddings"]


def register_defaults() -> None:
    register_llm_provider("gemini", lambda config: GeminiLLMProvider(config))
    register_llm_provider("groq", lambda config: GroqLLMProvider(config))
    register_llm_provider("anthropic", lambda config: AnthropicLLMProvider(config))
    register_embedding_provider("cohere", lambda config: CohereEmbeddingProvider(config))