"""Phase 5 parser selection + quality reporting (issue #17). Hosted-only build:
the parser is always the LlamaParse cloud API."""

from udaan_parsing.parser import parse_llamaparse, parser_quality, select_parser


def test_parser_is_always_llamaparse(monkeypatch):
    monkeypatch.delenv("PARSER", raising=False)
    assert select_parser() is parse_llamaparse
    monkeypatch.setenv("PARSER", "llamaparse")
    assert select_parser() is parse_llamaparse


def test_llamaparse_quality_degraded_without_key(monkeypatch):
    monkeypatch.delenv("LLAMAPARSE_API_KEY", raising=False)
    assert parser_quality() == ("llamaparse", True)
    monkeypatch.setenv("LLAMAPARSE_API_KEY", "llx-test")
    assert parser_quality() == ("llamaparse", False)


def test_llamaparse_requires_key(monkeypatch):
    monkeypatch.delenv("LLAMAPARSE_API_KEY", raising=False)
    import pytest

    with pytest.raises(RuntimeError, match="LLAMAPARSE_API_KEY"):
        parse_llamaparse(b"%PDF-1.4 fake")


def _make_pdf(pages: int) -> bytes:
    import io

    from pypdf import PdfWriter

    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def test_cap_pdf_pages_truncates_oversized(monkeypatch):
    from pypdf import PdfReader
    from udaan_parsing.parser import _cap_pdf_pages

    monkeypatch.setenv("MAX_PDF_PAGES", "5")
    capped = _cap_pdf_pages(_make_pdf(20))
    import io

    assert len(PdfReader(io.BytesIO(capped)).pages) == 5


def test_cap_pdf_pages_passthrough(monkeypatch):
    from udaan_parsing.parser import _cap_pdf_pages

    pdf = _make_pdf(3)
    # No cap set -> unchanged.
    monkeypatch.delenv("MAX_PDF_PAGES", raising=False)
    assert _cap_pdf_pages(pdf) == pdf
    # Under the cap -> unchanged.
    monkeypatch.setenv("MAX_PDF_PAGES", "10")
    assert _cap_pdf_pages(pdf) == pdf
    # Unsplittable bytes -> returned as-is (ingest timeout is the backstop).
    monkeypatch.setenv("MAX_PDF_PAGES", "1")
    assert _cap_pdf_pages(b"not a pdf") == b"not a pdf"
