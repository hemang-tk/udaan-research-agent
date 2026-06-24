import io
import json

import pytest
from fastapi.testclient import TestClient

# Minimal env so load_config() succeeds. The hosted build reranks via Cohere; the
# Cohere HTTP call is monkeypatched in the rerank test so no live key is needed.
REQUIRED_ENV = {
    "QDRANT_URL": "http://localhost:6333",
    "S3_ENDPOINT": "http://localhost:9000",
    "S3_BUCKET": "research-vault",
    "S3_ACCESS_KEY": "k",
    "S3_SECRET_KEY": "s",
    "LLM_MODEL": "claude-haiku-4-5",
    "EMBEDDING_MODEL": "embed-english-v3.0",
    "RERANK_MODEL": "rerank-v3.5",
    "COHERE_API_KEY": "test-key",
    "RANKING_SERVICE_URL": "http://localhost:8001",
    "PARSING_SERVICE_URL": "http://localhost:8002",
    "SYNTHESIS_SERVICE_URL": "http://localhost:8003",
}


@pytest.fixture
def client(monkeypatch):
    for key, value in REQUIRED_ENV.items():
        monkeypatch.setenv(key, value)
    import udaan_ranking.app as appmod

    appmod._reranker = None  # reset the lazy singleton between tests
    return TestClient(appmod.app)


def _candidate(internal_id: str, title: str, abstract: str) -> dict:
    return {
        "internalId": internal_id,
        "doi": None,
        "title": title,
        "abstract": abstract,
        "authors": ["Smith, J."],
        "publicationDate": "2023-01-01",
        "citationCount": 0,
        "sourceProviders": ["OpenAlex"],
        "sourceUrls": [],
    }


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    # /health now also reports per-stage implementation quality (issue #17).
    stages = {s["stage"]: s for s in body["stages"]}
    assert "rerank" in stages
    assert isinstance(stages["rerank"]["degraded"], bool)


def test_rerank_endpoint_returns_camelcase_manifest(client, monkeypatch):
    # Stub the Cohere rerank HTTP call: rank candidate index 1 ("a") first.
    body = json.dumps({
        "results": [
            {"index": 1, "relevance_score": 0.95},
            {"index": 0, "relevance_score": 0.05},
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

    payload = {
        "projectId": "proj_1",
        "originalQuery": "micro caching tail latency",
        "candidatePapers": [
            _candidate("b", "Cooking", "a long unrelated abstract about medieval cooking techniques today"),
            _candidate("a", "Micro-caching latency", "micro caching reduces p99 tail latency in distributed systems"),
        ],
    }
    res = client.post("/rerank", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["projectId"] == "proj_1"
    assert body["totalProcessed"] == 2
    assert body["rankedManifest"][0]["rank"] == 1
    assert body["rankedManifest"][0]["internalId"] == "a"
