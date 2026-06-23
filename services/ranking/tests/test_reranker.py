"""Hosted Cohere reranker. The HTTP call is monkeypatched so no live key/network
is needed."""

import io
import json
from unittest.mock import MagicMock

from udaan_ranking.reranker import CohereReranker


def _cfg(cohere_key="test-key"):
    cfg = MagicMock()
    cfg.api_keys = {"cohere": cohere_key}
    return cfg


def test_cohere_rerank_returns_index_score_pairs(monkeypatch):
    body = json.dumps({
        "results": [
            {"index": 0, "relevance_score": 0.9},
            {"index": 1, "relevance_score": 0.1},
        ]
    }).encode("utf-8")

    class FakeResp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(
        "udaan_ranking.reranker.urllib.request.urlopen",
        lambda *a, **k: FakeResp(body),
    )

    r = CohereReranker(_cfg())
    scores = dict(r.rerank("micro caching tail latency", ["relevant doc", "irrelevant doc"]))
    assert scores[0] > scores[1]
    assert r.method == "CROSS_ENCODER"


def test_cohere_rerank_handles_empty_documents():
    assert CohereReranker(_cfg()).rerank("q", []) == []
