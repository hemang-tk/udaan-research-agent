"""Phase 5 degraded-mode reporting (issue #17): hashing embeddings and the pypdf
parser are flagged degraded; the real implementations are not."""

import importlib.util

from udaan_parsing.parser import parse_llamaparse, parser_quality, select_parser
from udaan_shared import HashingEmbeddingProvider


def test_hashing_embedding_is_degraded():
    assert HashingEmbeddingProvider.degraded is True
    assert HashingEmbeddingProvider.implementation == "hashing"


def test_parser_quality_matches_docling_availability():
    implementation, degraded = parser_quality()
    has_docling = importlib.util.find_spec("docling") is not None
    assert degraded == (not has_docling)
    assert implementation == ("docling" if has_docling else "pypdf")


def test_llamaparse_selected_by_env(monkeypatch):
    monkeypatch.setenv("PARSER", "llamaparse")
    assert select_parser() is parse_llamaparse


def test_default_parser_when_env_unset(monkeypatch):
    monkeypatch.delenv("PARSER", raising=False)
    # Falls back to the local Docling/pypdf chain, not the hosted parser.
    assert select_parser() is not parse_llamaparse


def test_llamaparse_quality_degraded_without_key(monkeypatch):
    monkeypatch.setenv("PARSER", "llamaparse")
    monkeypatch.delenv("LLAMAPARSE_API_KEY", raising=False)
    assert parser_quality() == ("llamaparse", True)
    monkeypatch.setenv("LLAMAPARSE_API_KEY", "llx-test")
    assert parser_quality() == ("llamaparse", False)


def test_llamaparse_requires_key(monkeypatch):
    monkeypatch.setenv("PARSER", "llamaparse")
    monkeypatch.delenv("LLAMAPARSE_API_KEY", raising=False)
    import pytest

    with pytest.raises(RuntimeError, match="LLAMAPARSE_API_KEY"):
        parse_llamaparse(b"%PDF-1.4 fake")
