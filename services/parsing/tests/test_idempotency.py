"""Phase 5 idempotency: re-ingesting the same document must not duplicate
claims (issue #25). Covers deterministic claim IDs and the in-memory store's
delete-before-insert behaviour without needing ML or a live Qdrant."""

import json

from udaan_parsing.chunking import Chunk
from udaan_parsing.extract import deterministic_claim_id, extract_claims
from udaan_parsing.ingest import ingest_document
from udaan_parsing.store import InMemoryClaimStore

_PASSAGE = "Micro-caching reduced p99 latency by 40% in our experiments."

_LLM_RESPONSE = json.dumps(
    {
        "claims": [
            {
                "claimText": "Micro-caching cut p99 latency ~40%",
                "sourceQuote": "reduced p99 latency by 40%",
                "claimClassification": "FINDING",
            }
        ]
    }
)


class StubLLM:
    def complete(self, messages, *, system=None, json_schema=None, max_tokens=None) -> str:
        return _LLM_RESPONSE


class StubEmbed:
    """Deterministic length-aware vectors; enough to exercise the store."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[float(len(t)), 1.0, 0.0] for t in texts]


def _parse(_: bytes) -> list[Chunk]:
    return [Chunk(text=_PASSAGE, section="Results", page_number=6)]


def test_claim_id_is_deterministic_for_same_content():
    a = deterministic_claim_id("p", "10.1/x", "FINDING", "quote", "text")
    b = deterministic_claim_id("p", "10.1/x", "FINDING", "quote", "text")
    c = deterministic_claim_id("p", "10.1/x", "FINDING", "quote", "different text")
    assert a == b
    assert a != c
    assert a.startswith("cl_")


def test_extract_claims_are_stable_across_runs():
    chunk = Chunk(text=_PASSAGE, section="Results", page_number=6)
    first = extract_claims(chunk, "proj_1", "10.1/x", StubLLM())
    second = extract_claims(chunk, "proj_1", "10.1/x", StubLLM())
    assert [c.claim_id for c in first] == [c.claim_id for c in second]


def test_reingesting_same_document_does_not_duplicate_claims():
    store = InMemoryClaimStore()

    def run():
        return ingest_document(
            b"%PDF-fake",
            document_doi="10.1/x",
            project_id="proj_1",
            parse=_parse,
            llm=StubLLM(),
            embed=StubEmbed(),
            store=store,
        )

    first = run()
    second = run()

    assert len(first) == 1
    assert len(second) == 1
    # The store holds exactly one claim after two ingests, not two.
    assert len(store.claims) == 1
    assert {c.claim_id for c in store.claims} == {first[0].claim_id}
    assert first[0].claim_id == second[0].claim_id


def test_other_documents_are_untouched_on_reingest():
    store = InMemoryClaimStore()

    ingest_document(
        b"%PDF-a",
        document_doi="10.1/a",
        project_id="proj_1",
        parse=_parse,
        llm=StubLLM(),
        embed=StubEmbed(),
        store=store,
    )
    # Re-ingesting document b must not evict document a's claims.
    ingest_document(
        b"%PDF-b",
        document_doi="10.1/b",
        project_id="proj_1",
        parse=_parse,
        llm=StubLLM(),
        embed=StubEmbed(),
        store=store,
    )
    ingest_document(
        b"%PDF-b",
        document_doi="10.1/b",
        project_id="proj_1",
        parse=_parse,
        llm=StubLLM(),
        embed=StubEmbed(),
        store=store,
    )

    dois = sorted({c.document_doi for c in store.claims})
    assert dois == ["10.1/a", "10.1/b"]
    assert len(store.claims) == 2
