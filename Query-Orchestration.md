# Architectural Design Document: Phase 1 — Query Orchestration & Translation

This document establishes the architectural layout and technical specifications for **Phase 1: Query Orchestration & Translation** within the Academic Paper Discovery and Synthesis Engine.

Phase 1 serves as the ingest gateway for natural language user intent, translating unstructured queries into highly optimized structured payloads optimized for legacy academic graph APIs and dense vector search engines.

---

## 1. Architectural Overview

Natural language research queries are often conversational, ambiguous, or conceptually clustered. Conversely, public academic graphs (such as OpenAlex and Semantic Scholar) rely on precise lexical parameters, boolean operators, or constrained entity filters.

Phase 1 bridges this gap using a decoupled pipeline that acts as a deterministic compiler for user intent.

### Operational Sequence

1. **Ingest & Sanitize:** Accept the natural language string and strip non-searchable or malicious characters.
2. **Intent & Constraint Extraction:** Route to a lightweight, high-speed LLM context to tokenize structural constraints (e.g., human vs. animal trials, temporal bounds).
3. **Keyword Expansion & Synchronic Mapping:** Map core concepts to medical/scientific vocabularies (e.g., MeSH terms, IEEE taxonomy) and generate localized synonyms.
4. **Target Syntax Compilation:** Build target-specific query abstractions (Lucine queries, boolean sequences, or raw embeddings vectors).

---

## 2. Component Architecture

```
                       ┌─────────────────────────┐
                       │  User Natural Language  │
                       └────────────┬────────────┘
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │  Query Ingestion Guard  │
                       └────────────┬────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  Intent Optimization Engine   │
                    │      (LLM Context Worker)     │
                    └───────────────┬───────────────┘
                                    │
            ┌───────────────────────┴───────────────────────┐
            ▼                                               ▼
┌───────────────────────┐                       ┌───────────────────────┐
│ Lexical Query Builder │                       │ Semantic Vector Prep  │
│  (Boolean Generator)  │                       │  (Embedding Wrapper)  │
└───────────┬───────────┘                       └───────────┬───────────┘
            │                                               │
            └───────────────────────┬───────────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │  Compiled Discovery Manifest  │
                    │     (Output to Phase 2)       │
                    └───────────────────────────────┘

```

### 2.1. Ingestion Guard & Validation Layer

A non-blocking validator evaluating incoming requests before hitting downstream model contexts.

* **Scope Gatekeeper:** A hard-coded heuristic classifier filtering out conversational noise, prompt injection attempts, or non-research text (e.g., requests to write code or generic web search tasks).
* **Token Controller:** Truncates input values at 500 characters to prevent deliberate Denial of Service (DoS) exploits disguised as long-tail research descriptions.

### 2.2. Intent Optimization Engine (LLM Context Worker)

A structured, zero-temperature inference step using a fast model (e.g., Gemini 1.5 Flash). It processes the raw query using defensive system constraints to emit a uniform JSON schema.

* **Concept Isolation:** Splitting compound research questions into discrete sub-concepts.
* **Temporal and Structural Extraction:** Parsing implicit limits. If the user asks for *"recent breakthroughs since 2024,"* the engine extracts `{"start_year": 2024}`.

### 2.3. Lexical Query Compiler

Converts isolated sub-concepts into multi-layered Boolean strings optimized for legacy search indexes.

* **Expansion Heuristics:** Maps terms to common academic variants (e.g., "micro-caching" expands to `("micro-caching" OR "ephemeral caching" OR "tail-latency caching")`).
* **Syntax Synthesizer:** Operates as a factory class emitting unique string formats per target platform (e.g., Lucine dialect for Elasticsearch/OpenAlex vs. standard boolean for Semantic Scholar).

---

## 3. Data and Interface Contracts

To keep Phase 1 decoupled from the Phase 2 Aggregated Search Gateway, the output must adhere to a strict, immutable contract interface.

### 3.1. Incoming Request Interface

```typescript
interface IResearchQueryRequest {
  userId: string;
  projectId: string;
  rawQuery: string;
  timestamp: string; // ISO 8601
}

```

### 3.2. Compiled Discovery Manifest (Phase 1 Output)

This structured JSON is passed directly to the Phase 2 orchestrator.

```json
{
  "projectId": "proj_abc_12356",
  "searchContext": {
    "originalQuery": "How does micro-caching impact p99 tail latency in distributed stateful architectures since 2022?",
    "temporalBounds": {
      "startYear": 2022,
      "endYear": 2026
    },
    "coreConcepts": [
      "micro-caching",
      "p99 tail latency",
      "distributed stateful architectures"
    ]
  },
  "compilations": {
    "booleanStandard": "(\"micro-caching\" OR \"ephemeral cache\") AND (\"p99 latency\" OR \"tail latency\" OR \"bounded latency\") AND (\"distributed system\" OR \"stateful architecture\")",
    "openAlexFilter": "default_search:(\"micro-caching\" OR \"ephemeral cache\") AND abstracts_search:(\"p99\" OR \"tail latency\"),from_publication_date:2022-01-01",
    "semanticScholarPayload": {
      "query": "micro-caching tail latency distributed stateful systems",
      "fields": ["title", "abstract", "year", "citationCount", "externalIds"]
    }
  },
  "telemetry": {
    "inputTokens": 24,
    "classificationStatus": "VALIDATED_RESEARCH_INTENT"
  }
}

```

---

## 4. Resilience & Performance Strategies

### 4.1. Caching Strategy (Deterministic Optimization)

* **Query Hash Cache:** Before invoking the LLM Context Worker, a SHA-256 hash of the normalized, lowercase `rawQuery` is checked against Redis. If an identical query was compiled within the last 24 hours, the system skips downstream LLM execution and serves the cached `CompiledDiscoveryManifest`.

### 4.2. Failover and Degraded States

* **Inference Outage (LLM Fallback):** If the LLM engine times out or encounters a 5xx rate-limiting wall, the system switches to a deterministic regex-based tokenizer. It strips punctuation, extracts stop words, joins terms via standard `AND` syntax, and pipes it straight to Phase 2. The job is marked with a telemetry flag: `degraded_mode: true`.
* **Schema Enforcement Validation:** If the LLM returns unstructured text instead of the requested JSON schema, a structural catch block instantly catches the exception, forces a retry with an explicit JSON-repair instruction, or gracefully falls back to the deterministic tokenizer.

---

## 5. Architectural Verification Matrix

To ensure Phase 1 meets design performance constraints, its execution profile must align with these boundaries:

| Metric | Target Boundary | Validation Vector |
| --- | --- | --- |
| **Max End-to-End Latency** | $\le 800\text{ms}$ (Cache Miss) | API Gateway Telemetry Tracing |
| **Parsing Success Rate** | $\ge 99.2\%$ | Schema Validation Testing |
| **False Rejection Rate** | $\le 0.5\%$ | Human-in-the-loop Evaluation Log |
| **Memory Footprint** | Static ($\le 128\text{MB}$ per worker) | Container Runtime Resource Analysis |

---

This architectural framework ensures Phase 1 processes user queries accurately and resiliently, laying a stable foundation for the data gathering in Phase 2.
