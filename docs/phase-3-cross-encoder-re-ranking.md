# Architectural Design Document: Phase 3 — Cross-Encoder Re-Ranking

This document establishes the architectural layout and technical specifications for **Phase 3: Cross-Encoder Re-Ranking (The Precision Filter)** within the Academic Paper Discovery and Synthesis Engine.

Phase 3 serves as the intensive validation gate. It accepts the broad deduplicated pool of up to 500 `CandidatePaper` abstracts from Phase 2 and applies a deep-attention Cross-Encoder model to evaluate the exact semantic relationship between the user’s original query and each abstract, narrowing the selection down to the top 15–20 high-fidelity papers.

---

## Implementation Stack (finalized)

- **Language:** Python service (FastAPI) — thin wrapper around the hosted re-rank API.
- **Re-ranker** (behind a `RERANK_PROVIDER` interface): **Cohere `rerank-v3.5`**, a
  hosted cross-encoder accessed via API. No local model weights or GPU are
  required on main. The self-hosted variant — a local BGE cross-encoder
  (`BAAI/bge-reranker-base`/`-large`, `ms-marco-MiniLM-L-6-v2`) with a lexical
  fallback — lives on the `local-infra` branch.
- **Execution:** the pipeline runs in-process inside a single container, so Phase
  3 simply calls the Cohere API; there is no queue or GPU to schedule.

---

## 1. Architectural Overview

While Phase 2 maximizes recall by fetching hundreds of metadata records through broad lexical and semantic searches, it introduces substantial noise. Standard bi-encoder embeddings match topics but fail to capture strict analytical relevance, logical polarity, or granular context.

Phase 3 eliminates this noise by shifting from independent vector calculations to a joint-input sequence architecture. Because a Cross-Encoder processes the user query and the paper abstract simultaneously, it allows full token-to-token cross-attention. This provides the multi-layered linguistic reasoning necessary to verify if an abstract genuinely addresses or answers the research question before the system initiates expensive full-text PDF retrieval and parsing.

### Operational Sequence

1. **Payload Ingestion:** Receive up to 500 `CandidatePaper` records from Phase 2 alongside the original natural language query from Phase 1.
2. **Tokenization & Sequence Assembly:** Concatenate the query and each individual abstract with classification and separation tokens into a single sequence matrix.
3. **Batched Inference Execution:** Send the query/abstract pairs to the hosted Cohere `rerank-v3.5` cross-encoder, which scores each pair under full query-to-document cross-attention.
4. **Scoring & Normalization:** Extract the raw logits, pass them through a sigmoid activation layer, and assign a deterministic relevance score $[0, 1]$ to each paper.
5. **Truncation & Stratification:** Sort the array dynamically, filter out papers falling below a defined absolute quality floor, and truncate the output to the top 15–20 definitive candidate records.

---

## 2. Component Architecture

```text
                       ┌───────────────────────────────┐
                       │  Verified Candidate Pool (500)│
                       │       (From Phase 2)          │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │   Sequence Assembly Engine    │
                       │   query + each abstract pair  │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │   Request Batching Manager    │
                       │   (chunk + rate-limit guard)  │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │  Cohere rerank-v3.5 (hosted)  │
                       │   (Cross-Encoder via API)     │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │  Scoring & Truncation Engine  │
                       │   (Sigmoid -> Sort -> Filter) │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │  Prioritized Ingestion Index  │
                       │      (Output to Phase 4)      │
                       └───────────────────────────────┘

```

### 2.1. Sequence Assembly Engine

This component prepares the query/document pairs the hosted cross-encoder scores.

* **Format Generation:** It strips any trailing structural noise from Phase 2 abstracts and pairs the original query with each abstract as the `query` + `documents` payload the rerank API expects.
* **Length Guarding:** Abstracts are trimmed so each document stays within the model's input limit; text exceeding it is truncated from the end of the abstract.

### 2.2. Request Batching Manager

The rerank API is called once per query with the full candidate set, but large pools and free-tier rate limits make naive single-shot calls fragile.

* **Adaptive Chunking:** The manager splits the candidate pool into bounded request windows when the set is large, then merges the scored results.
* **Rate-Limit Guard:** Requests respect the provider's rate limits with backoff, so a burst of candidates never trips a 429 and stalls the pipeline.

### 2.3. Scoring & Truncation Engine

* **Score Extraction:** Reads the normalized relevance score the rerank API returns for each document (a scalar in $[0, 1]$); no local logit/sigmoid step is needed.
* **The Static Floor Filter:** Discards any paper scoring below an absolute relevance value of $0.5000$, classifying it as contextual background noise rather than a direct data match.

---

## 3. Data and Interface Contracts

### 3.1. Phase 3 Input Registration

```typescript
interface ICrossEncoderPayload {
  originalQuery: string;
  candidatePapers: CandidatePaper[]; // Array bounded to a maximum size of 500
}

```

### 3.2. Prioritized Ingestion Index (Phase 3 Output)

The payload emitted from Phase 3 to drive the Just-In-Time resolution loops in Phase 4.

```json
{
  "projectId": "proj_abc_12356",
  "totalProcessed": 500,
  "totalFiltered": 18,
  "rankedManifest": [
    {
      "rank": 1,
      "relevanceScore": 0.9642,
      "internalId": "5fa85f64-5717-4562-b3fc-2c963f66afa6",
      "doi": "10.1038/s41586-023-00000-0",
      "title": "Optimizing Tail Latencies in Distributed Key-Value Topologies",
      "abstract": "We present an evaluation of micro-caching mechanisms. Our data shows a reduction in p99 tail latency across stateful network boundaries...",
      "publicationDate": "2023-11-14"
    },
    {
      "rank": 2,
      "relevanceScore": 0.9128,
      "internalId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "doi": "10.1145/3618257",
      "title": "Bounded Latency via Ephemeral Caching Strategies",
      "abstract": "Mitigating p99 latency spikes requires volatile caching frameworks inside distributed stateful architectures...",
      "publicationDate": "2024-02-10"
    }
  ]
}

```

---

## 4. Model Selection & Runtime Execution

### 4.1. Model Selection

The system uses **Cohere `rerank-v3.5`**, a hosted cross-encoder, behind the
`RERANK_PROVIDER` interface. Because the model is served over an API, main carries
no model weights, no GPU dependency, and no per-host execution profile to tune.

* **`rerank-v3.5` (hosted):** a managed cross-encoder that jointly attends over the query and each document, delivering the analytical relevance discrimination Phase 3 needs to compress the wide Phase 2 pool to the top 15–20.
* **Self-hosted alternatives** (`bge-reranker-base`/`-large`, `ms-marco-MiniLM-L-6-v2`) sit behind the same provider interface on the `local-infra` branch, for offline runs without an API.

### 4.2. Runtime Characteristics

Since inference happens on Cohere's infrastructure, Phase 3's runtime cost on main
is dominated by network round-trips rather than local tensor execution:

* **Stateless calls:** the service holds no model in memory, so it starts instantly and stays light on the shared HF CPU container.
* **Throughput via batching:** large candidate pools are chunked across requests (see 2.2) and merged, keeping each call within the provider's size and rate limits.

---

## 5. Resilience & Performance Strategies

### 5.1. Rate-Limit & Payload Recovery

If a rerank request is rejected for being too large or for tripping a rate limit, the service executes an automated recovery sequence:

1. On a 429 / rate-limit signal, it backs off and retries with jitter.
2. On an oversized-payload error, it halves the request window (fewer documents per call) and re-submits.
3. Partial results from successful chunks are retained and merged so a single failed window never discards the whole pool.

### 5.2. Transient-Error Handling

If the rerank API is briefly unreachable or returns a transient 5xx:

* The service retries with exponential backoff within the phase's latency budget.
* On persistent failure it surfaces the error to the pipeline rather than silently degrading, so a run never ships an unranked pool as if it were ranked.

> The self-hosted lexical/bi-encoder degraded-sort fallback lives on the
> `local-infra` branch, where there is no external API to fall back from.

---

## 6. Architectural Verification Matrix

| Metric | Target Boundary | Validation Vector |
| --- | --- | --- |
| **Max Processing Execution Latency** | $\le 2.5\text{s}$ (For 500 documents, incl. API round-trips) | Phase Timing Telemetry |
| **Container Memory Overhead** | Negligible (stateless API client, no model resident) | Container Runtime Telemetry |
| **Top-20 Ranking Accuracy (NDCG@20)** | $\ge 0.88$ | Ground-truth Evaluation Dataset Audits |
| **Rate-Limit Recovery Time** | $\le 500\text{ms}$ to back off and retry | Operational Resilience Injection Tests |

---

This framework ensures that Phase 3 operations cleanly compress the wide search scope of Phase 2 into a precision array, guaranteeing that downstream asset loaders only fetch, stream, and compute the most relevant academic data.
