# Architectural Design Document: Phase 4 — Just-In-Time (JIT) Full-Text Resolution

This document establishes the architectural layout and technical specifications for **Phase 4: Just-In-Time (JIT) Full-Text Resolution** within the Academic Paper Discovery and Synthesis Engine.

Phase 4 is the operational bridge between metadata and physical data. It accepts the truncated, highly ranked pool of 15–20 `CandidatePaper` records from Phase 3 and securely resolves, downloads, and sanitizes the actual PDF documents required for deep-claim extraction.

Crucially, this phase is designed to operate strictly within legal boundaries, respecting paywalls and publisher rights, while providing a seamless fallback mechanism for user-provided access.

---

## 1. Architectural Overview

Downloading PDFs introduces severe I/O bottlenecks, network unreliability, and security vulnerabilities (e.g., malicious files or HTML login walls masking as PDFs). If the engine attempted to download all 500 papers from Phase 2, the system would collapse under bandwidth constraints and IP bans.

Because we only execute Phase 4 on the top 20 validated papers, we can deploy a highly aggressive, concurrent, multi-track resolution strategy. This phase minimizes RAM bloat by streaming bytes directly to object storage rather than loading documents into application memory.

### Operational Sequence

1. **Payload Ingestion:** Receive the top 20 ranked papers from Phase 3.
2. **Resolution Routing:** Evaluate each DOI and route it through a multi-track lookup (Local Cache $\rightarrow$ Direct API $\rightarrow$ Unpaywall Aggregator).
3. **Streaming Download:** For resolved URLs, dispatch asynchronous workers to stream the PDF bytes directly into secure object storage.
4. **Sanitization:** Verify MIME types and PDF magic numbers on the fly to prevent ingestion pipeline poisoning.
5. **Paywall Isolation:** Flag unresolved papers and route them to a User Interception Queue, allowing the researcher to manually upload the missing PDFs.

---

## 2. Component Architecture

```text
                       ┌───────────────────────────────┐
                       │  Prioritized Ingestion Index  │
                       │       (From Phase 3)          │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │      Resolution Router        │
                       │     (DOI & Source Routing)    │
                       └─┬─────────────┬─────────────┬─┘
                         │             │             │
                 ┌───────▼─────┐ ┌─────▼───────┐ ┌───▼─────────┐
                 │ Local Cache │ │ Direct APIs │ │ Unpaywall   │
                 │   Lookup    │ │ (arXiv/PMC) │ │  Aggregator │
                 └───────┬─────┘ └─────┬───────┘ └───┬─────────┘
                         │             │             │
                       ┌─┴─────────────┴─────────────┴─┐
                       │     Download Worker Pool      │
                       │  (Async Network I/O Streams)  │
                       └───────────────┬───────────────┘
                                       │
                 ┌─────────────────────┴─────────────────────┐
                 ▼ (Success: Open Access)                    ▼ (Fail: Paywall)
 ┌───────────────────────────────┐             ┌───────────────────────────────┐
 │   File Sanitization Filter    │             │    User Interception Queue    │
 │   (MIME & Magic Number Check) │             │  (Manual PDF Upload Request)  │
 └───────────────┬───────────────┘             └───────────────┬───────────────┘
                 │                                             │
                 ▼                                             ▼
 ┌───────────────────────────────┐             ┌───────────────────────────────┐
 │ Cloud Object Storage (S3/GCS) │             │    Resolution Manifest        │
 │  (Immutable PDF Vault)        │────────────▶│     (Output to Phase 5)       │
 └───────────────────────────────┘             └───────────────────────────────┘

```

### 2.1. Multi-Track Resolvers

The system maximizes the open-access hit rate by employing a waterfall resolution strategy for each paper:

* **Track A: Local Cache Check (Zero Latency):** Queries our internal Object Storage DB to see if the DOI has already been downloaded and processed by another session. If a match is found, the system creates a pointer to the existing file, skipping the download entirely.
* **Track B: Direct Crawlers (High Reliability):** For specific prefixes (e.g., `10.48550/arXiv...`), the router bypasses third-party APIs and constructs the direct publisher download URL (e.g., `[https://arxiv.org/pdf/](https://arxiv.org/pdf/){id}.pdf`).
* **Track C: Unpaywall API (The Global Net):** Queries the Unpaywall database using the DOI. If the paper has an open-access version anywhere on the web (institutional repositories, pre-print servers), Unpaywall returns the `best_oa_location.url`.

### 2.2. Async Download Worker Pool

* **Streaming Architecture:** Workers do not load the file into Node.js/Python RAM. They open a network stream from the publisher and pipe it directly to the Cloud Object Storage SDK (e.g., AWS S3 multipart upload). This ensures that downloading 20 PDFs of 15MB each does not cause a 300MB memory spike on the application server.

### 2.3. Paywall State Machine & User Queue

Not every paper is free. The engine tracks the state of each document: `PENDING` $\rightarrow$ `RESOLVING` $\rightarrow$ `RESOLVED` or `PAYWALLED`.

* Papers that hit `PAYWALLED` are isolated.
* The system emits an intercept payload to the UI, allowing the frontend to say: *"I found this critical Nature paper, but it is paywalled. If you have institutional access, drag and drop the PDF here."*

---

## 3. Data and Interface Contracts

### 3.1. Internal State Machine Interface

```typescript
enum ResolutionStatus {
  PENDING = "PENDING",
  RESOLVED_CACHE = "RESOLVED_CACHE",
  RESOLVED_DOWNLOAD = "RESOLVED_DOWNLOAD",
  PAYWALLED = "PAYWALLED",
  FAILED_CORRUPTED = "FAILED_CORRUPTED"
}

```

### 3.2. Phase 4 Output (Resolution Manifest)

This payload is passed to Phase 5 (Local Ingestion & Parsing) to instruct the Docling parsers on where to find the physical files.

```json
{
  "projectId": "proj_abc_12356",
  "resolutionSummary": {
    "totalRequested": 18,
    "successfullyResolved": 15,
    "paywalled": 3
  },
  "manifest": [
    {
      "internalId": "5fa85f64-5717-4562-b3fc-2c963f66afa6",
      "doi": "10.1038/s41586-023-00000-0",
      "status": "RESOLVED_DOWNLOAD",
      "storagePointer": "s3://research-engine-vault/raw_pdfs/10.1038_s41586-023-00000-0.pdf",
      "metadataSnapshot": {
        "title": "Optimizing Tail Latencies in Distributed Key-Value Topologies"
      }
    },
    {
      "internalId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "doi": "10.1145/3618257",
      "status": "PAYWALLED",
      "storagePointer": null,
      "metadataSnapshot": {
        "title": "Bounded Latency via Ephemeral Caching Strategies"
      }
    }
  ]
}

```

---

## 4. Resilience & Performance Strategies

### 4.1. File Sanitization & "Fake PDF" Defense

Academic publishers often return `HTTP 200 OK` for paywalled papers, but the downloaded file is actually an HTML login page.

* **MIME Trapping:** Before piping the stream to S3, the worker inspects the HTTP `Content-Type` header. If it is `text/html`, the download aborts and the paper is marked `PAYWALLED`.
* **Magic Number Verification:** The stream reader inspects the first 5 bytes of the incoming data. If the hex signature does not match `%PDF-` (Hex: `25 50 44 46 2D`), the stream is immediately destroyed to prevent parsing exceptions in Phase 5.

### 4.2. Concurrency and Rate Limiting

* **Max Concurrent Connections:** The Worker Pool is capped (e.g., 5 concurrent downloads) to prevent overwhelming the application's network I/O and to avoid triggering anti-bot mechanisms on publisher domains.
* **Adaptive Timeouts:** Download streams enforce a strict read-timeout. If a server accepts a connection but trickles bytes too slowly (e.g., $< 10\text{KB/s}$), the worker terminates the connection to prevent hanging the synthesis pipeline.

---

## 5. Architectural Verification Matrix

| Metric | Target Boundary | Validation Vector |
| --- | --- | --- |
| **Download Pipeline Latency** | $\le 12\text{s}$ for a batch of 20 | E2E I/O Profiling Logs |
| **Application RAM Overhead** | $\le 20\text{MB}$ peak during transfer | Heap/Memory Tracing |
| **Sanitization Catch Rate** | $100\%$ of non-PDF payloads dropped | File signature injection tests |
| **Cache Hit Resolution Time** | $\le 50\text{ms}$ | Database query tracing |

---

This architecture ensures Phase 4 is secure, network-efficient, and fully compliant with publisher restrictions, seamlessly handing off pristine PDF assets to the Docling parsers in Phase 5.
