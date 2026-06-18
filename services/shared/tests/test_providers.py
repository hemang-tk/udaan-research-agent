"""Unit tests for GeminiLLMProvider, GroqLLMProvider, AnthropicLLMProvider,
and CohereEmbeddingProvider.

All HTTP is mocked via pytest-httpx — no live API keys required in CI.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers — build a minimal Config-like object for each provider
# ---------------------------------------------------------------------------


def _cfg(**api_keys) -> MagicMock:
    cfg = MagicMock()
    cfg.llm_model = "test-model"
    cfg.embedding_model = "embed-english-v3.0"
    cfg.api_keys = {
        "gemini": None,
        "groq": None,
        "anthropic": None,
        "cohere": None,
        **api_keys,
    }
    return cfg


# ---------------------------------------------------------------------------
# GeminiLLMProvider
# ---------------------------------------------------------------------------


class TestGeminiLLMProvider:
    def _provider(self):
        from udaan_shared.impl import GeminiLLMProvider

        return GeminiLLMProvider(_cfg(gemini="test-key"))

    def test_raises_if_api_key_missing(self):
        from udaan_shared.impl import GeminiLLMProvider

        with pytest.raises(ValueError, match="GEMINI_API_KEY"):
            GeminiLLMProvider(_cfg())

    def test_returns_text_from_candidates(self, httpx_mock):
        httpx_mock.add_response(
            json={
                "candidates": [{"content": {"parts": [{"text": "pong"}]}}]
            }
        )
        result = self._provider().complete([{"role": "user", "content": "ping"}])
        assert result == "pong"

    def test_sends_temperature_zero_by_default(self, httpx_mock):
        httpx_mock.add_response(
            json={"candidates": [{"content": {"parts": [{"text": ""}]}}]}
        )
        self._provider().complete([{"role": "user", "content": "hi"}])
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert body["generationConfig"]["temperature"] == 0

    def test_sets_json_mime_type_when_json_schema_provided(self, httpx_mock):
        httpx_mock.add_response(
            json={"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}
        )
        schema = {"type": "object"}
        self._provider().complete(
            [{"role": "user", "content": "hi"}], json_schema=schema
        )
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert body["generationConfig"]["responseMimeType"] == "application/json"
        assert body["generationConfig"]["responseSchema"] == schema

    def test_sends_system_instruction(self, httpx_mock):
        httpx_mock.add_response(
            json={"candidates": [{"content": {"parts": [{"text": ""}]}}]}
        )
        self._provider().complete(
            [{"role": "user", "content": "hi"}], system="Be concise"
        )
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert body["systemInstruction"]["parts"][0]["text"] == "Be concise"


# ---------------------------------------------------------------------------
# GroqLLMProvider
# ---------------------------------------------------------------------------


class TestGroqLLMProvider:
    def _provider(self):
        from udaan_shared.impl import GroqLLMProvider

        return GroqLLMProvider(_cfg(groq="test-key"))

    def test_raises_if_api_key_missing(self):
        from udaan_shared.impl import GroqLLMProvider

        with pytest.raises(ValueError, match="GROQ_API_KEY"):
            GroqLLMProvider(_cfg())

    def test_returns_choices_content(self, httpx_mock):
        httpx_mock.add_response(
            json={"choices": [{"message": {"content": "pong"}}]}
        )
        result = self._provider().complete([{"role": "user", "content": "ping"}])
        assert result == "pong"

    def test_sends_temperature_zero(self, httpx_mock):
        httpx_mock.add_response(
            json={"choices": [{"message": {"content": ""}}]}
        )
        self._provider().complete([{"role": "user", "content": "hi"}])
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert body["temperature"] == 0

    def test_prepends_system_message(self, httpx_mock):
        httpx_mock.add_response(
            json={"choices": [{"message": {"content": ""}}]}
        )
        self._provider().complete(
            [{"role": "user", "content": "hi"}], system="You are helpful"
        )
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert body["messages"][0] == {"role": "system", "content": "You are helpful"}
        assert body["messages"][1] == {"role": "user", "content": "hi"}

    def test_sets_json_object_format_when_json_schema_provided(self, httpx_mock):
        httpx_mock.add_response(
            json={"choices": [{"message": {"content": "{}"}}]}
        )
        self._provider().complete(
            [{"role": "user", "content": "hi"}], json_schema={"type": "object"}
        )
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert body["response_format"] == {"type": "json_object"}


# ---------------------------------------------------------------------------
# AnthropicLLMProvider
# ---------------------------------------------------------------------------


class TestAnthropicLLMProvider:
    def _provider(self):
        from udaan_shared.impl import AnthropicLLMProvider

        return AnthropicLLMProvider(_cfg(anthropic="test-key"))

    def test_raises_if_api_key_missing(self):
        from udaan_shared.impl import AnthropicLLMProvider

        with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
            AnthropicLLMProvider(_cfg())

    def test_returns_text_from_content_blocks(self, httpx_mock):
        httpx_mock.add_response(
            json={"content": [{"type": "text", "text": "pong"}]}
        )
        result = self._provider().complete([{"role": "user", "content": "ping"}])
        assert result == "pong"

    def test_does_not_send_temperature_or_top_p(self, httpx_mock):
        """CRITICAL: Anthropic Opus 4.8/4.7 return 400 if temperature/top_p is sent."""
        httpx_mock.add_response(
            json={"content": [{"type": "text", "text": ""}]}
        )
        self._provider().complete([{"role": "user", "content": "hi"}])
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert "temperature" not in body, "temperature must NOT be sent to Anthropic"
        assert "top_p" not in body, "top_p must NOT be sent to Anthropic"

    def test_sends_adaptive_thinking(self, httpx_mock):
        httpx_mock.add_response(
            json={"content": [{"type": "text", "text": ""}]}
        )
        self._provider().complete([{"role": "user", "content": "hi"}])
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert body["thinking"] == {"type": "adaptive"}

    def test_system_sent_as_top_level_field_not_in_messages(self, httpx_mock):
        httpx_mock.add_response(
            json={"content": [{"type": "text", "text": ""}]}
        )
        self._provider().complete(
            [{"role": "user", "content": "hi"}], system="Be helpful"
        )
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert body.get("system") == "Be helpful"
        roles = [m["role"] for m in body["messages"]]
        assert "system" not in roles, "system must not appear as a message role"

    def test_json_mode_uses_tool_call_and_returns_json_string(self, httpx_mock):
        input_obj = {"answer": 42}
        httpx_mock.add_response(
            json={
                "content": [
                    {
                        "type": "tool_use",
                        "name": "__json_output__",
                        "input": input_obj,
                    }
                ]
            }
        )
        result = self._provider().complete(
            [{"role": "user", "content": "hi"}],
            json_schema={"type": "object"},
        )
        assert json.loads(result) == input_obj
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert body["tool_choice"] == {"type": "tool", "name": "__json_output__"}
        assert body["tools"][0]["name"] == "__json_output__"


# ---------------------------------------------------------------------------
# CohereEmbeddingProvider
# ---------------------------------------------------------------------------


class TestCohereEmbeddingProvider:
    def _provider(self):
        from udaan_shared.impl import CohereEmbeddingProvider

        return CohereEmbeddingProvider(_cfg(cohere="test-key"))

    def test_raises_if_api_key_missing(self):
        from udaan_shared.impl import CohereEmbeddingProvider

        with pytest.raises(ValueError, match="COHERE_API_KEY"):
            CohereEmbeddingProvider(_cfg())

    def test_returns_embeddings_list(self, httpx_mock):
        vecs = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
        httpx_mock.add_response(json={"embeddings": vecs})
        result = self._provider().embed(["hello", "world"])
        assert result == vecs

    def test_sends_correct_model_and_input_type(self, httpx_mock):
        httpx_mock.add_response(json={"embeddings": [[0.0]]})
        self._provider().embed(["test"])
        request = httpx_mock.get_requests()[0]
        body = json.loads(request.content)
        assert body["model"] == "embed-english-v3.0"
        assert body["input_type"] == "search_document"