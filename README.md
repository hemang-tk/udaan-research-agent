# Udaan Research Agent

An AI Research Synthesis Engine: turn a research question into a fully-sourced,
traceable research brief. The core guarantee is **zero-hallucination
traceability** — every claim in the output traces to a real passage in a real
paper.

Per-phase architectural design lives in [`docs/`](./docs) — one doc per phase, plus the system-flow diagram.

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
| 4 | Full-Text Resolution | TS | resolve PDFs → MinIO/S3 vault (paywall-aware) |
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
  orchestrator/   phases 1,2,4,7 + pipeline driver + HTTP API + BullMQ worker
  web/            React + Vite UI (live progress, cited brief)
services/
  ranking/        Phase 3 (FastAPI)
  parsing/        Phase 5 (FastAPI)
  synthesis/      Phase 6 (FastAPI)
  shared/         Python config + provider implementations
infra/            docker-compose (Qdrant, Redis, MinIO) + .env
```

## Run it

Prerequisites: Docker, Node 20+, pnpm, [uv](https://docs.astral.sh/uv/), and
(optional) [Ollama](https://ollama.com) for the local LLM.

```bash
bash run.sh            # Git Bash on Windows; brings up the whole stack
```

Then open the **Web UI at http://localhost:5173**. The UI also has a
**"See a sample brief"** button so you can view it without the full backend.

Manual start (equivalent to `run.sh`):

```bash
docker compose -f infra/docker-compose.yml up -d        # Qdrant, Redis, MinIO
cp infra/.env.example infra/.env
ollama pull qwen2.5:7b-instruct-q4_K_M                   # optional (LLM)
(cd services/ranking   && uv run python -m udaan_ranking)    # :8001
(cd services/parsing   && uv run python -m udaan_parsing)    # :8002
(cd services/synthesis && uv run python -m udaan_synthesis)  # :8003
pnpm --filter @udaan/orchestrator dev                   # API :8080
pnpm --filter @udaan/web dev                            # UI  :5173
```

Everything runs **without the heavy ML stack** via deterministic fallbacks
(lexical re-rank, pypdf parsing, hashing embeddings, greedy clustering). For the
real models on a GPU:

```bash
(cd services/ranking   && uv sync --extra ml)
(cd services/parsing   && uv sync --extra ml --extra qdrant)
(cd services/synthesis && uv sync --extra ml --extra qdrant)
```

Durable/scaled execution (needs Redis): `pnpm --filter @udaan/orchestrator worker`.

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
config change. Providers (LLM / embedding / re-rank) are swappable between local,
free-tier API, and paid (Claude) via `LLM_PROVIDER` / `EMBEDDING_PROVIDER` /
`RERANK_PROVIDER`.
