"""Re-ranker behind the shared RerankProvider interface.

- CohereReranker: hosted rerank-v3.5 (free tier), stdlib HTTP only.

Hosted-only build: Cohere is the single rerank provider.
"""

from __future__ import annotations

import json
import urllib.request

from udaan_shared import Config, register_rerank_provider


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


def register() -> None:
    register_rerank_provider("cohere", lambda config: CohereReranker(config))
