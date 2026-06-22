#!/usr/bin/env bash
#
# Start the full Udaan stack locally:
#   infra (Qdrant, Redis, MinIO) -> Python services (3,5,6) -> orchestrator API -> web UI
#
# Usage:  bash run.sh
# Stop:   Ctrl+C (stops app processes; infra is left running)
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"
PIDS=()

cleanup() {
  echo ""
  echo "→ Stopping app processes..."
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  echo "  Infra (Qdrant/Redis/MinIO) left running. Stop it with:"
  echo "    docker compose -f infra/docker-compose.yml down"
}
trap cleanup EXIT INT TERM

# --- 1. Config ---------------------------------------------------------------
if [ ! -f infra/.env ]; then
  echo "→ Creating infra/.env from template"
  cp infra/.env.example infra/.env
fi
set -a; . infra/.env; set +a

# --- 2. Infra (official images) ---------------------------------------------
echo "→ Starting infra (Qdrant, Redis, MinIO)"
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d

# --- 3. First-run dependency install ----------------------------------------
if [ ! -d node_modules ]; then
  echo "→ Installing JS workspace deps (first run)"
  pnpm install
fi
for svc in ranking parsing synthesis; do
  if [ ! -d "services/$svc/.venv" ]; then
    echo "→ Syncing services/$svc (first run)"
    (cd "services/$svc" && uv sync)
  fi
done

# --- 4. Python services ------------------------------------------------------
# Set ML_EXTRAS=1 (in infra/.env) to run with every optional extra per service:
# ml (embeddings, cross-encoder reranker, sklearn clustering, Docling), s3 (boto3 — the
# parser reads PDFs from the vault), and qdrant (claims persist so synthesis sees them).
# uv run must be told the extras, or it prunes them back out to match the default deps.
ML_FLAG=""
[ "${ML_EXTRAS:-0}" = "1" ] && ML_FLAG="--all-extras"
echo "→ Starting Python services${ML_FLAG:+ (with ml extras)}"
(cd services/ranking   && uv run $ML_FLAG python -m udaan_ranking)   >"$LOG_DIR/ranking.log"   2>&1 & PIDS+=($!)
(cd services/parsing   && uv run $ML_FLAG python -m udaan_parsing)   >"$LOG_DIR/parsing.log"   2>&1 & PIDS+=($!)
(cd services/synthesis && uv run $ML_FLAG python -m udaan_synthesis) >"$LOG_DIR/synthesis.log" 2>&1 & PIDS+=($!)

# --- 5. Orchestrator API + Web UI -------------------------------------------
echo "→ Starting orchestrator API + web UI"
# Orchestrator gets its own PORT (ORCHESTRATOR_PORT) so it never collides with the
# Python services, which all read the generic PORT env (defaulting to 8001/8002/8003).
PORT="${ORCHESTRATOR_PORT:-8080}" pnpm --filter @udaan/orchestrator dev >"$LOG_DIR/orchestrator.log" 2>&1 & PIDS+=($!)
pnpm --filter @udaan/web dev           >"$LOG_DIR/web.log"          2>&1 & PIDS+=($!)

cat <<EOF

────────────────────────────────────────────────────────────
  Udaan is starting up
────────────────────────────────────────────────────────────
  Web UI            http://localhost:5173
  Orchestrator API  http://localhost:${ORCHESTRATOR_PORT:-8080}
  Ranking :8001   Parsing :8002   Synthesis :8003
  Qdrant            http://localhost:6333
  MinIO console     http://localhost:9001  (${MINIO_ROOT_USER:-minioadmin}/${MINIO_ROOT_PASSWORD:-minioadmin})

  Logs:  .logs/*.log
  LLM:   provider=${LLM_PROVIDER:-ollama}  model=${LLM_MODEL:-qwen2.5:7b-instruct-q4_K_M}
         (ollama needs 'ollama serve'; hosted providers need their API key set)

  Press Ctrl+C to stop the app processes.
────────────────────────────────────────────────────────────
EOF

wait
