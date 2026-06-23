import json

from udaan_parsing.chunking import Chunk
from udaan_parsing.ingest import ingest_document
from udaan_parsing.store import InMemoryClaimStore


class FakeEmbedding:
    """Deterministic, dependency-free 384-dim embedding for tests (no network)."""

    def embed(self, texts: list[str], input_type: str = "search_document") -> list[list[float]]:
        return [[float(len(t) % 7)] * 384 for t in texts]


class StubLLM:
    def __init__(self, response: str) -> None:
        self.response = response

    def complete(self, messages, *, system=None, json_schema=None, max_tokens=None) -> str:
        return self.response


def fake_parse(_data: bytes) -> list[Chunk]:
    return [Chunk(text="Ephemeral caching reduced latency by 30% under load.", section="Results", page_number=3)]


def test_ingest_attaches_embeddings_and_stores_claims():
    store = InMemoryClaimStore()
    response = json.dumps({
        "claims": [
            {"claimText": "caching cut latency ~30%", "sourceQuote": "reduced latency by 30%", "claimClassification": "FINDING"}
        ]
    })

    claims = ingest_document(
        b"%PDF-fake",
        "10.1/x",
        "proj_1",
        parse=fake_parse,
        llm=StubLLM(response),
        embed=FakeEmbedding(),
        store=store,
    )

    assert len(claims) == 1
    assert claims[0].vector_embedding is not None
    assert len(claims[0].vector_embedding) == 384
    assert len(store.claims) == 1
    assert store.claims[0].claim_id.startswith("cl_")
