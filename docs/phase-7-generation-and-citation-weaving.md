# Architectural Design Document: Phase 7 — Constrained Generation & Citation Weaving

This document establishes the architectural layout and technical specifications for **Phase 7: Constrained Generation & Citation Weaving** within the Academic Paper Discovery and Synthesis Engine.

Phase 7 is the final assembly line. It takes the logical structures generated in Phase 6 (agreements, contradictions, and gaps) and translates them into a human-readable Research Brief. This phase strictly neutralizes the LLM's natural tendency to hallucinate smooth transitions or invent facts by enforcing Constrained Extractive Generation and relying on hardcoded deterministic application logic to compile the final citations.

---

## Implementation Stack (finalized)

- **Language:** TypeScript (Node.js 20) — regex citation weaving + deterministic sentence filtering.
- **Generation LLM** (behind an LLM-provider interface; trust-critical): paid (recommended) → **Claude Opus 4.8**; free → Groq Llama 3.3 70B; local → Qwen2.5-7B (Q4). See §4.1 for the provider-dependent determinism settings.

---

## 1. Architectural Overview

The greatest risk to a research synthesis engine is the final generation step. If an LLM is fed a block of claims and told to "write a report," it will inevitably inject external knowledge from its training data, lose track of which paper produced which claim, and fabricate citations.

Phase 7 prevents this by severely restricting the LLM's role. The LLM does not format the final bibliography; it acts merely as a text-weaver, forced to append raw, verifiable `claimId` tags to every sentence it writes. A deterministic application layer then intercepts this text, strips out unverified claims, and dynamically weaves in standard academic citations (e.g., [1], [2]) linked directly to the Phase 5 ingestion metadata.

### Operational Sequence

1. **Payload Ingestion:** Receive the Clustered Synthesis Graph from Phase 6.
2. **Section-by-Section Orchestration:** Split the clusters and dispatch them to independent LLM calls for distinct report sections (e.g., Consensus, Conflicts).
3. **Constrained Generation:** The LLM drafts narrative text, appending the explicit `[`claimId`]` to every factual sentence.
4. **The Hallucination Filter:** A deterministic script parses the output sentence-by-sentence, permanently deleting any sentence that lacks a valid, context-provided `claimId`.
5. **Deterministic Citation Compilation:** The engine replaces the raw ID tags with sequential integers, compiles the bibliography array, and injects interactive deep-links to the original PDFs.

---

## 2. Component Architecture

```text
                       ┌───────────────────────────────┐
                       │   Clustered Synthesis Graph   │
                       │       (From Phase 6)          │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │ Section-by-Section Dispatcher │
                       │ (Splits Agreements vs. Gaps)  │
                       └─┬─────────────┬─────────────┬─┘
                         │             │             │
                 ┌───────▼─────┐ ┌─────▼───────┐ ┌───▼─────────┐
                 │  Consensus  │ │ Contradiction │ │ Literature  │
                 │   Writer    │ │    Writer     │ │    Gaps     │
                 └───────┬─────┘ └─────┬───────┘ └───┬─────────┘
                         │             │             │
                       ┌─┴─────────────┴─────────────┴─┐
                       │     The Hallucination Filter  │
                       │  (Sentence & Tag Validation)  │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │       Executive Summary       │
                       │      (Generated Last)         │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │ Deterministic Citation Weaver │
                       │(Regex Tag -> Numeric Mapping) │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │     Final Research Brief      │
                       │      (Output to UI Client)    │
                       └───────────────────────────────┘

```

### 2.1. Section-by-Section Dispatcher

Writing the entire brief in one LLM call dilutes context and degrades instruction following. The Dispatcher routes specific data to isolated prompts:

* **Consensus Writer:** Receives only clusters tagged `AGREEMENT`. Prompted to synthesize overlapping findings.
* **Contradiction Writer:** Receives only clusters tagged `CONTRADICTION`. Prompted to highlight exact methodological or outcome friction points.
* **Executive Summary:** Triggered *only after* the other sections pass validation. It is fed the validated outputs of the prior sections, ensuring it cannot introduce new data.

### 2.2. Constrained Generation Engine & Hallucination Filter

The LLM is given a strict system prompt: *"Synthesize these claims. You may not add external knowledge. Every factual sentence MUST end with the provided Claim ID."*

* **The Output Syntax:** `Micro-caching degrades p99 latency under heavy load [cl_uuid_112233].`
* **Sentence Parsing (The Drop Rule):** A Python/Node script tokenizes the generated text into sentences using NLP boundaries. It runs a regex check on every sentence for the `[cl_uuid_*]` pattern.
* **Validation:** If a sentence contains a claim but lacks a tag, or invents a tag that wasn't in the Phase 6 payload, that sentence is instantly dropped from the output stream.

### 2.3. Deterministic Citation Weaver

The AI's job finishes at the Hallucination Filter. Standard software logic finalizes the brief.

* **Tag Replacement:** A regex engine scans the validated text, replacing `[cl_uuid_987654]` with `[1]`, `[cl_uuid_112233]` with `[2]`, etc.
* **Bibliography Compilation:** The Weaver queries the local database using the validated `claimIds` to retrieve the parent `CandidatePaper` metadata (Title, Authors, DOI, Page Number, Exact Quote) and builds the final Reference array.

---

## 3. Data and Interface Contracts

### 3.1. Final Research Brief (Phase 7 Output)

This is the ultimate deliverable served to the frontend application. The structured JSON ensures the UI can render rich, interactive citations.

```json
{
  "projectId": "proj_abc_12356",
  "metadata": {
    "generatedAt": "2026-06-03T11:17:06Z",
    "totalPapersSynthesized": 18,
    "totalClaimsExtracted": 42
  },
  "sections": [
    {
      "heading": "Conflicts in the Literature",
      "bodyText": "There is significant disagreement regarding the impact of micro-caching on latency under heavy load. Two studies observed a 40% reduction in p99 latency during standard operation [1][2]. However, recent load-testing models contradict this, showing severe latency degradation when memory constraints are breached [3]."
    }
  ],
  "bibliography": {
    "1": {
      "claimId": "cl_uuid_987654",
      "authors": "Smith et al.",
      "year": 2023,
      "title": "Optimizing Tail Latencies in Distributed Key-Value Topologies",
      "doi": "10.1038/s41586-023-00000-0",
      "page": 6,
      "exactQuote": "In our experimental topology, the implementation of ephemeral micro-caching resulted in a 40.2% reduction in p99 tail latency."
    },
    "2": {
      "claimId": "cl_uuid_554433",
      "authors": "Chen, L.",
      "year": 2024,
      "title": "Bounded Latency via Ephemeral Caching Strategies",
      "doi": "10.1145/3618257",
      "page": 12,
      "exactQuote": "Sub-millisecond caching significantly decreases tail latency during steady-state traffic."
    },
    "3": {
      "claimId": "cl_uuid_112233",
      "authors": "Doe, J. & Lee, M.",
      "year": 2024,
      "title": "Memory Overhead in Ephemeral Caches",
      "doi": "10.1016/j.sys.2024.03",
      "page": 8,
      "exactQuote": "Under memory-constrained environments, ephemeral caching increases p99 latency by 15% due to garbage collection overhead."
    }
  }
}

```

---

## 4. Resilience & Performance Strategies

### 4.1. Inference Constraints (Deterministic Generation)

To ensure maximum adherence to the structural tags, creativity is explicitly disabled; the engine prioritizes mechanical synthesis and precise instruction following. The exact knob is **provider-dependent**:

* **Local / Gemini / Groq providers:** set `temperature = 0.0` (and `top_p = 0.1`).
* **Claude (Opus 4.8 / 4.7 / Fable 5):** `temperature` and `top_p` are not accepted and return a 400 — do not send them. Use adaptive thinking (`thinking: {type: "adaptive"}`) instead; the model is already low-variance for this mechanical, instruction-bound task.

### 4.2. Over-Generation and Pruning

Because the Hallucination Filter drops sentences, a generated paragraph might become disjointed if the middle sentence is deleted for lacking a citation.

* To counter this, the LLM is prompted to write in highly atomic, independent sentences rather than flowing compound sentences dependent on pronoun resolution.
* If a section drops more than 30% of its sentences during validation, the system triggers a background retry for that specific section before serving the final brief to the user.

---

## 5. Architectural Verification Matrix

| Metric | Target Boundary | Validation Vector |
| --- | --- | --- |
| **Unattributed Claim Leakage** | $0.00\%$ | RegEx sentence tag verification |
| **Citation Misalignment** | $0.00\%$ | Unit Tests mapping output tag to input UUID |
| **Document Assembly Time** | $\le 5.0\text{s}$ (Parallel LLM Calls) | Tracing logs on dispatcher threads |
| **Sentence Preservation Rate** | $\ge 90\%$ passing validation | Telemetry on Hallucination Filter drops |
