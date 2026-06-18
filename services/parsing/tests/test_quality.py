"""Phase 5 degraded-mode reporting (issue #17): hashing embeddings and the pypdf
parser are flagged degraded; the real implementations are not."""

import importlib.util

from udaan_parsing.parser import parser_quality
from udaan_shared import HashingEmbeddingProvider


def test_hashing_embedding_is_degraded():
    assert HashingEmbeddingProvider.degraded is True
    assert HashingEmbeddingProvider.implementation == "hashing"


def test_parser_quality_matches_docling_availability():
    implementation, degraded = parser_quality()
    has_docling = importlib.util.find_spec("docling") is not None
    assert degraded == (not has_docling)
    assert implementation == ("docling" if has_docling else "pypdf")
