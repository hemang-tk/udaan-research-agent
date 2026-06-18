"""Re-rankers behind the shared RerankProvider interface.

- CrossEncoderReranker: BAAI/bge-reranker-base via sentence-transformers (auto
  GPU). Loaded lazily; requires the optional `ml` extra.
- LexicalReranker: deterministic Jaccard fallback (Phase 3 §5.2) — no ML deps,
  so the pipeline always works.
- CohereReranker: hosted rerank-v3.5 (free tier), stdlib HTTP only.

The local factory tries the cross-encoder and falls back to lexical, flagging
the ranking method for downstream telemetry.
"""

from __future__ import annotations

import json
import re
import urllib.request

from udaan_shared import Config, register_rerank_provider

from .scoring import sigmoid

_TOKEN = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return set(_TOKEN.findall(text.lower()))


class LexicalReranker:
    method = "LEXICAL_FALLBACK"
    # Jaccard overlap, no semantics — a run using it is DEGRADED (issue #17).
    degraded = True
    implementation = "lexical"

    def rerank(self, query: str, documents: list[str]) -> list[tuple[int, float]]:
        q = _tokens(query)
        results: list[tuple[int, float]] = []
        for i, doc in enumerate(documents):
            d = _tokens(doc)
            union = len(q | d) or 1
            results.append((i, len(q & d) / union))
        return results


class CrossEncoderReranker:
    method = "CROSS_ENCODER"
    degraded = False
    implementation = "cross-encoder"

    def __init__(self, model_name: str) -> None:
        from sentence_transformers import CrossEncoder  # lazy: requires `ml` extra

        self._model = CrossEncoder(model_name)

    def rerank(self, query: str, documents: list[str]) -> list[tuple[int, float]]:
        if not documents:
            return []
        scores = self._model.predict([(query, doc) for doc in documents])
        return [(i, sigmoid(float(s))) for i, s in enumerate(scores)]


class CohereReranker:
    method = "CROSS_ENCODER"
    degraded = False
    implementation = "cohere"

    def __init__(self, config: Config) -> None:
        self._key = config.api_keys.get("cohere")
        self._model = "rerank-v3.5"

    def rerank(self, query: str, documents: list[str]) -> list[tuple[int, float]]:
        if not documents:
            return []
        if not self._key:
            raise RuntimeError("COHERE_API_KEY not set")
        payload = json.dumps({
            "model": self._model,
            "query": query,
            "documents": documents,
            "top_n": len(documents),
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.cohere.com/v2/rerank",
            data=payload,
            headers={"authorization": f"Bearer {self._key}", "content-type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
            data = json.loads(resp.read().decode("utf-8"))
        return [(item["index"], float(item["relevance_score"])) for item in data.get("results", [])]


def _make_local(config: Config):
    try:
        return CrossEncoderReranker(config.rerank_model)
    except Exception:
        return LexicalReranker()


def register() -> None:
    register_rerank_provider("local", _make_local)
    register_rerank_provider("cohere", lambda config: CohereReranker(config))
