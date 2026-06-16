/**
 * Thin HTTP API for the orchestrator. Runs the pipeline in-process and streams
 * per-phase progress over SSE. (BullMQ is the horizontal-scale path: runPipeline
 * is the worker body; the API would enqueue instead of running in-process.)
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig } from "@udaan/shared";
import { buildPipelineDeps } from "./pipeline/index.js";
import { runPipeline, type PipelineResult, type ProgressEvent } from "./pipeline/runPipeline.js";

interface Job {
  events: ProgressEvent[];
  result?: PipelineResult;
  error?: string;
  done: boolean;
}

const jobs = new Map<string, Job>();

function startJob(query: string, projectId: string, userId: string): string {
  const id = randomUUID();
  const job: Job = { events: [], done: false };
  jobs.set(id, job);

  const config = loadConfig();
  const deps = buildPipelineDeps(config, (event) => job.events.push(event));
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

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });

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
    return { done: job.done, events: job.events, result: job.result, error: job.error };
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
