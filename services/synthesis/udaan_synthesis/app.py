"""FastAPI surface for Phase 6. POST /synthesize fetches a project's FINDING
claims and returns the SynthesisGraph."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field
from udaan_shared import create_llm_provider, load_config, register_defaults

from .clustering import cluster_quality
from .source import ClaimSource, InMemoryClaimSource, QdrantClaimSource
from .synthesize import synthesize

register_defaults()

_log = logging.getLogger("udaan.synthesis")
_quality_logged = False

app = FastAPI(title="Udaan Synthesis (Phase 6)")


def stage_quality() -> list[dict]:
    """Report the active clustering implementation and whether degraded (#17)."""
    global _quality_logged
    implementation, degraded = cluster_quality()
    if degraded and not _quality_logged:
        _log.warning("Synthesis is running a DEGRADED fallback clusterer: %s", implementation)
        _quality_logged = True
    return [{"stage": "clustering", "implementation": implementation, "degraded": degraded}]

_llm = None
_source: ClaimSource | None = None


def _deps():
    global _llm, _source
    if _llm is None:
        cfg = load_config()
        _llm = create_llm_provider(cfg)
        try:
            _source = QdrantClaimSource(cfg.qdrant_url, api_key=cfg.qdrant_api_key)
        except Exception:
            _source = InMemoryClaimSource([])
    return _llm, _source


class SynthesizeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(alias="projectId")


@app.get("/health")
def health() -> dict:
    try:
        stages = stage_quality()
    except Exception:
        stages = []
    return {"status": "ok", "stages": stages}


@app.post("/synthesize")
def synthesize_endpoint(req: SynthesizeRequest) -> dict:
    llm, source = _deps()
    claims = source.fetch_findings(req.project_id)
    graph = synthesize(claims, llm, project_id=req.project_id)
    return graph.model_dump(by_alias=True)
