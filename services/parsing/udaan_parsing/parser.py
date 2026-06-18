"""Layout parsing (Phase 5 §2.1). Docling when available (layout-aware,
two-column safe); pypdf as the always-available fallback."""

from __future__ import annotations

import io

from .chunking import Chunk, chunk_pages


def parser_quality() -> tuple[str, bool]:
    """Report the active parser implementation and whether it is the fallback
    (issue #17): Docling is layout-aware; pypdf is the degraded fallback."""
    try:
        import docling  # noqa: F401

        return "docling", False
    except Exception:
        return "pypdf", True


def _extract_pages_pypdf(data: bytes) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return [(page.extract_text() or "") for page in reader.pages]


def _parse_docling(data: bytes) -> list[Chunk]:
    # Lazy: requires the `ml` extra. Best-effort mapping of Docling nodes -> Chunks.
    from docling.document_converter import DocumentConverter  # type: ignore

    source = io.BytesIO(data)
    result = DocumentConverter().convert(source)
    chunks: list[Chunk] = []
    section = "Body"
    for item in getattr(result.document, "texts", []):
        text = (getattr(item, "text", "") or "").strip()
        if not text:
            continue
        label = str(getattr(item, "label", "")).lower()
        page = int(getattr(getattr(item, "prov", [{}])[0], "page_no", 1)) if getattr(item, "prov", None) else 1
        if "title" in label or "section" in label or "header" in label:
            section = text
            continue
        chunks.append(Chunk(text=text, section=section, page_number=page, node_type=label or "paragraph"))
    return chunks


def parse_pdf(data: bytes) -> list[Chunk]:
    """Parse a PDF into context-preserving chunks. Uses Docling if installed,
    otherwise pypdf page extraction + paragraph chunking."""
    try:
        chunks = _parse_docling(data)
        if chunks:
            return chunks
    except Exception:
        pass
    return chunk_pages(_extract_pages_pypdf(data))
