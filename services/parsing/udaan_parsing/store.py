"""Claim storage (Phase 5 §2.5 / §4). Qdrant in real runs; in-memory for
tests/no-infra. Qdrant client is lazily imported (optional `qdrant` extra).

Storage is idempotent per document: claim point IDs are derived from stable
content (see ``extract.deterministic_claim_id``), and ``delete_document_claims``
drops any existing claims for a ``(projectId, documentDoi)`` before re-insert so
a re-run (retry, crash recovery, paywall re-upload) yields the same claim set
rather than accumulating duplicates."""

from __future__ import annotations

import uuid
from typing import Protocol

from udaan_contracts import ValidatedClaim


def _point_id(claim_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, claim_id))


class ClaimStore(Protocol):
    def delete_document_claims(self, project_id: str, document_doi: str | None) -> None: ...

    def upsert(self, claims: list[ValidatedClaim]) -> None: ...


class InMemoryClaimStore:
    def __init__(self) -> None:
        # Keyed by claim_id so an upsert overwrites rather than appends.
        self._by_id: dict[str, ValidatedClaim] = {}

    @property
    def claims(self) -> list[ValidatedClaim]:
        return list(self._by_id.values())

    def delete_document_claims(self, project_id: str, document_doi: str | None) -> None:
        for cid in [
            c.claim_id
            for c in self._by_id.values()
            if c.project_id == project_id and c.document_doi == document_doi
        ]:
            del self._by_id[cid]

    def upsert(self, claims: list[ValidatedClaim]) -> None:
        for claim in claims:
            self._by_id[claim.claim_id] = claim


class QdrantClaimStore:
    """Stores claims as points with payload indexing on projectId / documentDoi /
    claimClassification (Phase 5 §4.1)."""

    def __init__(
        self, url: str, collection: str = "claims", dim: int = 384, *, api_key: str | None = None
    ) -> None:
        from qdrant_client import QdrantClient

        # api_key is required for Qdrant Cloud, omitted for a local/docker Qdrant.
        self.client = QdrantClient(url=url, api_key=api_key)
        self.collection = collection
        self._default_dim = dim
        # Create lazily on first upsert, sized to the ACTUAL embedding dimension.
        # Real models (BGE = 768) and the hashing fallback (384) differ, so a fixed
        # size 400s with a dimension mismatch; a stale collection is recreated.
        self._ready_dim: int | None = None

    def _ensure_collection(self, dim: int) -> None:
        from qdrant_client.models import Distance, VectorParams

        if self._ready_dim == dim:
            return
        current: int | None = None
        try:
            current = self.client.get_collection(self.collection).config.params.vectors.size
        except Exception:
            current = None
        if current != dim:
            try:
                self.client.delete_collection(self.collection)
            except Exception:
                pass
            self.client.create_collection(
                collection_name=self.collection,
                vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
            )
            self._ensure_payload_indexes()
        self._ready_dim = dim

    def _ensure_payload_indexes(self) -> None:
        from qdrant_client.models import PayloadSchemaType

        for field in ("projectId", "documentDoi", "claimClassification"):
            try:
                self.client.create_payload_index(
                    collection_name=self.collection,
                    field_name=field,
                    field_schema=PayloadSchemaType.KEYWORD,
                )
            except Exception:
                # Index already exists (or server rejects re-create) — non-fatal.
                pass

    def _document_filter(self, project_id: str, document_doi: str | None):
        from qdrant_client.models import (
            FieldCondition,
            Filter,
            IsNullCondition,
            MatchValue,
            PayloadField,
        )

        must = [FieldCondition(key="projectId", match=MatchValue(value=project_id))]
        if document_doi is None:
            must.append(IsNullCondition(is_null=PayloadField(key="documentDoi")))
        else:
            must.append(FieldCondition(key="documentDoi", match=MatchValue(value=document_doi)))
        return Filter(must=must)

    def delete_document_claims(self, project_id: str, document_doi: str | None) -> None:
        from qdrant_client.models import FilterSelector

        try:
            self.client.delete(
                collection_name=self.collection,
                points_selector=FilterSelector(filter=self._document_filter(project_id, document_doi)),
            )
        except Exception:
            # Collection may not exist yet on the first ingest — nothing to delete.
            pass

    def upsert(self, claims: list[ValidatedClaim]) -> None:
        from qdrant_client.models import PointStruct

        points = []
        for claim in claims:
            if claim.vector_embedding is None:
                continue
            payload = claim.model_dump(by_alias=True, exclude={"vector_embedding"})
            points.append(
                PointStruct(id=_point_id(claim.claim_id), vector=claim.vector_embedding, payload=payload)
            )
        if points:
            self._ensure_collection(len(points[0].vector))
            self.client.upsert(collection_name=self.collection, points=points)
