import re

from udaan_contracts import CandidatePaper
from udaan_ranking.service import rerank_candidates

_TOKEN = re.compile(r"[a-z0-9]+")


class FakeReranker:
    """Deterministic reranker — exercises rerank_candidates without any ML deps or
    network. Mirrors the CROSS_ENCODER interface (incl. the relevance floor): a doc
    sharing query terms scores high (>= floor), an unrelated doc scores ~0."""

    method = "CROSS_ENCODER"

    def rerank(self, query: str, documents: list[str]) -> list[tuple[int, float]]:
        q = set(_TOKEN.findall(query.lower()))
        out = []
        for i, doc in enumerate(documents):
            d = set(_TOKEN.findall(doc.lower()))
            overlap = len(q & d) / (len(q) or 1)  # fraction of query terms matched
            out.append((i, overlap))
        return out


def make(internal_id: str, title: str, abstract: str) -> CandidatePaper:
    return CandidatePaper(
        internal_id=internal_id,
        doi=None,
        title=title,
        abstract=abstract,
        authors=["Smith, J."],
        publication_date="2023-01-01",
        citation_count=0,
        source_providers=["OpenAlex"],
        source_urls=[],
    )


def test_rerank_orders_by_relevance_and_builds_manifest():
    relevant = make("a", "Micro-caching and tail latency", "micro caching reduces p99 tail latency in distributed stateful systems")
    irrelevant = make("b", "Cooking", "a long unrelated abstract about medieval cooking techniques and recipes")

    index = rerank_candidates("micro caching tail latency", [irrelevant, relevant], FakeReranker(), "proj_1")

    assert index.project_id == "proj_1"
    assert index.total_processed == 2
    # The relevant paper ranks first; the unrelated one is dropped below the
    # cross-encoder relevance floor (Phase 3 §2.3), so the manifest keeps one.
    assert index.ranked_manifest[0].rank == 1
    assert index.ranked_manifest[0].internal_id == "a"
    assert index.total_filtered == 1
    assert all(r.internal_id != "b" for r in index.ranked_manifest)
