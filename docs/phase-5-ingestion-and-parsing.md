# Architectural Design Document: Phase 5 — Ingestion & Parsing

This document establishes the architectural layout and technical specifications for **Phase 5: Ingestion & Parsing** within the Academic Paper Discovery and Synthesis Engine.

Phase 5 transforms raw, unstructured physical assets (PDFs) into highly structured, context-aware, and discrete semantic claims. This phase solves the "context-loss" problem inherent in standard RAG pipelines by replacing character-based chunking with layout-aware structural parsing, culminating in the secure storage of verifiable facts within a vector database.

---

## Implementation Stack (finalized)

- **Language:** Python service (FastAPI) — orchestrates parsing, chunking, claim extraction, and vectorization.
- **Parsing:** **LlamaParse** via API — layout-aware PDF parsing that underpins quote-anchored traceability. The self-hosted variant (Docling) lives on the `local-infra` branch.
- **Embeddings** (behind an `EmbeddingProvider` interface): **Cohere `embed-english-v3.0`** (1024-dim) via API. The same embeddings power both the claim vectors used by synthesis and the full-text chunk vectors used by the "ask these papers" RAG chat. The self-hosted variant (sentence-transformers, e.g. `bge-base-en-v1.5`) lives on the `local-infra` branch.
- **Claim-extraction LLM** (behind the `LLM_PROVIDER` interface): hosted APIs — **Groq / Gemini / Anthropic** (default `anthropic`). The self-hosted variant (Ollama-served Qwen2.5) lives on the `local-infra` branch.
- **Vector store:** **Qdrant Cloud**. The self-hosted variant (a local Qdrant container) lives on the `local-infra` branch.

---

## 1. Architectural Overview

Standard ingestion pipelines (like those relying on basic PyPDF or naive OCR) fail catastrophically on academic papers. Two-column layouts get scrambled, floating tables interrupt paragraphs, and mathematical formulas are reduced to gibberish. If the text extraction is corrupted, the downstream claim extraction will hallucinate.

To guarantee zero-hallucination traceability, Phase 5 enforces a rigid pipeline: **Layout Analysis $\rightarrow$ Semantic Boundary Chunking $\rightarrow$ LLM Claim Extraction $\rightarrow$ Vectorization.** Every single data point extracted here retains a hardcoded pointer back to its exact physical location in the original PDF.

### Operational Sequence

1. **Asset Retrieval:** The system pulls the target PDF from the secure Object Storage vault established in Phase 4.
2. **Layout-Aware Parsing:** The PDF is processed through LlamaParse to reconstruct its hierarchical academic structure (sections, paragraphs, tables).
3. **Context-Preserving Chunking:** The document is sliced exactly along structural boundaries (e.g., end of a paragraph), appending rich lineage metadata to every chunk.
4. **Extraction Workers:** Asynchronous LLM workers read each chunk and extract discrete JSON claims (`FINDING`, `LIMITATION`, etc.), forcing an exact substring quote match.
5. **Vector Storage:** The validated claims are embedded (Cohere) and stored in Qdrant with extensive payload indexing for high-speed downstream filtering. The full-text chunks are embedded and stored too, so the "ask these papers" RAG chat can retrieve passages from the same corpus.

---

## 2. Component Architecture

```text
                       ┌───────────────────────────────┐
                       │      Resolution Manifest      │
                       │       (From Phase 4)          │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │   LlamaParse Layout Parser    │
                       │ (Hierarchical Tree Assembly)  │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │  Semantic Boundary Chunker    │
                       │  (Paragraph/Table Isolation)  │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │  Extraction Worker Pool (LLM) │
                       │  (Strict JSON / Quote Match)  │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │  Embedding & Indexing Engine  │
                       │     (Vector Generation)       │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │      Qdrant Vector Engine     │
                       │     (Dense + Payload Index)   │
                       └───────────────────────────────┘

```

### 2.1. The Layout-Aware Parser (LlamaParse)

Instead of flattening the document into a single string, the system uses LlamaParse to perform deep layout analysis via its API.

* **Reading-Order Resolution:** LlamaParse natively understands two-column academic formats and stitches sentences together correctly across columns and page breaks.
* **Table Reconstruction:** Tables are not converted to messy inline text. They are detected and emitted as structured Markdown/HTML tables, preserving the relationships between column headers and data rows.

> The self-hosted parser (Docling, with DocLayNet/TableFormer models running
> locally) lives on the `local-infra` branch; on main, parsing is a hosted API
> call, so the service carries no parsing model weights.

### 2.2. Context-Preserving Chunker

Standard RAG systems chunk by token count (e.g., 512 tokens). This breaks sentences and divorces results from their methodological context.

* **Structural Slicing:** This chunker only breaks text at explicit structural nodes from the parser (e.g., `Paragraph`, `List Item`, `Table`).
* **Lineage Injection:** Every chunk is injected with a metadata header describing its exact location. If a chunk is taken from page 4, the chunk knows it belongs to the *Results* section, allowing the system to filter out "Findings" that were accidentally pulled from the *Literature Review*.

### 2.3. Extraction Worker Pool (The LLM Gateway)

This is where unstructured text becomes structured data. Asynchronous workers pass the chunks to a generative model configured for strict extraction.

* **The Directive:** The LLM does not summarize. It evaluates the chunk to find discrete, factual propositions.
* **The Quote Anchor:** For every claim the LLM generates, it must return the `source_quote`—an exact, unmodified substring from the chunk. A deterministic validation script checks if `chunk.includes(source_quote)`. If false, the claim is dropped entirely.

---

## 3. Data and Interface Contracts

### 3.1. The Validated Claim Schema (Phase 5 Output)

This is the atomic unit of the entire Synthesis Engine. This schema is what gets embedded and shipped to Qdrant.

```json
{
  "claimId": "cl_uuid_987654",
  "projectId": "proj_abc_12356",
  "documentDoi": "10.1038/s41586-023-00000-0",
  "claimClassification": "FINDING", 
  "claimText": "Micro-caching reduces p99 tail latency by approximately 40% under standard load.",
  "sourceQuote": "In our experimental topology, the implementation of ephemeral micro-caching resulted in a 40.2% reduction in p99 tail latency.",
  "lineage": {
    "section": "Results",
    "subSection": "3.2 Latency Impact",
    "pageNumber": 6,
    "structuralNodeType": "paragraph"
  },
  "vectorEmbedding": [0.012, -0.045, 0.887, ...] 
}

```

*(Note: Permitted classifications are strictly limited to `FINDING`, `HYPOTHESIS`, `LIMITATION`, and `METHODOLOGY`.)*

---

## 4. Qdrant Vector Engine Configurations

Storing these claims efficiently is critical for the Phase 6 clustering algorithms. We configure Qdrant to optimize for both dense vector search and heavy metadata filtering.

### 4.1. Payload Indexing

A query during Phase 6 might ask to group all claims across the project, but *only* if they are classified as a `FINDING`.

* We apply explicit **Payload Indexes** in Qdrant on the `projectId`, `documentDoi`, and `claimClassification` fields.
* This allows the database to perform high-speed pre-filtering. Instead of calculating vector distances across the whole database, Qdrant instantly narrows the search space to the specific project's findings before running the Cosine Similarity math.

### 4.2. HNSW & Quantization

* The collection utilizes an HNSW (Hierarchical Navigable Small World) index for low-latency nearest neighbor search.
* To optimize memory footprint as the micro-corpus grows, vectors are stored using Scalar Quantization (INT8), heavily reducing RAM requirements with negligible impact on retrieval accuracy.

---

## 5. Resilience & Performance Strategies

### 5.1. Concurrency and Rate Limiting

* **Batch LLM Execution:** Extracting claims from thousands of chunks will quickly hit LLM API rate limits. The Worker Pool implements a token-bucket rate limiter and exponential backoff.
* **Corrupted Chunk Handling:** If a PDF is poorly scanned and the parser outputs garbage text (e.g., overlapping font glyphs), the LLM will likely fail the `source_quote` substring match. The system logs the chunk as `UNPARSABLE` and moves on, prioritizing high-confidence data over noisy data.

### 5.2. Idempotency

The ingestion pipeline is strictly idempotent. If the server crashes mid-extraction for a specific PDF, the pipeline drops any orphaned claims for that specific `documentDoi` in Qdrant and restarts the parsing job from the beginning, ensuring no duplicate claims ever enter the vector space.
