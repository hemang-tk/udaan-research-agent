"""FastAPI surface for Phase 3. POST /rerank accepts the cross-encoder payload
and returns a PrioritizedIngestionIndex."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field
from udaan_contracts import CandidatePaper
from udaan_shared import create_rerank_provider, load_config

from .reranker import register as register_rerankers
from .service import Reranker, rerank_candidates

register_rerankers()

_log = logging.getLogger("udaan.ranking")

app = FastAPI(title="Udaan Ranking (Phase 3)")

_reranker: Reranker | None = None
_quality_logged = False


def get_reranker() -> Reranker:
    """Lazily construct the configured reranker (so import doesn't require env)."""
    global _reranker
    if _reranker is None:
        _reranker = create_rerank_provider(load_config())
    return _reranker


def stage_quality() -> list[dict]:
    """Report the active rerank implementation and whether it is degraded (#17)."""
    global _quality_logged
    reranker = get_reranker()
    degraded = bool(getattr(reranker, "degraded", False))
    implementation = getattr(reranker, "implementation", getattr(reranker, "method", "unknown"))
    if degraded and not _quality_logged:
        _log.warning("Ranking is running a DEGRADED fallback reranker: %s", implementation)
        _quality_logged = True
    return [{"stage": "rerank", "implementation": implementation, "degraded": degraded}]


class RerankRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(default="", alias="projectId")
    original_query: str = Field(alias="originalQuery")
    candidate_papers: list[CandidatePaper] = Field(alias="candidatePapers")


@app.get("/health")
def health() -> dict:
    try:
        stages = stage_quality()
    except Exception:
        stages = []
    return {"status": "ok", "stages": stages}


@app.post("/rerank")
def rerank(req: RerankRequest) -> dict:
    result = rerank_candidates(
        req.original_query, req.candidate_papers, get_reranker(), req.project_id
    )
    return result.model_dump(by_alias=True)
