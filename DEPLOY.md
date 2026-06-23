# Deploy (free / no credit card)

> **`main` is the hosted-only build** (Hugging Face + external APIs): LLM via
> Groq/Gemini/Anthropic, embeddings + rerank via **Cohere**, parsing via
> **LlamaParse**, plus Qdrant Cloud / Supabase S3 / Neon Postgres. There are no
> local models, Ollama, Redis, or MinIO. The full self-hosted stack (own models +
> local infra, docker-compose) lives on the **`local-infra`** branch. The notes
> below describe running this hosted build from your laptop behind a free tunnel.

This setup costs nothing and needs no cloud account or card:

- **Frontend** → Netlify (static; see `netlify.toml`)
- **Backend** → runs on your laptop, exposed publicly via a free tunnel
- **LLM** → Groq's free API (no GPU, no card)

The browser talks **only** to the orchestrator API. The orchestrator calls the
three Python services itself over localhost, so you expose **one** port.

---

## 1. Prerequisites

- Docker (for Qdrant + MinIO via `infra/docker-compose.yml`)
- Node 20 + pnpm, and `uv` for the Python services
- A free **Groq** API key — https://console.groq.com (no card)
- A tunnel tool — either:
  - **ngrok** (free, 1 static domain): https://ngrok.com — or
  - **cloudflared** (free quick tunnel, no account): `cloudflared tunnel --url …`

## 2. Configure env

```bash
cp infra/.env.example infra/.env
```

Edit `infra/.env`:

```ini
# Free hosted LLM (no GPU needed)
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
LLM_MODEL=llama-3.3-70b-versatile     # a valid Groq model id

# Embeddings + rerank via Cohere (free tier); parsing via LlamaParse (free tier)
EMBEDDING_PROVIDER=cohere
RERANK_PROVIDER=cohere
COHERE_API_KEY=your_cohere_key
PARSER=llamaparse
LLAMAPARSE_API_KEY=llx_your_key

# Allow your Netlify site to call the API from the browser
CORS_ORIGINS=https://your-site.netlify.app

# If port 8080 is taken locally (e.g. Apache), pick another and tunnel that one
PORT=8080
```

## 3. Start the backend

```bash
./run.sh                                           # the 3 services + orchestrator API
```

The orchestrator API comes up on `http://localhost:8080` (or your `PORT`).

## 4. Expose the orchestrator publicly

```bash
# ngrok (stable URL with a reserved free domain):
ngrok http 8080 --domain=your-name.ngrok-free.app

# or cloudflared (random URL, no account, no interstitial):
cloudflared tunnel --url http://localhost:8080
```

Copy the public HTTPS URL it prints.

## 5. Point the frontend at it

In Netlify → **Site config → Environment variables**:

```
VITE_API_BASE = https://your-name.ngrok-free.app
```

`VITE_API_BASE` is **build-time** — trigger a redeploy after setting/changing it.
Make sure `CORS_ORIGINS` in `infra/.env` matches your Netlify origin, then restart
the orchestrator so the new value takes effect.

## 6. Verify

```bash
curl https://your-name.ngrok-free.app/health        # 200
```

Open the Netlify site, run a query, and confirm the progress (SSE) stream updates.

---

## Off-laptop, still free, no credit card → Hugging Face Space

The laptop+tunnel setup above is great for a quick demo but needs your machine
on. To host the backend **off your laptop** at zero cost (no card), put it on a
**Hugging Face Docker Space**. The trick: move every heavy step to a free hosted
API, so the Space needs no GPU and only a small CPU.

### What runs where (all free, no card)

| Layer | Service | Free tier |
|-------|---------|-----------|
| Frontend | Netlify | static hosting |
| Backend (4 services, one container) | Hugging Face Docker Space | CPU Space |
| LLM (Phases 1/5/7) | Groq | free, rate-limited |
| Re-rank + embeddings (Phases 3/5) | Cohere | free tier |
| PDF parsing (Phase 5) | LlamaParse | ~1000 pages/day |
| Vector store | Qdrant Cloud | 1 GB cluster |
| PDF vault (S3) | Supabase Storage | 1 GB, **no card** |

> Cloudflare R2 / Backblaze B2 are cheaper-per-GB but require a card. Supabase
> Storage is S3-compatible and card-free, so the existing S3 client works as-is.

### 1. Stand up the free backing services

- **Qdrant Cloud** → create a free cluster, note its URL (`https://…:6333`).
- **Supabase** → new project → Storage → create a bucket (e.g. `research-vault`)
  → Project Settings → Storage → S3 access keys. Note the S3 endpoint + keys.

### 2. Create the Space

1. huggingface.co → New Space → **Docker** (blank) → name it.
2. The repo here already has a root **`Dockerfile`** (runs all 4 services) and
   **`infra/hf-space/start.sh`**. Push this branch's contents to the Space repo,
   and make the Space's `README.md` the one in **`infra/hf-space/README.md`**
   (its front matter sets `sdk: docker` + `app_port: 7860`).

### 3. Set the Space's env vars

In the Space → **Settings → Variables and secrets**. Secrets for keys, variables
for the rest:

```ini
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=gsk_...

EMBEDDING_PROVIDER=cohere
RERANK_PROVIDER=cohere
EMBEDDING_MODEL=embed-english-v3.0
RERANK_MODEL=rerank-v3.5
COHERE_API_KEY=...

PARSER=llamaparse
LLAMAPARSE_API_KEY=llx-...

QDRANT_URL=https://xxxx.cloud.qdrant.io:6333
# QDRANT_API_KEY=...            # if your cluster requires it

S3_ENDPOINT=https://<proj>.supabase.co/storage/v1/s3
S3_BUCKET=research-vault
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_REGION=us-east-1

CORS_ORIGINS=https://your-site.netlify.app
MAX_INGEST_DOCS=4               # keep runs fast/bounded
MAX_CHUNKS_PER_DOC=12
GATEWAY_TIMEOUT_MS=25000        # 4s default starves Phase 2 on a slow link (0 candidates)
```

`start.sh` defaults `RANKING/PARSING/SYNTHESIS_SERVICE_URL` to localhost, so you
don't set those.

### 4. Point the frontend at the Space

The Space's public URL is `https://<user>-<space>.hf.space`. In Netlify set
`VITE_API_BASE` to it and redeploy (build-time). Verify:

```bash
curl https://<user>-<space>.hf.space/health     # 200
```

No laptop, no tunnel, stable URL, and SSE works (HF Spaces don't cut idle
streams). The Phase 0 quality probe should report **all stages nominal** (no
degraded fallbacks), since every stage now runs a real hosted implementation.

---

## Notes & gotchas

- **Laptop must stay on** and the tunnel running for the demo. This is great for a
  shareable preview, not a production deployment.
- **Port 8080** is the default and may collide with a local Apache (`httpd`). Set
  `PORT` to a free port and tunnel that one.
- **ngrok free interstitial**: the frontend already sends `ngrok-skip-browser-warning`
  on `fetch`. The SSE `EventSource` can't send headers but uses `Accept: text/event-stream`,
  which normally passes — if the stream gets blocked, use `cloudflared` instead.
- **Groq model id**: when `LLM_PROVIDER=groq`, `LLM_MODEL` must be a valid Groq
  model id (e.g. `llama-3.3-70b-versatile`).
- **Moving off the laptop later** (still no card): a Hugging Face Docker Space can host
  the same backend (16 GB RAM, no card, no request timeout — works with SSE).
