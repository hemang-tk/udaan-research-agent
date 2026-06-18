"""Phase 5 orchestration for one document:
parse -> chunk -> extract (quote-anchored) -> embed -> store.
Dependencies are injected so the pipeline is testable without ML/infra."""

from __future__ import annotations

from collections.abc import Callable

from udaan_contracts import ValidatedClaim

from .chunking import Chunk
from .extract import extract_claims


def ingest_document(
    pdf_bytes: bytes,
    document_doi: str | None,
    project_id: str,
    *,
    parse: Callable[[bytes], list[Chunk]],
    llm,
    embed,
    store,
) -> list[ValidatedClaim]:
    chunks = parse(pdf_bytes)

    claims: list[ValidatedClaim] = []
    for chunk in chunks:
        claims.extend(extract_claims(chunk, project_id, document_doi, llm))

    # Idempotency (Phase 5): a re-run (retry, crash recovery, paywall re-upload)
    # must converge on exactly the current claim set rather than accumulate
    # duplicates. Deterministic claim IDs make the upsert overwrite in place; the
    # delete below removes claims that are no longer extracted. Crucially, we only
    # delete AFTER the fallible embed step succeeds — deleting first would leave
    # the document empty if embedding/upsert failed.
    if claims:
        vectors = embed.embed([c.claim_text for c in claims])
        if len(vectors) != len(claims):
            raise ValueError(
                f"embed() returned {len(vectors)} vectors for {len(claims)} claims"
            )
        for claim, vector in zip(claims, vectors):
            claim.vector_embedding = [float(x) for x in vector]
        store.delete_document_claims(project_id, document_doi)
        store.upsert(claims)
    else:
        # No claims extracted: still drop stale claims so the document converges
        # to empty rather than retaining a previous run's claims.
        store.delete_document_claims(project_id, document_doi)

    return claims
