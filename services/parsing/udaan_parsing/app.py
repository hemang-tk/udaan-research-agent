"""FastAPI surface for Phase 5. POST /ingest takes a vault storage pointer
(s3://bucket/key); the parser streams the PDF directly from MinIO/S3 (no
base64-over-HTTP) and returns the extracted-claim summary."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import replace

import httpx
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

# Retrieve a wide candidate set by vector, then narrow it with the cross-encoder.
_CANDIDATE_K = int(os.environ.get("CHAT_CANDIDATE_K", "20") or "20")
# CRAG (corrective retrieval) is on by default; set ENABLE_CRAG=false to skip it.
_CRAG_ENABLED = os.environ.get("ENABLE_CRAG", "true").strip().lower() != "false"

_NO_PASSAGES = (
    "I don't have the source passages for this research yet — it may have been run before chat "
    "was enabled. Re-run the research to enable chat over its papers."
)
_ABSTAIN = (
    "The papers behind this brief don't appear to cover that. Try rephrasing the question, or ask "
    "about what the papers do discuss."
)

_CRAG_GRADER_SYSTEM = (
    "You are a retrieval grader. Given a question and numbered passages, judge whether the passages "
    "contain enough information to answer it. Respond with JSON only: "
    '{"grade": "correct" | "ambiguous" | "incorrect", "relevant": [passage numbers that help]}. '
    '"correct" = the passages clearly answer it; "ambiguous" = only some passages are relevant; '
    '"incorrect" = none are relevant.'
)
_REWRITE_SYSTEM = (
    "Rewrite the user's question into a different, broader search query that could surface relevant "
    "passages from research papers. Return ONLY the rewritten query — no preamble, no quotes."
)


def _embed_query(embed, text: str) -> list[float]:
    # Asymmetric: queries embed as "search_query" against "search_document" chunks.
    try:
        return embed.embed([text], input_type="search_query")[0]
    except TypeError:
        return embed.embed([text])[0]


def _cohere_rerank(api_key: str | None, query: str, documents: list[str]):
    """#1 Cohere rerank-v3.5. Returns [(candidate_index, score)] ordered by relevance,
    or None on any failure (caller falls back to the vector order)."""
    if not api_key or not documents:
        return None
    try:
        resp = httpx.post(
            "https://api.cohere.com/v2/rerank",
            json={"model": "rerank-v3.5", "query": query, "documents": documents, "top_n": len(documents)},
            headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"},
            timeout=15.0,
        )
        resp.raise_for_status()
        return [(int(it["index"]), float(it["relevance_score"])) for it in resp.json().get("results", [])]
    except Exception:
        return None


def _rerank(cohere_key, question, candidates, top_n):
    """Cross-encoder rerank the vector candidates; graceful fallback to vector order."""
    ranked = _cohere_rerank(cohere_key, question, [(c.get("text") or "") for c in candidates])
    if not ranked:
        return candidates[:top_n]
    return [candidates[idx] for idx, _ in ranked[:top_n]]


def _crag_grade(question, hits):
    """#2 CRAG: grade whether `hits` can answer `question` -> (grade, relevant_1based).
    Fails OPEN — any grading hiccup is treated as 'correct' so an answer is never blocked."""
    if not hits:
        return "incorrect", []
    listing = "\n\n".join(f"[{i}] {(h.get('text') or '')[:500]}" for i, h in enumerate(hits, start=1))
    try:
        raw = _chat_llm_provider().complete(
            [{"role": "user", "content": f"Question: {question}\n\nPassages:\n{listing}"}],
            system=_CRAG_GRADER_SYSTEM,
            json_schema={"type": "object"},
            max_tokens=200,
        )
        data = json.loads(raw)
        grade = str(data.get("grade", "correct")).lower()
        if grade not in ("correct", "ambiguous", "incorrect"):
            grade = "correct"
        relevant = [int(n) for n in data.get("relevant", []) if isinstance(n, (int, float))]
        return grade, relevant
    except Exception:
        return "correct", list(range(1, len(hits) + 1))


def _rewrite_query(question):
    try:
        out = _chat_llm_provider().complete(
            [{"role": "user", "content": question}], system=_REWRITE_SYSTEM, max_tokens=60
        )
        return out.strip().strip('"') or question
    except Exception:
        return question


@app.post("/ask")
def ask(req: AskRequest) -> dict:
    """Advanced RAG over one research's full-text chunks: vector retrieval ->
    cross-encoder rerank (#1) -> CRAG relevance grading + one corrective retry (#2)
    -> grounded answer with inline [n] citations."""
    _, embed, _, _, chunk_store = _deps()
    cohere_key = load_config().api_keys.get("cohere")
    top_k = max(1, min(req.top_k, 12))

    def retrieve(question: str):
        candidates = chunk_store.search(req.project_id, _embed_query(embed, question), top_k=_CANDIDATE_K)
        return _rerank(cohere_key, question, candidates, top_k) if candidates else []

    hits = retrieve(req.question)
    if not hits:
        return {"answer": _NO_PASSAGES, "citations": []}

    # #2 CRAG: grade the retrieved context; keep only relevant, or correct once.
    if _CRAG_ENABLED:
        grade, relevant = _crag_grade(req.question, hits)
        if grade == "ambiguous" and relevant:
            hits = [hits[i - 1] for i in relevant if 1 <= i <= len(hits)] or hits
        elif grade == "incorrect":
            alt = _rewrite_query(req.question)
            retry = retrieve(alt) if alt != req.question else []
            if retry:
                g2, rel2 = _crag_grade(req.question, retry)
                if g2 == "incorrect":
                    return {"answer": _ABSTAIN, "citations": []}
                hits = (
                    ([retry[i - 1] for i in rel2 if 1 <= i <= len(retry)] or retry)
                    if g2 == "ambiguous"
                    else retry
                )
            # retry found nothing -> fail open, answer from the original hits

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
