#!/usr/bin/env bash
#
# Launch the full Udaan backend inside one container (Hugging Face Space).
# The browser talks ONLY to the orchestrator API; it calls the 3 Python
# services over localhost. Heavy compute is on hosted APIs (no GPU/ML).
#
set -uo pipefail
cd "$(dirname "$0")/../.."

# Sensible localhost defaults so the Space only needs the *real* env vars set
# (Qdrant, S3/vault, provider API keys, models, CORS). These point the
# orchestrator at the in-container services and satisfy loadConfig()'s required
# REDIS_URL/OLLAMA_URL, which are unused when the API runs the pipeline in-process.
export RANKING_SERVICE_URL="${RANKING_SERVICE_URL:-http://localhost:8001}"
export PARSING_SERVICE_URL="${PARSING_SERVICE_URL:-http://localhost:8002}"
export SYNTHESIS_SERVICE_URL="${SYNTHESIS_SERVICE_URL:-http://localhost:8003}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"

echo "[start] Python services -> ranking:8001 parsing:8002 synthesis:8003"
( cd services/ranking   && PORT=8001 uv run python -m udaan_ranking ) &
( cd services/parsing   && PORT=8002 uv run --extra s3 --extra qdrant python -m udaan_parsing ) &
( cd services/synthesis && PORT=8003 uv run --extra qdrant python -m udaan_synthesis ) &

# The orchestrator is the only public surface — bind it to the Space port.
echo "[start] orchestrator API -> :${PORT:-7860}"
exec env PORT="${PORT:-7860}" pnpm --filter @udaan/orchestrator start
