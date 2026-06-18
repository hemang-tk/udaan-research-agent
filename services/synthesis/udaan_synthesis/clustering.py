"""Statistical clustering (Phase 6 §2.2). CPU-bound, runs on claim vectors.

Base implementation is a deterministic greedy cosine-threshold clusterer (pure
Python, no deps) so the pipeline always works. With the `ml` extra, an
Agglomerative clusterer can be substituted; the greedy version is sufficient
for the micro-corpus sizes here.
"""

from __future__ import annotations

import math

DEFAULT_THRESHOLD = 0.6


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def greedy_cluster(vectors: list[list[float]], threshold: float = DEFAULT_THRESHOLD) -> list[list[int]]:
    """Assign each vector to the first cluster whose representative is within the
    cosine-similarity threshold, else start a new cluster. Deterministic."""
    clusters: list[list[int]] = []
    representatives: list[int] = []

    for i, vector in enumerate(vectors):
        best_cluster = -1
        best_sim = threshold
        for cluster_index, rep in enumerate(representatives):
            sim = cosine(vector, vectors[rep])
            if sim >= best_sim:
                best_sim = sim
                best_cluster = cluster_index
        if best_cluster == -1:
            representatives.append(i)
            clusters.append([i])
        else:
            clusters[best_cluster].append(i)

    return clusters


def cluster_quality() -> tuple[str, bool]:
    """Report the active clusterer and whether it is the degraded fallback
    (issue #17): scikit-learn Agglomerative when present, else greedy cosine."""
    try:
        import sklearn  # noqa: F401

        return "agglomerative", False
    except Exception:
        return "greedy", True


def _agglomerative_cluster(vectors: list[list[float]], threshold: float) -> list[list[int]]:
    from sklearn.cluster import AgglomerativeClustering

    if not vectors:
        return []
    if len(vectors) == 1:
        return [[0]]
    model = AgglomerativeClustering(
        n_clusters=None,
        metric="cosine",
        linkage="average",
        distance_threshold=1.0 - threshold,
    )
    labels = model.fit_predict(vectors)
    groups: dict[int, list[int]] = {}
    for index, label in enumerate(labels):
        groups.setdefault(int(label), []).append(index)
    # Preserve first-appearance order for determinism.
    return [groups[label] for label in sorted(groups, key=lambda lbl: min(groups[lbl]))]


def cluster_vectors(vectors: list[list[float]], threshold: float = DEFAULT_THRESHOLD) -> list[list[int]]:
    """Cluster claim vectors with the best available implementation, falling back
    to the deterministic greedy clusterer when scikit-learn is absent."""
    try:
        return _agglomerative_cluster(vectors, threshold)
    except Exception:
        return greedy_cluster(vectors, threshold)
