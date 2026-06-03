# Architectural Design Document: Phase 3 — Cross-Encoder Re-Ranking

This document establishes the architectural layout and technical specifications for **Phase 3: Cross-Encoder Re-Ranking (The Precision Filter)** within the Academic Paper Discovery and Synthesis Engine.

Phase 3 serves as the intensive validation gate. It accepts the broad deduplicated pool of up to 500 `CandidatePaper` abstracts from Phase 2 and applies a deep-attention Cross-Encoder model to evaluate the exact semantic relationship between the user’s original query and each abstract, narrowing the selection down to the top 15–20 high-fidelity papers.

---

## 1. Architectural Overview

While Phase 2 maximizes recall by fetching hundreds of metadata records through broad lexical and semantic searches, it introduces substantial noise. Standard bi-encoder embeddings match topics but fail to capture strict analytical relevance, logical polarity, or granular context.

Phase 3 eliminates this noise by shifting from independent vector calculations to a joint-input sequence architecture. Because a Cross-Encoder processes the user query and the paper abstract simultaneously, it allows full token-to-token cross-attention. This provides the multi-layered linguistic reasoning necessary to verify if an abstract genuinely addresses or answers the research question before the system initiates expensive full-text PDF retrieval and parsing.

### Operational Sequence

1. **Payload Ingestion:** Receive up to 500 `CandidatePaper` records from Phase 2 alongside the original natural language query from Phase 1.
2. **Tokenization & Sequence Assembly:** Concatenate the query and each individual abstract with classification and separation tokens into a single sequence matrix.
3. **Batched Inference Execution:** Route the structured tensor sequences through a highly optimized local inference worker pool running a specialized cross-encoder transformer model.
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
                       │   [Query] + [SEP] + [Abstract]│
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │   Dynamic Batching Manager    │
                       │   (GPU/VRAM Safety Governor)  │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │    Local Inference Workers    │
                       │    (Cross-Encoder Tensor)     │
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

This component handles the raw string transformations required by the transformer's tokenization layer.

* **Format Generation:** It strips any trailing structural noise from Phase 2 abstracts and formats the input sequence matrix precisely as required by the model architecture:
`[CLS] + Query_Tokens + [SEP] + Abstract_Tokens + [SEP]`
* **Dynamic Padding & Truncation:** To maximize tensor efficiency, sentences are dynamically padded up to the maximum sequence length (typically 512 tokens). Layout-invariant text exceeding this limit is structurally truncated from the end of the abstract.

### 2.2. Dynamic Batching Manager

Cross-encoder inference is computationally expensive. Running 500 forward passes sequentially introduces blocking latency, while dumping all 500 sequences into VRAM simultaneously risks throwing Out-Of-Memory (OOM) exceptions.

* **Adaptive Batch Sizing:** The manager evaluates available system resources and splits the 500-sequence matrix into optimal processing windows (e.g., micro-batches of 16 or 32 sequences).
* **Asynchronous Pinning:** Utilizes pinned memory architectures to stream tensor data smoothly from host RAM to GPU VRAM concurrently while the model executes prior batch layers.

### 2.3. Scoring & Truncation Engine

* **Logit Extraction:** Captures the raw output from the classification head (`logits[0]`).
* **Sigmoid Activation:** Maps the raw real-valued logit into a strict scalar probability range between $0.0000$ and $1.0000$.
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

## 4. Model Selection & Runtime Execution Optimization

### 4.1. Model Architecture Selection

The system utilizes a localized instance of **`BAAI/bge-reranker-large`** or a specialized alternative like **`ms-marco-MiniLM-L-6-v2`** depending on the production host execution profile.

* **`bge-reranker-large` (Preferred for GPU):** 335 million parameters. Delivers state-of-the-art multi-lingual accuracy and excellent differentiation of academic reasoning.
* **`ms-marco-MiniLM-L-6-v2` (Preferred CPU Fallback):** Extremely lightweight, offering high processing velocity with minimal loss in top-20 structural ranking precision.

### 4.2. Runtime Acceleration

To keep processing speeds below critical latency ceilings, the cross-encoder model runs under specific hardware compilation constraints:

* **ONNX Runtime / TensorRT:** The raw PyTorch model weights are compiled into optimized execution graphs (ONNX format or NVIDIA TensorRT engines) to skip dynamic interpreter overhead.
* **FP16 / INT8 Quantization:** Precision is scaled down from FP32 to mixed FP16 (or INT8 for CPU deployments). This cuts memory bandwidth requirements in half and accelerates inference speeds by up to 300% on compatible hardware without degrading re-ranking accuracy.

---

## 5. Resilience & Performance Strategies

### 5.1. The VRAM Safety Valve (OOM Recovery)

If an exceptional payload layout triggers an unexpected CUDA Out-of-Memory error during batch tokenization, the system executes an automated recovery sequence:

1. Immediately flushes the active GPU device cache (`torch.cuda.empty_cache()`).
2. Scales down the micro-batch size by half (e.g., from 32 down to 16).
3. Re-attempts inference execution.
4. If a secondary OOM occurs, execution bypasses the GPU entirely and routes the remaining chunks through an isolated CPU thread execution queue running an INT8-quantized model fallback.

### 5.2. Graceful Degraded Sorting (Bi-Encoder Fallback)

If the local inference worker pool crashes entirely or encounters an unrecoverable structural error:

* The system bypasses Phase 3's attention layer completely.
* It falls back to calculating basic lexical match densities and Jaccard similarity scores between the query and the abstracts using host CPU memory.
* The manifestation payload is generated and flagged with a quality warning parameter: `ranking_method: "LEXICAL_FALLBACK"`.

---

## 6. Architectural Verification Matrix

| Metric | Target Boundary | Validation Vector |
| --- | --- | --- |
| **Max Processing Execution Latency** | $\le 2.5\text{s}$ (For 500 documents on GPU) | Worker Inference Profiler |
| **VRAM Volatility Caps** | $\le 4.0\text{GB}$ peak utilization | Core Hardware Container Telemetry |
| **Top-20 Ranking Accuracy (NDCG@20)** | $\ge 0.88$ | Ground-truth Evaluation Dataset Audits |
| **System Exception Fallback Time** | $\le 500\text{ms}$ to trip safety state | Operational Resilience Injection Tests |

---

This framework ensures that Phase 3 operations cleanly compress the wide search scope of Phase 2 into a precision array, guaranteeing that downstream asset loaders only fetch, stream, and compute the most relevant academic data.
