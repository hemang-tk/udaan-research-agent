"""FastAPI surface for Phase 5. POST /ingest takes a vault storage pointer
(s3://bucket/key); the parser streams the PDF directly from MinIO/S3 (no
base64-over-HTTP) and returns the extracted-claim summary."""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field
from udaan_shared import create_embedding_provider, create_llm_provider, load_config, register_defaults

from .embeddings import register_sentence_transformers
from .ingest import ingest_from_pointer
from .objstore import InMemoryObjectStore, ObjectStore, S3ObjectStore
from .parser import parse_pdf
from .store import ClaimStore, InMemoryClaimStore, QdrantClaimStore

register_defaults()
register_sentence_transformers()  # overrides "local" embedding if ML extra present

app = FastAPI(title="Udaan Parsing (Phase 5)")

_llm = None
_embed = None
_store: ClaimStore | None = None
_objstore: ObjectStore | None = None


def _deps():
    global _llm, _embed, _store, _objstore
    if _llm is None:
        cfg = load_config()
        _llm = create_llm_provider(cfg)
        _embed = create_embedding_provider(cfg)
        try:
            _store = QdrantClaimStore(cfg.qdrant_url)
        except Exception:
            _store = InMemoryClaimStore()
        try:
            _objstore = S3ObjectStore.from_config(cfg.s3)
        except Exception:
            _objstore = InMemoryObjectStore()
    return _llm, _embed, _store, _objstore


class IngestRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(alias="projectId")
    document_doi: str | None = Field(default=None, alias="documentDoi")
    storage_pointer: str = Field(alias="storagePointer")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ingest")
def ingest(req: IngestRequest) -> dict:
    llm, embed, store, objstore = _deps()
    claims = ingest_from_pointer(
        req.storage_pointer,
        req.document_doi,
        req.project_id,
        object_store=objstore,
        parse=parse_pdf,
        llm=llm,
        embed=embed,
        store=store,
    )
    return {
        "projectId": req.project_id,
        "claimsExtracted": len(claims),
        "claimIds": [c.claim_id for c in claims],
    }
