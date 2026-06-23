"""Phase 3 quality reporting (issue #17): the hosted Cohere reranker is a real
(non-degraded) cross-encoder-class reranker."""

from udaan_ranking.reranker import CohereReranker


def test_cohere_reranker_is_not_degraded():
    assert CohereReranker.degraded is False
    assert CohereReranker.implementation == "cohere"
    assert CohereReranker.method == "CROSS_ENCODER"
