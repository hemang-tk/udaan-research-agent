/**
 * Thin HTTP API for the orchestrator. Runs the pipeline in-process and streams
 * per-phase progress over SSE. Paywalled papers are surfaced for manual upload
 * to the vault (so a re-run resolves them from cache). (BullMQ is the
 * horizontal-scale path: runPipeline is the worker body.)
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ResolutionManifestEntry } from "@udaan/contracts";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig } from "@udaan/shared";
import { S3ObjectStore, storageKey, type ObjectStore } from "./phases/full-text-resolution/index.js";
import { HttpParsingService } from "./pipeline/clients.js";
import { buildPipelineDeps } from "./pipeline/index.js";
import { runPipeline, type PipelineResult, type ProgressEvent } from "./pipeline/runPipeline.js";
import { createResearchStore, type ResearchStore } from "./researchStore.js";

interface Job {
  projectId: string;
  query: string;
  events: ProgressEvent[];
  paywalled: ResolutionManifestEntry[];
  result?: PipelineResult;
  error?: string;
  done: boolean;
}

export interface ServerOptions {
  /** Inject an object store (tests/no-infra); defaults to S3/MinIO from config. */
  store?: ObjectStore;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  // Strict boundary validation: don't silently coerce types or strip unknown
  // fields — a malformed request body is rejected with a 400, not patched up.
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  // CORS: let the deployed frontend (cross-origin fetch + EventSource) call this
  // API. Origins come from CORS_ORIGINS (comma-separated). When unset, reflect the
  // request origin — convenient for local/tunnel demos. Read from env directly (not
  // loadConfig) so buildServer needs no infra env in tests. `ngrok-skip-browser-warning`
  // is allowed so the browser bypasses ngrok's free-tier interstitial page.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.register(cors, {
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "ngrok-skip-browser-warning"],
  });

  const jobs = new Map<string, Job>();

  let store = options.store ?? null;
  const getStore = (): ObjectStore => {
    if (!store) store = new S3ObjectStore(loadConfig().s3);
    return store;
  };

  // Research-session persistence (History). Read DATABASE_URL directly (not via
  // loadConfig) so buildServer needs no infra env in tests; unset = no-op store.
  let researchStore: ResearchStore | null = null;
  const getResearchStore = (): ResearchStore => {
    if (!researchStore) researchStore = createResearchStore(process.env.DATABASE_URL || undefined);
    return researchStore;
  };

  function startJob(query: string, projectId: string, userId: string): string {
    const id = randomUUID();
    const job: Job = { projectId, query, events: [], paywalled: [], done: false };
    jobs.set(id, job);

    const config = loadConfig();
    const deps = buildPipelineDeps(config, {
      onProgress: (event) => job.events.push(event),
      onPaywalled: (entries) => {
        job.paywalled = entries;
      },
    });
    const request = { userId, projectId, rawQuery: query, timestamp: new Date().toISOString() };

    runPipeline(request, deps)
      .then((result) => {
        job.result = result;
        // Persist completed briefs so they survive restarts and list in History.
        // Best-effort: a persistence failure must not affect the live result.
        if (result.status === "ok") {
          getResearchStore()
            .save({ id, query, projectId, brief: result.brief })
            .catch(() => undefined);
        }
      })
      .catch((err: unknown) => {
        job.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        job.done = true;
      });

    return id;
  }

  app.get("/health", async () => ({ status: "ok" }));

  // History: past research sessions (most recent first).
  app.get("/history", async () => {
    try {
      return { researches: await getResearchStore().list() };
    } catch {
      return { researches: [] };
    }
  });

  // Runtime request-body validation at the API boundary (issue #20). Fastify
  // rejects a body that violates the schema with a descriptive 400 before the
  // handler runs, so a malformed client request never enters the pipeline.
  const researchBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 1 },
      projectId: { type: "string", minLength: 1 },
      userId: { type: "string", minLength: 1 },
    },
  };

  app.post<{ Body: { query: string; projectId?: string; userId?: string } }>(
    "/research",
    { schema: { body: researchBodySchema } },
    async (req, reply) => {
      const { query, projectId = `proj_${randomUUID().slice(0, 8)}`, userId = "anonymous" } = req.body ?? {};
      const jobId = startJob(query, projectId, userId);
      return reply.code(202).send({ jobId, projectId });
    },
  );

  app.get<{ Params: { id: string } }>("/research/:id", async (req, reply) => {
    const job = jobs.get(req.params.id);
    if (job) {
      return {
        done: job.done,
        projectId: job.projectId,
        query: job.query,
        events: job.events,
        paywalled: job.paywalled,
        result: job.result,
        error: job.error,
      };
    }
    // Not in memory — try the persisted History store (survives restarts).
    const rec = await getResearchStore()
      .get(req.params.id)
      .catch(() => null);
    if (!rec) return reply.code(404).send({ error: "not found" });
    return {
      done: true,
      projectId: rec.projectId,
      query: rec.query,
      createdAt: rec.createdAt,
      events: [],
      paywalled: [],
      result: { status: "ok", brief: rec.brief },
    };
  });

  // RAG chat: answer a question using only the passages behind this research's
  // brief. Resolves the project from the live job or the persisted record, then
  // delegates retrieval + generation to the parsing service (Groq-first chat LLM).
  const askBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["question"],
    properties: {
      question: { type: "string", minLength: 1 },
      history: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["role", "content"],
          properties: { role: { type: "string" }, content: { type: "string" } },
        },
      },
    },
  };

  app.post<{
    Params: { id: string };
    Body: { question: string; history?: { role: "user" | "assistant"; content: string }[] };
  }>(
    "/research/:id/ask",
    { schema: { body: askBodySchema } },
    async (req, reply) => {
      const { question } = req.body ?? {};
      let projectId = jobs.get(req.params.id)?.projectId;
      if (!projectId) {
        const rec = await getResearchStore()
          .get(req.params.id)
          .catch(() => null);
        projectId = rec?.projectId;
      }
      if (!projectId) return reply.code(404).send({ error: "not found" });

      const parsing = new HttpParsingService(loadConfig().services.parsing);
      try {
        return await parsing.ask({ projectId, question, history: req.body?.history ?? [] });
      } catch {
        return reply.code(502).send({ error: "chat service unavailable" });
      }
    },
  );

  // Resolve a research's projectId from the live job or the persisted record.
  const resolveProjectId = async (id: string): Promise<string | undefined> => {
    const live = jobs.get(id)?.projectId;
    if (live) return live;
    const rec = await getResearchStore()
      .get(id)
      .catch(() => null);
    return rec?.projectId;
  };

  // Elicit-style extraction table. GET returns the cached table (or generated:false);
  // POST (re)generates it per paper and caches it in Neon so views are free.
  app.get<{ Params: { id: string } }>("/research/:id/table", async (req) => {
    const table = await getResearchStore()
      .getTable(req.params.id)
      .catch(() => null);
    return { generated: !!table, table };
  });

  app.post<{ Params: { id: string }; Body: { columns?: { key: string; label?: string; prompt?: string }[] } }>(
    "/research/:id/table",
    async (req, reply) => {
      const projectId = await resolveProjectId(req.params.id);
      if (!projectId) return reply.code(404).send({ error: "not found" });
      const parsing = new HttpParsingService(loadConfig().services.parsing);
      try {
        const table = await parsing.table({ projectId, columns: req.body?.columns });
        await getResearchStore()
          .saveTable(req.params.id, table)
          .catch(() => undefined);
        return { generated: true, table };
      } catch {
        return reply.code(502).send({ error: "table service unavailable" });
      }
    },
  );

  app.get<{ Params: { id: string } }>("/research/:id/stream", (req, reply) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.hijack();
    const raw = reply.raw;
    // reply.hijack() bypasses the @fastify/cors hook, so set the CORS header here
    // by hand — otherwise a cross-origin EventSource (e.g. the Netlify frontend)
    // is blocked. Reflect the request origin when it is allowed.
    const origin = req.headers.origin;
    const allowOrigin =
      origin && (corsOrigins.length === 0 || corsOrigins.includes(origin)) ? origin : undefined;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...(allowOrigin ? { "access-control-allow-origin": allowOrigin } : {}),
    });

    let sent = 0;
    const timer = setInterval(() => {
      while (sent < job.events.length) {
        raw.write(`event: progress\ndata: ${JSON.stringify(job.events[sent])}\n\n`);
        sent++;
      }
      if (job.done) {
        raw.write(`event: result\ndata: ${JSON.stringify(job.result ?? { error: job.error })}\n\n`);
        clearInterval(timer);
        raw.end();
      }
    }, 200);

    req.raw.on("close", () => clearInterval(timer));
  });

  // Manual upload for a paywalled paper: store the PDF in the vault keyed by
  // (doi, internalId) so a re-run resolves it from cache (Track A).
  const uploadBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["internalId", "pdfBase64"],
    properties: {
      doi: { type: ["string", "null"] },
      internalId: { type: "string", minLength: 1 },
      pdfBase64: { type: "string", minLength: 1 },
    },
  };

  app.post<{ Body: { doi: string | null; internalId: string; pdfBase64: string } }>(
    "/uploads",
    { schema: { body: uploadBodySchema } },
    async (req, reply) => {
      const { doi = null, internalId, pdfBase64 } = req.body ?? {};
      const bytes = new Uint8Array(Buffer.from(pdfBase64, "base64"));
      if (bytes.length < 5 || !(bytes[0] === 0x25 && bytes[1] === 0x50)) {
        return reply.code(415).send({ error: "not a PDF" });
      }
      const pointer = await getStore().put(storageKey(doi, internalId), bytes, "application/pdf");
      return { stored: true, pointer };
    },
  );

  return app;
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 8080);
  app.listen({ port, host: process.env.HOST ?? "0.0.0.0" }).then(
    () => console.log(`orchestrator API listening on :${port}`),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
