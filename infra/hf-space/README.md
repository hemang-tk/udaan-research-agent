---
title: Udaan Research Agent Backend
emoji: 🔭
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Udaan backend (Hugging Face Space)

This is the deploy target for the Udaan research-agent **backend** — the
orchestrator API plus the three Python services, in one container. The browser
(Netlify frontend) talks only to this Space.

**This file is the Space's `README.md`.** Hugging Face reads the YAML front
matter above to build a Docker Space (`sdk: docker`) and route public traffic to
`app_port: 7860` (the orchestrator). Copy it to the root of your Space repo.

See `DEPLOY.md` in the repo root for the full step-by-step (env vars, free
backing services, frontend wiring).
