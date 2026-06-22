# Single-container backend for a free Hugging Face Docker Space.
# Runs the orchestrator API (public) + the 3 Python services (localhost).
# Heavy compute is on hosted APIs (Groq / Cohere / LlamaParse), so the image
# carries NO ml/torch/Docling — it fits a free CPU Space. See DEPLOY.md.
FROM python:3.11-slim-bookworm

# Node 20 (orchestrator) + build basics
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git build-essential \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# pnpm (via corepack) + uv (Python package manager)
RUN corepack enable && pip install --no-cache-dir uv

# HF Spaces run containers as uid 1000 with $HOME=/home/user.
RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PORT=7860
WORKDIR /app

COPY --chown=user:user . /app
# WORKDIR created /app as root; pnpm/uv run as `user` and must write temp files,
# node_modules, and .venvs into the tree — hand the whole dir to user before USER.
RUN chown -R user:user /app
USER user

# JS deps — tsx runs the orchestrator TypeScript directly, so no build step.
RUN pnpm install --frozen-lockfile

# Python services: only the extras the hosted stack needs (no `ml`).
#   parsing  -> s3 (read PDFs from the vault) + qdrant (persist claims)
#   synthesis-> qdrant (read claim vectors)
#   ranking  -> base (Cohere rerank is stdlib HTTP)
RUN cd /app/services/ranking   && uv sync \
 && cd /app/services/parsing   && uv sync --extra s3 --extra qdrant \
 && cd /app/services/synthesis && uv sync --extra ml --extra qdrant

EXPOSE 7860
CMD ["bash", "infra/hf-space/start.sh"]
