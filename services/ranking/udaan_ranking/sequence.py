"""Sequence Assembly (Phase 3 §2.1): build [query, document] inputs for the
cross-encoder, truncating each document to bound the sequence length."""

from __future__ import annotations

from udaan_contracts import CandidatePaper

MAX_DOC_CHARS = 2000


def build_documents(candidates: list[CandidatePaper]) -> list[str]:
    return [f"{c.title}. {c.abstract}"[:MAX_DOC_CHARS] for c in candidates]
