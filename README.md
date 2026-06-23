# Udaan Research Agent

An AI Research Synthesis Engine: turn a research question into a fully-sourced,
traceable research brief — then **chat with the papers behind it**. The core
guarantee is **zero-hallucination traceability**: every claim in the output
traces to a real passage in a real paper.

> ### `main` is the hosted-only build — external APIs + Hugging Face
> Every heavy step runs on a **managed/external API**, so the whole backend fits
> in a single **free, CPU-only Hugging Face Docker Space** (no GPU, no local model
> weights, no self-hosted databases). The full self-hosted stack — own models
> (Ollama, Docling, sentence-transformers, a local cross-encoder) and local infra
> (docker-compose, MinIO, Redis/BullMQ) — lives on the **[`local-infra`](https://github.com/vimalyad/udaan-research-agent/tree/local-infra)** branch.

## Architecture at a glance

```
                Netlify (React + Vite SPA)
                          │  HTTPS / SSE
                          ▼
        ┌──────────────────────────────────────────┐
        │   Hugging Face Docker Space (1 container)  │
        │                                            │
        │   Orchestrator API  (TS / Fastify, :7860)  │
        │        │  localhost HTTP                    │
        │        ├── ranking   (FastAPI, Phase 3)     │
        │        ├── parsing   (FastAPI, Phase 5)     │
        │        └── synthesis (FastAPI, Phase 6)     │
        └──────────────────────────────────────────┘
                          │  outbound HTTPS only
   ┌──────────────┬───────┴───────┬───────────────┬──────────────┐
   ▼              ▼               ▼               ▼              ▼
 Groq /        Cohere         LlamaParse      Qdrant Cloud    Supabase
 Gemini /   (embed+rerank)    (PDF parse)     (vectors)       S3 (PDFs)
 Anthropic                                                   + Neon (history)
```

The browser only ever talks to the **orchestrator API**; the orchestrator calls
the three Python services over `localhost` inside the container. All compute that
would otherwise need a GPU or a database server is delegated to hosted APIs —
the container itself just orchestrates HTTP.

## Backing services (all hosted, all swappable via env)

| Service | Role in the pipeline | What's used | Free tier? |
|---|---|---|---|
| **Groq / Gemini / Anthropic** | every LLM step (query compile, claim extraction, polarity, generation, chat) | round-robin + failover via `LLM_PROVIDER`; default `claude-haiku-4-5` (reliable), Groq `llama-3.3-70b` / Gemini `2.5-flash` (free) | Groq & Gemini free; Anthropic paid (~$0.08/run) |
| **Cohere** | embeddings **and** re-ranking | `embed-english-v3.0` (1024-dim) + `rerank-v3.5` (hosted cross-encoder) | trial tier |
| **LlamaParse** | layout-aware PDF → text (Phase 5) | API key only, no GPU | yes |
| **Qdrant Cloud** | vector store — claim vectors + full-text chunk vectors | `claims` + `chunks` collections, payload-filtered by `projectId` | free cluster |
| **Supabase Storage** | S3-compatible PDF vault (Phase 4) | standard S3 client; `s3://` pointers | free |
| **Neon** | Postgres — research history + extraction-table cache | `research` + `research_table` tables | free, no card |

Because everything is behind an env-configured provider interface, switching a
backend (e.g. a different LLM, or self-hosting on `local-infra`) is a config
change, not a code change.

## Pipeline

```
Query → Gateway → Re-rank → Resolve → Ingest → Synthesis → Generation → Brief
  1        2          3         4         5          6            7
```

| # | Phase | Lang | What it does | External call |
|---|---|---|---|---|
| 1 | Query Orchestration | TS | NL query → compiled discovery manifest | LLM |
| 2 | Open Graph Gateway | TS | OpenAlex / Semantic Scholar / Crossref → deduped candidates | academic-graph APIs |
| 3 | Cross-Encoder Re-Ranking | Py | rank candidates → top ~20 | Cohere `rerank-v3.5` |
| 4 | Full-Text Resolution | TS | resolve open-access PDFs → Supabase vault (paywall-aware) | Supabase S3 |
| 5 | Ingestion & Parsing | Py | parse → **quote-anchored** claims + full-text chunks → embed → Qdrant | LlamaParse, Cohere, Qdrant |
| 6 | Synthesis & Polarity | Py | cluster claims → AGREEMENT / CONTRADICTION / THIN_EVIDENCE | scikit-learn (CPU) + LLM |
| 7 | Generation & Citation Weaving | TS | constrained draft → hallucination filter → cited brief → Neon | LLM, Neon |

**Trust guarantees (enforced & tested):** the quote anchor (Phase 5) drops any
claim whose source quote isn't a verbatim substring of its chunk; the
hallucination filter (Phase 7) drops any sentence without a valid citation tag;
contradictions are surfaced, never averaged (Phase 6).

## Ask these papers (RAG chat)

Every finished research opens a two-pane view — the cited brief on the left, a
chat over its papers on the right — backed by an advanced retrieval pipeline:

1. embed the question (Cohere, `search_query`) → vector-search **that research's**
   `chunks` in Qdrant;
2. **re-rank** the candidates (Cohere cross-encoder);
3. **CRAG** (corrective RAG): an LLM grades whether the passages can answer the
   question — keep only the relevant ones, run one corrective retry with a
   reworded query, or **abstain** instead of guessing;
4. answer with inline `[n]` citations, **Groq-first / Anthropic-fallback**
   (`CHAT_LLM_PROVIDER`) so chat is near-free but never errors out.

Plus **conversational memory** (follow-ups like "what about its limits?" resolve
against the chat history) and an **Elicit-style extraction table** — a per-paper
Objective / Method / Findings / Limitations grid, generated once and cached in
Neon. Typical cost: ~$0.08 per research run, and effectively $0 per chat question
on the free tiers.

## Deployment

- **Backend** → one Docker image on a **free Hugging Face CPU Space**: the
  orchestrator API (public, `:7860`) plus the three FastAPI services on
  `localhost`. The pipeline runs **in-process** — no queue, no worker, no GPU.
  See [`Dockerfile`](./Dockerfile) and [`infra/hf-space/`](./infra/hf-space).
- **Frontend** → React + Vite SPA on **Netlify**, pointed at the Space URL.
- **Stateful pieces** are all managed (Qdrant Cloud, Supabase, Neon) so the
  container stays stateless and restart-safe.

Full step-by-step setup is in **[DEPLOY.md](./DEPLOY.md)**.

## Layout

```
packages/
  contracts/      schema-first contracts → TS types + Pydantic models
  shared/         12-factor config + swappable provider interfaces (TS)
  orchestrator/   phases 1,2,4,7 + pipeline driver + HTTP API (+ RAG chat / table endpoints)
  web/            React + Vite UI (live progress, cited brief, chat, extraction table)
services/
  ranking/        Phase 3 — Cohere re-rank (FastAPI)
  parsing/        Phase 5 — LlamaParse + Cohere embed + chunk store + /ask + /table (FastAPI)
  synthesis/      Phase 6 — scikit-learn clustering (FastAPI)
  shared/         Python config + hosted provider implementations
infra/            .env.example + Hugging Face Space launcher (hf-space/)
```

## Run it locally (against the hosted services)

Prerequisites: Node 20+, pnpm, [uv](https://docs.astral.sh/uv/), and accounts/keys
for the backing services above (Groq/Gemini/Anthropic, Cohere, LlamaParse, Qdrant
Cloud, Supabase, Neon).

```bash
cp infra/.env.example infra/.env       # fill in your hosted endpoints + API keys
(cd services/ranking   && uv run python -m udaan_ranking)                              # :8001
(cd services/parsing   && uv run --extra s3 --extra qdrant python -m udaan_parsing)    # :8002
(cd services/synthesis && uv run --extra ml --extra qdrant python -m udaan_synthesis)  # :8003
pnpm --filter @udaan/orchestrator dev                   # API :8080
pnpm --filter @udaan/web dev                            # UI  :5173
```

Then open the **Web UI at http://localhost:5173**. Synthesis keeps scikit-learn
clustering (`--extra ml`, CPU-only); ranking and parsing carry **no** ML
dependencies — Cohere does the re-ranking and LlamaParse the parsing.

## Test

```bash
pnpm -r test                              # TypeScript (vitest)
(cd services/ranking   && uv run pytest)  # Python (pytest)
(cd services/parsing   && uv run pytest)
(cd services/synthesis && uv run pytest)
```

## Configuration

Everything is a 12-factor environment variable (`infra/.env`, documented in
[`infra/.env.example`](./infra/.env.example)) — no hardcoded hosts, so deploy is a
config change. Key groups:

| Group | Vars |
|---|---|
| **Providers** | `LLM_PROVIDER` (comma-list of `groq,gemini,anthropic` for round-robin + failover; default `anthropic`), `EMBEDDING_PROVIDER=cohere`, `RERANK_PROVIDER=cohere`, `PARSER=llamaparse` |
| **Chat / RAG** | `CHAT_LLM_PROVIDER=groq,anthropic` (strict Groq-first), `CHAT_CANDIDATE_K`, `ENABLE_CRAG` |
| **Models** | `LLM_MODEL` (+ per-provider `LLM_MODEL_GROQ` / `_GEMINI` / `_ANTHROPIC`), `EMBEDDING_MODEL`, `RERANK_MODEL` |
| **Keys** | `GROQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `COHERE_API_KEY`, `LLAMAPARSE_API_KEY` |
| **Stores** | `QDRANT_URL` / `QDRANT_API_KEY`, `S3_*` (Supabase), `DATABASE_URL` (Neon) |
| **Bounds** | `MAX_INGEST_DOCS`, `MAX_CHUNKS_PER_DOC`, `MAX_PDF_PAGES`, `INGEST_TIMEOUT_MS`, `GATEWAY_TIMEOUT_MS` |

The hosted provider implementations live on `main`; their self-hosted
counterparts (local models + infra) live on the `local-infra` branch.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local
setup, conventions, and the review/merge workflow. By participating you agree to
the [Code of Conduct](./CODE_OF_CONDUCT.md). To report a vulnerability, see
[`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE) © Vimal Yadav
