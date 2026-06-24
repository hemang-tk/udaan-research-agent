"""Layout parsing (Phase 5 §2.1). Hosted-only build: always uses the LlamaParse
cloud API (layout-aware, no local compute) — needs only LLAMAPARSE_API_KEY,
nothing to self-host. This keeps the parsing service light enough for a free
CPU host."""

from __future__ import annotations

import io
import json
import os
import re
import time
import urllib.request
from collections.abc import Callable

from .chunking import Chunk, chunk_pages

# LlamaParse REST surface (stdlib HTTP only — no SDK, mirrors the Cohere reranker).
_LLAMAPARSE_BASE = "https://api.cloud.llamaindex.ai/api/v1/parsing"
_MD_HEADING = re.compile(r"(?m)^#{1,6}\s+")


def _cap_pdf_pages(data: bytes) -> bytes:
    """Truncate an oversized PDF to its first MAX_PDF_PAGES pages (0/unset = no cap).
    Research papers front-load the abstract/intro/findings, and MAX_CHUNKS_PER_DOC
    already bounds extraction, so parsing all 50 pages of a giant PDF is wasted
    time/credits (and a stall risk). Returns the original bytes when under the cap,
    when no cap is set, or when the PDF can't be split (corrupt/encrypted) — in that
    last case the orchestrator's bounded ingest timeout is the backstop that skips a
    doc that then parses too slowly."""
    max_pages = int(os.environ.get("MAX_PDF_PAGES", "0") or "0")
    if max_pages <= 0:
        return data
    try:
        from pypdf import PdfReader, PdfWriter

        reader = PdfReader(io.BytesIO(data))
        if len(reader.pages) <= max_pages:
            return data
        writer = PdfWriter()
        for page in reader.pages[:max_pages]:
            writer.add_page(page)
        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception:
        return data  # can't split — let the parser try; ingest timeout guards the run


def parser_quality() -> tuple[str, bool]:
    """Report the active parser implementation and whether it is degraded
    (issue #17). LlamaParse is layout-aware (not degraded); it is only degraded
    when LLAMAPARSE_API_KEY is missing, in which case it will fail."""
    return "llamaparse", not bool(os.environ.get("LLAMAPARSE_API_KEY"))


def _llamaparse_upload(data: bytes, api_key: str) -> str:
    """Upload the PDF (multipart/form-data) and return the parse job id."""
    boundary = "----udaanLlamaParseBoundary7MA4YWxkTrZu0gW"
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="file"; filename="document.pdf"\r\n',
        b"Content-Type: application/pdf\r\n\r\n",
        data,
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        f"{_LLAMAPARSE_BASE}/upload",
        data=body,
        headers={
            "authorization": f"Bearer {api_key}",
            "accept": "application/json",
            "content-type": f"multipart/form-data; boundary={boundary}",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))["id"]


def _llamaparse_wait(job_id: str, api_key: str, *, timeout_s: float = 110.0, interval_s: float = 2.0) -> None:
    """Poll the async job until SUCCESS (or raise). Bounded so a stuck job fails
    fast rather than hanging the per-document ingest."""
    headers = {"authorization": f"Bearer {api_key}", "accept": "application/json"}
    waited = 0.0
    while waited < timeout_s:
        req = urllib.request.Request(f"{_LLAMAPARSE_BASE}/job/{job_id}", headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
            status = json.loads(resp.read().decode("utf-8")).get("status")
        if status == "SUCCESS":
            return
        if status in {"ERROR", "FAILED", "CANCELED"}:
            raise RuntimeError(f"LlamaParse job {job_id} failed: {status}")
        time.sleep(interval_s)
        waited += interval_s
    raise TimeoutError(f"LlamaParse job {job_id} did not finish within {timeout_s:.0f}s")


def _llamaparse_pages(job_id: str, api_key: str) -> list[str]:
    """Fetch the per-page result so page_number lineage survives into each claim."""
    headers = {"authorization": f"Bearer {api_key}", "accept": "application/json"}
    req = urllib.request.Request(f"{_LLAMAPARSE_BASE}/job/{job_id}/result/json", headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        result = json.loads(resp.read().decode("utf-8"))
    return [str(page.get("md") or page.get("text") or "") for page in result.get("pages", [])]


def parse_llamaparse(data: bytes) -> list[Chunk]:
    """Parse a PDF via the hosted LlamaParse API. Returns context-preserving
    chunks with section + page lineage."""
    api_key = os.environ.get("LLAMAPARSE_API_KEY")
    if not api_key:
        raise RuntimeError("LLAMAPARSE_API_KEY is not set (required for the hosted parser)")
    data = _cap_pdf_pages(data)  # bound parse time + LlamaParse credits on huge PDFs
    job_id = _llamaparse_upload(data, api_key)
    _llamaparse_wait(job_id, api_key)
    # LlamaParse returns Markdown; strip the leading `#`/`##` markers so chunk_pages'
    # section detector sees a bare heading line (it matches plain section names).
    pages = [_MD_HEADING.sub("", page) for page in _llamaparse_pages(job_id, api_key)]
    return chunk_pages(pages)


def select_parser() -> Callable[[bytes], list[Chunk]]:
    """The hosted build always parses via the LlamaParse cloud API (no local
    compute, just LLAMAPARSE_API_KEY)."""
    return parse_llamaparse
