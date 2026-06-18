"""Optional sentence-transformers embedding provider (the `ml` extra). When
available it overrides the hashing fallback registered as "local"."""

from __future__ import annotations

from udaan_shared import register_embedding_provider


def register_sentence_transformers() -> bool:
    try:
        from sentence_transformers import SentenceTransformer
    except Exception:
        return False

    class STEmbeddingProvider:
        # Real semantic embeddings — not degraded.
        degraded = False
        implementation = "sentence-transformers"

        def __init__(self, model_name: str) -> None:
            self._model = SentenceTransformer(model_name)

        def embed(self, texts: list[str]) -> list[list[float]]:
            vectors = self._model.encode(texts, normalize_embeddings=True)
            return [[float(x) for x in row] for row in vectors]

    register_embedding_provider("local", lambda config: STEmbeddingProvider(config.embedding_model))
    return True
