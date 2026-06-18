# Architectural Design Document: Phase 6 — Cross-Source Synthesis & Polarity Detection

This document establishes the architectural layout and technical specifications for **Phase 6: Cross-Source Synthesis & Polarity Detection** within the Academic Paper Discovery and Synthesis Engine.

Phase 6 extracts logical meaning from mathematical proximity. It fetches the discrete, context-aware claims generated in Phase 5, groups them strictly by topical bounds using statistical clustering, and cross-examines those clusters using an LLM to explicitly map academic consensus, contradiction, and literature gaps.

---

## Implementation Stack (finalized)

- **Language:** Python service — SciPy/NumPy + HDBSCAN/Agglomerative clustering (CPU-bound); no TS equivalent.
- **Polarity-judge LLM** (behind an LLM-provider interface; trust-critical): local → Qwen2.5-7B (Q4) — adequate but weakest here; free → **Groq Llama 3.3 70B**; paid (recommended) → **Claude Opus 4.8** (use adaptive thinking; omit `temperature`/`top_p`).
- **GPU note:** dev GPU is **8GB VRAM**; the O(n²) clustering runs on CPU so the GPU is free for the polarity model. Phases run sequentially via the BullMQ queue.

---

## 1. Architectural Overview

If the engine simply retrieved the top 10 claims nearest to the user's query and summarized them, it would inevitably hallucinate a "middle ground" when presented with conflicting scientific data.

Phase 6 prevents this through a two-stage compute pipeline:

1. **Mathematical Grouping (Unsupervised Learning):** Claims are pulled from the vector database and clustered strictly by semantic proximity.
2. **Logical Evaluation (Supervised Inference):** The resulting clusters are passed as independent contexts to an LLM, which is strictly prompted to evaluate the *polarity* of the claims against each other, rather than answering the user's original question.

### Operational Sequence

1. **Vector Retrieval:** Fetch all claims across the project namespace from Qdrant.
2. **Dimensionality Reduction & Clustering:** Execute statistical clustering on the claim vectors to isolate distinct sub-topics (e.g., separating "latency impacts" from "memory overhead").
3. **Cluster Sanitization:** Filter out noise (isolated claims) and cap cluster sizes to prevent context window overflow.
4. **Polarity Inference:** Feed each valid cluster to the LLM worker pool to classify the relationship (`AGREEMENT`, `CONTRADICTION`, `THIN_EVIDENCE`).
5. **Graph Assembly:** Output a structured Synthesis Graph mapping every claim to its classified topic, ready for final document generation.

---

## 2. Component Architecture

```text
                       ┌───────────────────────────────┐
                       │ Qdrant Vector Engine (Claims) │
                       │       (From Phase 5)          │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │    Vector Fetch & Pre-Filter  │
                       │   (Namespace & Payload Lock)  │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │ Statistical Clustering Engine │
                       │ (Agglomerative / HDBSCAN)     │
                       └───────────────┬───────────────┘
                                       │
                 ┌─────────────────────┴─────────────────────┐
                 ▼                                           ▼
 ┌───────────────────────────────┐             ┌───────────────────────────────┐
 │       Topic Cluster A         │             │       Topic Cluster B         │
 │ (e.g., Latency Improvements)  │             │ (e.g., Memory Overhead Spikes)│
 └───────────────┬───────────────┘             └───────────────┬───────────────┘
                 │                                             │
                 ▼                                             ▼
 ┌───────────────────────────────┐             ┌───────────────────────────────┐
 │   Polarity Inference Worker   │             │   Polarity Inference Worker   │
 │   (LLM Logic Judge)           │             │   (LLM Logic Judge)           │
 └───────────────┬───────────────┘             └───────────────┬───────────────┘
                 │                                             │
                 └─────────────────────┬─────────────────────┘
                                       ▼
                       ┌───────────────────────────────┐
                       │   Synthesis Graph Assembler   │
                       │     (Output to Phase 7)       │
                       └───────────────────────────────┘

```

### 2.1. Vector Fetch & Pre-Filter

Before clustering, the engine queries Qdrant to retrieve the dense vectors and metadata payloads for the active `projectId`.

* **Payload Filtering:** To ensure we are only comparing factual outcomes, the query strictly filters for claims classified as `FINDING`. It explicitly excludes `LIMITATION` or `METHODOLOGY` chunks from the main consensus clustering.

### 2.2. Statistical Clustering Engine (CPU Bound)

The architecture splits the compute load: statistical clustering relies on optimized SciPy and NumPy CPU execution, reserving local GPU resources (like an RTX 3070 Ti's 8GB of VRAM) entirely for the LLM polarity evaluation.

* **Algorithm Selection:** We utilize **Agglomerative Hierarchical Clustering** with Cosine distance. Unlike K-Means, Agglomerative clustering does not require us to pre-determine the number of clusters ($k$).
* **Strict Distance Thresholds:** A strict distance cutoff is applied to the linkage matrix. If the threshold is too loose, unrelated topics merge; if too strict, papers describing the exact same phenomenon are kept apart.

### 2.3. Polarity Inference Worker Pool (GPU Bound)

Once clustered, the claims are reconstructed into text and passed to the LLM.

* **The System Prompt:** The model is stripped of its conversational persona. It is instructed: *"You are a logic parser. Evaluate the following scientific claims. Do they report the same directional outcome (AGREEMENT), directly conflicting outcomes (CONTRADICTION), or is there insufficient data to establish a pattern (THIN_EVIDENCE)?"*
* **Batching Constraints:** To prevent VRAM exhaustion, clusters containing more than 15 claims are sub-divided or summarized via a map-reduce chain before final polarity evaluation.

---

## 3. Data and Interface Contracts

### 3.1. The Polarity Enum

```typescript
enum ClusterPolarity {
  AGREEMENT = "AGREEMENT",
  CONTRADICTION = "CONTRADICTION",
  THIN_EVIDENCE = "THIN_EVIDENCE",
  NOISE = "NOISE" // Unrelated claims that fell into a loose cluster
}

```

### 3.2. Clustered Synthesis Graph (Phase 6 Output)

This structured JSON is the definitive blueprint handed to Phase 7 for drafting the actual research brief.

```json
{
  "projectId": "proj_abc_12356",
  "synthesisGraph": [
    {
      "clusterId": "cluster_01",
      "generatedTopicLabel": "Impact of Micro-caching on Tail Latency",
      "polarity": "CONTRADICTION",
      "claims": [
        {
          "claimId": "cl_uuid_987654",
          "doi": "10.1038/s41586-023-00000-0",
          "text": "Micro-caching reduces p99 tail latency by approximately 40% under standard load."
        },
        {
          "claimId": "cl_uuid_112233",
          "doi": "10.1145/3618257",
          "text": "Under memory-constrained environments, ephemeral caching increases p99 latency by 15% due to garbage collection overhead."
        }
      ]
    },
    {
      "clusterId": "cluster_02",
      "generatedTopicLabel": "CPU Utilization Scaling",
      "polarity": "AGREEMENT",
      "claims": [
        {
          "claimId": "cl_uuid_445566",
          "doi": "10.1038/s41586-023-00000-0",
          "text": "CPU utilization scales linearly with cache deployment."
        },
        {
          "claimId": "cl_uuid_778899",
          "doi": "10.1016/j.jss.2024.01",
          "text": "Processor load maintained a strict 1:1 linear relationship with cached object volume."
        }
      ]
    }
  ]
}

```

---

## 4. Resilience & Performance Strategies

### 4.1. Outlier Rejection (Noise Isolation)

In academic literature, many findings are highly specific and do not relate to the broader dataset.

* If a claim vector does not fall within the defined distance threshold of any cluster, it is flagged as an `OUTLIER`.
* Outliers are not discarded; they are grouped into a secondary `THIN_EVIDENCE` array to be rendered in the final report as "Isolated Findings / Open Areas for Future Study," ensuring no extracted data is silently deleted.

### 4.2. Local VRAM Management

Because this phase utilizes an LLM to evaluate logic, memory pressure is high.

* The worker pool evaluates one cluster sequentially per GPU thread.
* By executing the heavy $O(n^2)$ distance calculations of the clustering algorithms on the CPU via NumPy, the GPU's memory bus remains clear exclusively for transformer tensor operations.

---

## 5. Architectural Verification Matrix

| Metric | Target Boundary | Validation Vector |
| --- | --- | --- |
| **Clustering Execution Time** | $\le 1.5\text{s}$ for 1000 vectors | SciPy Profiler |
| **Cluster Cohesion (Silhouette Score)** | $\ge 0.65$ | Statistical Matrix Audits |
| **Polarity Evaluation Accuracy** | $\ge 95\%$ | Synthetic Contradiction Test Sets |
| **Max VRAM per Inference** | Bounded to model context limits | Hardware Container Telemetry |

---
