#!/usr/bin/env bash
#
# Start the Udaan stack locally (HOSTED-ONLY build):
#   Python services (3,5,6) -> orchestrator API -> web UI
#
# All heavy compute is on hosted APIs (Groq/Gemini/Anthropic, Cohere, LlamaParse)
# and managed stores (Qdrant Cloud, Supabase S3, Neon). There is no local infra to
# start — just fill in infra/.env with your hosted endpoints + keys. The full
# self-hosted stack (own models + docker-compose infra) lives on the
# `local-infra` branch.
#
# Usage:  bash run.sh
# Stop:   Ctrl+C
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
}
trap cleanup EXIT INT TERM

# --- 1. Config ---------------------------------------------------------------
if [ ! -f infra/.env ]; then
  echo "→ Creating infra/.env from template (fill in your hosted endpoints + keys)"
  cp infra/.env.example infra/.env
fi
set -a; . infra/.env; set +a

# --- 2. First-run dependency install ----------------------------------------
if [ ! -d node_modules ]; then
  echo "→ Installing JS workspace deps (first run)"
  pnpm install
fi
# Per-service extras the hosted stack needs:
#   ranking  -> base (Cohere rerank is stdlib HTTP)
#   parsing  -> s3 (read PDFs from the vault) + qdrant (persist claims)
#   synthesis-> ml (scikit-learn clustering, CPU-only) + qdrant (read claim vectors)
[ -d "services/ranking/.venv" ]   || (cd services/ranking   && uv sync)
[ -d "services/parsing/.venv" ]   || (cd services/parsing   && uv sync --extra s3 --extra qdrant)
[ -d "services/synthesis/.venv" ] || (cd services/synthesis && uv sync --extra ml --extra qdrant)

# --- 3. Python services ------------------------------------------------------
echo "→ Starting Python services"
(cd services/ranking   && uv run python -m udaan_ranking)                              >"$LOG_DIR/ranking.log"   2>&1 & PIDS+=($!)
(cd services/parsing   && uv run --extra s3 --extra qdrant python -m udaan_parsing)    >"$LOG_DIR/parsing.log"   2>&1 & PIDS+=($!)
(cd services/synthesis && uv run --extra ml --extra qdrant python -m udaan_synthesis)  >"$LOG_DIR/synthesis.log" 2>&1 & PIDS+=($!)

# --- 4. Orchestrator API + Web UI -------------------------------------------
echo "→ Starting orchestrator API + web UI"
# Orchestrator gets its own PORT (ORCHESTRATOR_PORT) so it never collides with the
# Python services, which all read the generic PORT env (defaulting to 8001/8002/8003).
PORT="${ORCHESTRATOR_PORT:-8080}" pnpm --filter @udaan/orchestrator dev >"$LOG_DIR/orchestrator.log" 2>&1 & PIDS+=($!)
pnpm --filter @udaan/web dev           >"$LOG_DIR/web.log"          2>&1 & PIDS+=($!)

cat <<EOF

────────────────────────────────────────────────────────────
  Udaan is starting up (hosted-only build)
────────────────────────────────────────────────────────────
  Web UI            http://localhost:5173
  Orchestrator API  http://localhost:${ORCHESTRATOR_PORT:-8080}
  Ranking :8001   Parsing :8002   Synthesis :8003

  Logs:  .logs/*.log
  LLM:   provider=${LLM_PROVIDER:-anthropic}  model=${LLM_MODEL:-}
         (hosted providers need their API key set in infra/.env)

  Press Ctrl+C to stop the app processes.
────────────────────────────────────────────────────────────
EOF

wait
