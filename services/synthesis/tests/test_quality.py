"""Phase 6 degraded-mode reporting (issue #17): the greedy cosine clusterer is
the degraded fallback; scikit-learn Agglomerative is not. cluster_vectors must
keep working (and match greedy) when scikit-learn is absent."""

import importlib.util

from udaan_synthesis.clustering import cluster_quality, cluster_vectors, greedy_cluster

_HAS_SKLEARN = importlib.util.find_spec("sklearn") is not None


def test_cluster_quality_matches_sklearn_availability():
    implementation, degraded = cluster_quality()
    assert degraded == (not _HAS_SKLEARN)
    assert implementation == ("agglomerative" if _HAS_SKLEARN else "greedy")


def test_cluster_vectors_falls_back_to_greedy_without_sklearn():
    vectors = [[1.0, 0.0], [0.99, 0.01], [0.0, 1.0]]
    if not _HAS_SKLEARN:
        assert cluster_vectors(vectors) == greedy_cluster(vectors)
    else:
        # With sklearn present it still returns a valid partition of all indices.
        groups = cluster_vectors(vectors)
        assert sorted(i for g in groups for i in g) == [0, 1, 2]
