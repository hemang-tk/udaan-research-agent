/**
 * Thin HTTP API for the orchestrator. Runs the pipeline in-process and streams
 * per-phase progress over SSE. Paywalled papers are surfaced for manual upload
 * to the vault (so a re-run resolves them from cache). (BullMQ is the
 * horizontal-scale path: runPipeline is the worker body.)
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ResolutionManifestEntry } from "@udaan/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig } from "@udaan/shared";
import { S3ObjectStore, storageKey, type ObjectStore } from "./phases/full-text-resolution/index.js";
import { buildPipelineDeps } from "./pipeline/index.js";
import { runPipeline, type PipelineResult, type ProgressEvent } from "./pipeline/runPipeline.js";

interface Job {
  projectId: string;
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
  const app = Fastify({ logger: false });
  const jobs = new Map<string, Job>();

  let store = options.store ?? null;
  const getStore = (): ObjectStore => {
    if (!store) store = new S3ObjectStore(loadConfig().s3);
    return store;
  };

  function startJob(query: string, projectId: string, userId: string): string {
    const id = randomUUID();
    const job: Job = { projectId, events: [], paywalled: [], done: false };
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

  app.post<{ Body: { query: string; projectId?: string; userId?: string } }>("/research", async (req, reply) => {
    const { query, projectId = `proj_${randomUUID().slice(0, 8)}`, userId = "anonymous" } = req.body ?? {};
    if (!query || typeof query !== "string") {
      return reply.code(400).send({ error: "query is required" });
    }
    const jobId = startJob(query, projectId, userId);
    return reply.code(202).send({ jobId, projectId });
  });

  app.get<{ Params: { id: string } }>("/research/:id", async (req, reply) => {
    const job = jobs.get(req.params.id);
    if (!job) return reply.code(404).send({ error: "not found" });
    return {
      done: job.done,
      projectId: job.projectId,
      events: job.events,
      paywalled: job.paywalled,
      result: job.result,
      error: job.error,
    };
  });

  app.get<{ Params: { id: string } }>("/research/:id/stream", (req, reply) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
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
  app.post<{ Body: { doi: string | null; internalId: string; pdfBase64: string } }>(
    "/uploads",
    async (req, reply) => {
      const { doi = null, internalId, pdfBase64 } = req.body ?? {};
      if (!internalId || !pdfBase64) {
        return reply.code(400).send({ error: "internalId and pdfBase64 are required" });
      }
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
