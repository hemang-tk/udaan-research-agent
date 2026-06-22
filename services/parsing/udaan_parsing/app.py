"""FastAPI surface for Phase 5. POST /ingest takes a vault storage pointer
(s3://bucket/key); the parser streams the PDF directly from MinIO/S3 (no
base64-over-HTTP) and returns the extracted-claim summary."""

from __future__ import annotations

import logging
import os
from dataclasses import replace

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field
from udaan_shared import create_embedding_provider, create_llm_provider, load_config, register_defaults

from .embeddings import register_sentence_transformers
from .ingest import ingest_from_pointer
from .objstore import InMemoryObjectStore, ObjectStore, S3ObjectStore
from .parser import parser_quality, select_parser
from .store import (
    ChunkStore,
    ClaimStore,
    InMemoryChunkStore,
    InMemoryClaimStore,
    QdrantChunkStore,
    QdrantClaimStore,
)

register_defaults()
register_sentence_transformers()  # overrides "local" embedding if ML extra present

_log = logging.getLogger("udaan.parsing")

app = FastAPI(title="Udaan Parsing (Phase 5)")

_llm = None
_embed = None
_store: ClaimStore | None = None
_objstore: ObjectStore | None = None
_chunk_store: ChunkStore | None = None
_chat_llm = None
_quality_logged = False


def _deps():
    global _llm, _embed, _store, _objstore, _chunk_store
    if _llm is None:
        cfg = load_config()
        _llm = create_llm_provider(cfg)
        _embed = create_embedding_provider(cfg)
        try:
            _store = QdrantClaimStore(cfg.qdrant_url, api_key=cfg.qdrant_api_key)
        except Exception:
            _store = InMemoryClaimStore()
        try:
            _chunk_store = QdrantChunkStore(cfg.qdrant_url, api_key=cfg.qdrant_api_key)
        except Exception:
            _chunk_store = InMemoryChunkStore()
        try:
            _objstore = S3ObjectStore.from_config(cfg.s3)
        except Exception:
            _objstore = InMemoryObjectStore()
    return _llm, _embed, _store, _objstore, _chunk_store


def _chat_llm_provider():
    """LLM used for chat answers. CHAT_LLM_PROVIDER (e.g. "groq,anthropic") picks a
    strict-priority chain — Groq first (free), Anthropic as a backstop — so chat is
    near-free but never errors out. Falls back to LLM_PROVIDER when unset."""
    global _chat_llm
    if _chat_llm is None:
        cfg = load_config()
        providers = os.environ.get("CHAT_LLM_PROVIDER") or cfg.llm_provider
        _chat_llm = create_llm_provider(replace(cfg, llm_provider=providers), round_robin=False)
    return _chat_llm


def stage_quality() -> list[dict]:
    """Report the active embedding + parser implementations (issue #17)."""
    global _quality_logged
    _, embed, _, _, _ = _deps()
    embed_degraded = bool(getattr(embed, "degraded", False))
    embed_impl = getattr(embed, "implementation", "unknown")
    parser_impl, parser_degraded = parser_quality()
    stages = [
        {"stage": "embedding", "implementation": embed_impl, "degraded": embed_degraded},
        {"stage": "parsing", "implementation": parser_impl, "degraded": parser_degraded},
    ]
    if not _quality_logged:
        for s in stages:
            if s["degraded"]:
                _log.warning("Parsing stage %s is DEGRADED: %s", s["stage"], s["implementation"])
        _quality_logged = True
    return stages


class IngestRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(alias="projectId")
    document_doi: str | None = Field(default=None, alias="documentDoi")
    storage_pointer: str = Field(alias="storagePointer")


@app.get("/health")
def health() -> dict:
    try:
        stages = stage_quality()
    except Exception:
        stages = []
    return {"status": "ok", "stages": stages}


@app.post("/ingest")
def ingest(req: IngestRequest) -> dict:
    llm, embed, store, objstore, chunk_store = _deps()
    claims = ingest_from_pointer(
        req.storage_pointer,
        req.document_doi,
        req.project_id,
        object_store=objstore,
        parse=select_parser(),
        llm=llm,
        embed=embed,
        store=store,
        chunk_store=chunk_store,
    )
    return {
        "projectId": req.project_id,
        "claimsExtracted": len(claims),
        "claimIds": [c.claim_id for c in claims],
    }


class AskRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(alias="projectId")
    question: str
    top_k: int = Field(default=6, alias="topK")


_ASK_SYSTEM = (
    "You answer questions using ONLY the numbered passages provided below, which are "
    "drawn from the research papers behind a brief. Rules:\n"
    "- Cite the passages you use inline with [n], matching their numbers.\n"
    "- If the passages do not contain the answer, say so plainly — do not guess.\n"
    "- Never invent facts, numbers, or citations beyond the passages.\n"
    "- Be concise and specific (2–5 sentences)."
)


@app.post("/ask")
def ask(req: AskRequest) -> dict:
    """RAG over one research's full-text chunks: embed the question, vector-search
    this project's passages, and answer with inline [n] citations."""
    _, embed, _, _, chunk_store = _deps()

    # Embed the question as a retrieval query (asymmetric to stored documents).
    try:
        qvec = embed.embed([req.question], input_type="search_query")[0]
    except TypeError:
        qvec = embed.embed([req.question])[0]

    top_k = max(1, min(req.top_k, 12))
    hits = chunk_store.search(req.project_id, qvec, top_k=top_k)
    if not hits:
        return {
            "answer": (
                "I don't have the source passages for this research yet — it may have been run "
                "before chat was enabled. Re-run the research to enable chat over its papers."
            ),
            "citations": [],
        }

    citations: list[dict] = []
    context_lines: list[str] = []
    for i, h in enumerate(hits, start=1):
        text = (h.get("text") or "").strip()
        doi = h.get("documentDoi")
        quote = text[:280] + ("…" if len(text) > 280 else "")
        citations.append({"n": i, "quote": quote, "doi": doi, "title": None})
        loc = f"section: {h.get('section', '?')}, page {h.get('page', '?')}"
        src = f"doi:{doi}" if doi else "uploaded source"
        context_lines.append(f"[{i}] ({src}; {loc})\n{text}")

    user = "Passages:\n\n" + "\n\n".join(context_lines) + f"\n\nQuestion: {req.question}"
    answer = _chat_llm_provider().complete(
        [{"role": "user", "content": user}], system=_ASK_SYSTEM, max_tokens=700
    )
    return {"answer": answer.strip(), "citations": citations}
