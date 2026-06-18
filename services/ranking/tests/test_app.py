import pytest
from fastapi.testclient import TestClient

# Minimal env so load_config() succeeds; RERANK_MODEL points at the cross-encoder
# but sentence-transformers is absent in CI, so the local factory falls back to
# the lexical reranker.
REQUIRED_ENV = {
    "QDRANT_URL": "http://localhost:6333",
    "REDIS_URL": "redis://localhost:6379",
    "S3_ENDPOINT": "http://localhost:9000",
    "S3_BUCKET": "research-vault",
    "S3_ACCESS_KEY": "k",
    "S3_SECRET_KEY": "s",
    "LLM_MODEL": "qwen2.5:7b-instruct-q4_K_M",
    "EMBEDDING_MODEL": "BAAI/bge-base-en-v1.5",
    "RERANK_MODEL": "BAAI/bge-reranker-base",
    "OLLAMA_URL": "http://localhost:11434",
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


def test_rerank_endpoint_returns_camelcase_manifest(client):
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
