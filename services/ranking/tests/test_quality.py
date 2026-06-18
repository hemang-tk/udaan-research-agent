"""Phase 3 degraded-mode reporting (issue #17): the lexical fallback reranker is
flagged degraded; the real cross-encoder / Cohere rerankers are not."""

from udaan_ranking.reranker import CohereReranker, CrossEncoderReranker, LexicalReranker


def test_lexical_reranker_is_degraded():
    assert LexicalReranker.degraded is True
    assert LexicalReranker.implementation == "lexical"


def test_real_rerankers_are_not_degraded():
    assert CrossEncoderReranker.degraded is False
    assert CrossEncoderReranker.implementation == "cross-encoder"
    assert CohereReranker.degraded is False
    assert CohereReranker.implementation == "cohere"
