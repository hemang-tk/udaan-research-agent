# Udaan Research Agent

An AI Research Synthesis Engine: turn a research question into a fully-sourced,
traceable research brief. The core guarantee is **zero-hallucination
traceability** — every claim in the output traces to a real passage in a real
paper.

Per-phase architectural design lives in [`docs/`](./docs) — one doc per phase, plus the system-flow diagram.

> **`main` is the hosted-only build** (Hugging Face + external APIs): all heavy
> compute is on hosted services — Groq/Gemini/Anthropic (LLM), Cohere (embeddings
> + rerank), LlamaParse (parsing), Qdrant Cloud, Supabase S3, Neon Postgres. There
> are no local models, Ollama, Redis, or MinIO. The full self-hosted stack
> (own models + local infra: Ollama, Docling, sentence-transformers, BullMQ/Redis,
> docker-compose) lives on the **`local-infra`** branch.

## Pipeline

```
Query → Gateway → Re-rank → Resolve → Ingest → Synthesis → Generation → Brief
  1        2          3         4         5          6            7
```

| # | Phase | Lang | What it does |
|---|---|---|---|
| 1 | Query Orchestration | TS | NL query → compiled discovery manifest |
| 2 | Open Graph Gateway | TS | OpenAlex/Semantic Scholar/Crossref → deduped candidates |
| 3 | Cross-Encoder Re-Ranking | Py | rank candidates → top 20 |
| 4 | Full-Text Resolution | TS | resolve PDFs → Supabase S3 vault (paywall-aware) |
| 5 | Ingestion & Parsing | Py | parse → **quote-anchored** claims → Qdrant |
| 6 | Synthesis & Polarity | Py | cluster → AGREEMENT / CONTRADICTION / THIN_EVIDENCE |
| 7 | Generation & Citation Weaving | TS | constrained draft → hallucination filter → cited brief |

**Trust guarantees (enforced & tested):** the quote anchor (Phase 5) drops any
claim whose source quote isn't verbatim; the hallucination filter (Phase 7)
drops any sentence without a valid citation tag; contradictions are surfaced,
never averaged (Phase 6).

## Layout

```
packages/
  contracts/      schema-first contracts → TS types + Pydantic models
  shared/         12-factor config + swappable provider interfaces (TS)
  orchestrator/   phases 1,2,4,7 + pipeline driver + HTTP API
  web/            React + Vite UI (live progress, cited brief)
services/
  ranking/        Phase 3 (FastAPI)
  parsing/        Phase 5 (FastAPI)
  synthesis/      Phase 6 (FastAPI)
  shared/         Python config + provider implementations
infra/            .env.example + Hugging Face Space launcher (hf-space/)
```

## Run it

Prerequisites: Node 20+, pnpm, [uv](https://docs.astral.sh/uv/), and accounts for
the hosted services (Qdrant Cloud, Supabase S3, one of Groq/Gemini/Anthropic,
Cohere, LlamaParse). See [DEPLOY.md](./DEPLOY.md) for the full hosted setup.

```bash
cp infra/.env.example infra/.env       # then fill in your hosted endpoints + keys
(cd services/ranking   && uv run python -m udaan_ranking)              # :8001
(cd services/parsing   && uv run --extra s3 --extra qdrant python -m udaan_parsing)   # :8002
(cd services/synthesis && uv run --extra ml --extra qdrant python -m udaan_synthesis) # :8003
pnpm --filter @udaan/orchestrator dev                   # API :8080
pnpm --filter @udaan/web dev                            # UI  :5173
```

Then open the **Web UI at http://localhost:5173**. The UI also has a
**"See a sample brief"** button so you can view it without the backend.

Synthesis keeps scikit-learn clustering (`--extra ml`, CPU-only); ranking and
parsing have no ML deps — Cohere does the reranking and LlamaParse the parsing.

## Test

```bash
pnpm -r test                              # TypeScript (vitest)
(cd services/ranking   && uv run pytest)  # Python (pytest)
(cd services/parsing   && uv run pytest)
(cd services/synthesis && uv run pytest)
```

## Configuration

All endpoints, credentials, and model names are environment variables
(`infra/.env`, see `infra/.env.example`) — no hardcoded hosts, so deploying is a
config change. Providers are selected via `LLM_PROVIDER` (a comma-list of
Groq/Gemini/Anthropic for round-robin + failover; default `anthropic`),
`EMBEDDING_PROVIDER`, and `RERANK_PROVIDER` (both `cohere` on main). The chat/RAG
("ask these papers") uses a Groq-first, Anthropic-fallback chain via
`CHAT_LLM_PROVIDER`. The self-hosted provider implementations (local models +
infra) live on the `local-infra` branch.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local
setup, conventions, and the review/merge workflow. By participating you agree to
the [Code of Conduct](./CODE_OF_CONDUCT.md). To report a vulnerability, see
[`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE) © Vimal Yadav
