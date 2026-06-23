# Design Docs

Per-phase architectural design for the Udaan Research Agent pipeline.

> These docs describe **`main`, the hosted-only build** (Hugging Face + external
> APIs): LLM via Groq/Gemini/Anthropic, embeddings + rerank via Cohere, parsing
> via LlamaParse, plus Qdrant Cloud / Supabase S3 / Neon Postgres. Each phase
> still notes its self-hosted variant (own models + local infra: Ollama, Docling,
> sentence-transformers, local Qdrant/MinIO, Redis/BullMQ, docker-compose), which
> lives on the **`local-infra`** branch.

1. [Phase 1 — Query Orchestration](./phase-1-query-orchestration.md)
2. [Phase 2 — Open Graph Gateway](./phase-2-open-graph-gateway.md)
3. [Phase 3 — Cross-Encoder Re-Ranking](./phase-3-cross-encoder-re-ranking.md)
4. [Phase 4 — JIT Full-Text Resolution](./phase-4-full-text-resolution.md)
5. [Phase 5 — Ingestion & Parsing](./phase-5-ingestion-and-parsing.md)
6. [Phase 6 — Cross-Source Synthesis & Polarity](./phase-6-synthesis-and-polarity.md)
7. [Phase 7 — Generation & Citation Weaving](./phase-7-generation-and-citation-weaving.md)

[System flow diagram (PDF)](./system-flow-diagram.pdf)
