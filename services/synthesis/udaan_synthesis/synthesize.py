"""Phase 6 orchestration: cluster FINDING claims, judge each cluster's polarity,
and assemble the SynthesisGraph for Phase 7. Singletons/outliers are surfaced as
THIN_EVIDENCE (isolated findings) rather than discarded."""

from __future__ import annotations

from udaan_contracts import (
    SynthesisClaimRef,
    SynthesisCluster,
    SynthesisGraph,
    ValidatedClaim,
)

from .clustering import DEFAULT_THRESHOLD, cluster_vectors
from .polarity import fallback_label, judge_cluster

MIN_CLUSTER_SIZE = 2
MAX_CLAIMS_PER_JUDGE = 15  # cap to avoid context overflow (Phase 6 §2.3)


def synthesize(
    claims: list[ValidatedClaim],
    llm,
    *,
    project_id: str,
    similarity_threshold: float = DEFAULT_THRESHOLD,
) -> SynthesisGraph:
    # Only FINDINGs with embeddings participate in consensus clustering.
    findings = [c for c in claims if c.claim_classification == "FINDING" and c.vector_embedding]
    vectors = [c.vector_embedding for c in findings]
    groups = cluster_vectors(vectors, similarity_threshold)

    graph: list[SynthesisCluster] = []
    for index, member_indices in enumerate(groups, start=1):
        members = [findings[i] for i in member_indices]
        texts = [m.claim_text for m in members]

        if len(members) < MIN_CLUSTER_SIZE:
            polarity, label = "THIN_EVIDENCE", fallback_label(texts)
        else:
            polarity, label = judge_cluster(texts[:MAX_CLAIMS_PER_JUDGE], llm)

        graph.append(
            SynthesisCluster(
                cluster_id=f"cluster_{index:02d}",
                generated_topic_label=label,
                polarity=polarity,
                claims=[
                    SynthesisClaimRef(claim_id=m.claim_id, doi=m.document_doi, text=m.claim_text)
                    for m in members
                ],
            )
        )

    return SynthesisGraph(project_id=project_id, synthesis_graph=graph)
