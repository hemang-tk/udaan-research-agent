# Architectural Design Document: Phase 2 — The Open Graph Gateway

This document establishes the architectural layout and technical specifications for **Phase 2: The Open Graph Gateway (Broad Retrieval)** within the Academic Paper Discovery and Synthesis Engine.

Phase 2 is the boundary layer between the system's internal pipeline and external academic databases. It is responsible for concurrently querying multiple massive pre-indexed graphs (e.g., OpenAlex, Semantic Scholar), normalizing chaotic external JSON schemas into a unified internal representation, and aggressively resolving duplicate records before passing the dataset to the heavy compute layers.

---

## Implementation Stack (finalized)

- **Language:** TypeScript (Node.js 20) — concurrent API fan-out, circuit breakers, dedup.
- **External providers:** OpenAlex, Semantic Scholar, Crossref. Endpoints/keys via env config (no hardcoded host) for deploy portability.
- **No model** — pure I/O, normalization, and entity resolution.

---

## 1. Architectural Overview

External academic APIs are notoriously inconsistent. They suffer from varying latency spikes, unannounced schema changes, and overlapping datasets. Phase 2 acts as a strict, resilient buffer. It guarantees that regardless of which external provider succeeds or fails, the downstream Phase 3 (Cross-Encoder Re-Ranking) always receives a pristine, deduplicated array of paper metadata.

### Operational Sequence

1. **Adapter Dispatch:** The Gateway receives the compiled queries from Phase 1 and concurrently dispatches them to active provider adapters.
2. **Data Normalization:** Raw JSON payloads from external APIs are intercepted, parsed, and mapped into a strict internal `CandidatePaper` Data Transfer Object (DTO).
3. **Quality Filtering:** Records missing critical routing or synthesis data (e.g., null abstracts, null titles) are immediately dropped.
4. **Entity Resolution:** The aggregated pool of records is scanned for duplicates using Primary Key (DOI) and Fuzzy (Cryptographic Hashing) matching.
5. **Conflict Merging:** Duplicates are merged to retain the highest-fidelity metadata fields.

---

## 2. Component Architecture

```text
                       ┌───────────────────────────────┐
                       │ Compiled Discovery Manifest   │
                       │       (From Phase 1)          │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │    Concurrent Dispatcher      │
                       │     (Timeout Enforcer)        │
                       └─┬─────────────┬─────────────┬─┘
                         │             │             │
                 ┌───────▼─────┐ ┌─────▼───────┐ ┌───▼─────────┐
                 │  OpenAlex   │ │ Sem. Scholar│ │  Crossref   │
                 │   Adapter   │ │   Adapter   │ │   Adapter   │
                 └───────┬─────┘ └─────┬───────┘ └───┬─────────┘
                         │             │             │
                       ┌─┴─────────────┴─────────────┴─┐
                       │     Normalization Engine      │
                       │    (Schema Mapping & Drop)    │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │  Entity Resolution (De-Dupe)  │
                       │    (DOI & SHA-256 Hashing)    │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │    Verified Candidate Pool    │
                       │      (Output to Phase 3)      │
                       └───────────────────────────────┘

```

### 2.1. The Adapter Layer (Strategy Pattern)

To protect the core engine from external API changes, Phase 2 strictly implements the Strategy Design Pattern.

* **`IOpenGraphProvider` Interface:** Enforces a standard contract (`fetch_abstracts`).
* **Concrete Adapters:**
* `OpenAlexAdapter`: Utilizes the OpenAlex REST API, parsing its complex inverted-index nested JSON.
* `SemanticScholarAdapter`: Communicates with the Semantic Scholar Graph API, prioritizing semantic vector matching.



### 2.2. Concurrent Dispatcher

* **Asynchronous I/O Pool:** Dispatches network requests in parallel. If querying three providers for 200 results each, all three network calls execute concurrently rather than sequentially.
* **Circuit Breakers:** If an adapter consecutively fails or times out across multiple queries, the dispatcher trips a circuit breaker, temporarily halting requests to that provider to prevent cascading thread exhaustion.

### 2.3. Normalization Engine

A strict mapping border. It transforms disparate schemas into the internal `CandidatePaper` DTO.

* **Data Drop Heuristic:** If an external graph returns a paper without an abstract or a publication year, the Normalization Engine drops the record completely. Phase 3 cannot re-rank a paper without an abstract.

### 2.4. Entity Resolution (Deduplication)

Since OpenAlex and Semantic Scholar index the same core academic journals, overlap is guaranteed.

* **Pass 1: Exact Match (DOI):** Groups all records sharing an identical Digital Object Identifier.
* **Pass 2: Fuzzy Hash Match:** For pre-prints without DOIs, the engine creates a SHA-256 hash of `lowercase(alphanumeric_only(title)) + lowercase(first_author_last_name)`. Records with matching hashes are grouped.
* **Metadata Stitching:** When a duplicate is detected, the engine merges them. It selects the longest abstract, the most complete author list, and the highest citation count from the grouped records to create one "Super DTO."

---

## 3. Data and Interface Contracts

### 3.1. Internal DTO: `CandidatePaper`

This object is the sole data structure allowed to exit Phase 2 and enter Phase 3.

```typescript
interface CandidatePaper {
  internalId: string;         // UUID generated during normalization
  doi: string | null;         // Nullable for pre-prints
  title: string;              // Stripped of HTML/Markdown tags
  abstract: string;           // Minimum 50 characters required
  authors: string[];          // Normalized array of strings (e.g., ["Smith, J.", "Doe, A."])
  publicationDate: string;    // ISO 8601 format (YYYY-MM-DD)
  citationCount: number;      // Used for tie-breaking in edge cases
  sourceProviders: string[];  // e.g., ["OpenAlex", "SemanticScholar"]
  sourceUrls: string[];       // Original metadata API links
}

```

### 3.2. Phase 2 Output

An array of deduplicated `CandidatePaper` objects, typically truncated to a maximum of 500 records to constrain the heavy computational load in Phase 3.

---

## 4. Resilience & Performance Strategies

### 4.1. Strict Timeouts (The 4000ms Rule)

External databases are prone to latency spikes. The Concurrent Dispatcher enforces a hard timeout of $4000\text{ms}$ per provider. If OpenAlex responds in $1000\text{ms}$ but Semantic Scholar hangs, the dispatcher abandons Semantic Scholar for that specific query and proceeds only with OpenAlex data. A delayed response must not freeze the researcher's UI.

### 4.2. Rate Limit & Header Backoff

Academic APIs often utilize `Retry-After` HTTP headers or token bucket rate limiting.

* Adapters actively monitor `X-RateLimit-Remaining` headers.
* If a 429 (Too Many Requests) is returned, the adapter yields and falls back gracefully, relying on the other concurrent providers to supply the dataset.

---

## 5. Architectural Verification Matrix

| Metric | Target Boundary | Validation Vector |
| --- | --- | --- |
| **P95 Latency (Total Phase 2)** | $\le 4.5\text{s}$ | E2E Dispatcher Tracing |
| **Data Normalization Failure Rate** | $\le 2.0\%$ | JSON Schema Validation Logs |
| **Duplicate Leakage Rate** | $\le 1.0\%$ | Post-resolution DOI/Hash Audits |
| **Memory per Dispatch** | $\le 64\text{MB}$ | Heap Analysis during Resolution |
