/**
 * End-to-end pipeline driver: chains Phases 1-7 for one research query.
 * In-proc TS phases (1, 2, 4, 7) run directly; Python phases (3, 5, 6) go over
 * HTTP via injected service clients. Progress is emitted per phase so an API
 * can stream it (SSE). This same function is the body of the BullMQ worker.
 */

import type { ResearchBrief, ResolutionManifestEntry } from "@udaan/contracts";
import type { LLMProvider } from "@udaan/shared";
import { orchestrateQuery, type QueryCache, type ResearchQueryRequest } from "../phases/query-orchestration/index.js";
import { runGateway } from "../phases/open-graph-gateway/index.js";
import type { OpenGraphProvider } from "../phases/open-graph-gateway/index.js";
import { runFullTextResolution, storageKey, type ObjectStore } from "../phases/full-text-resolution/index.js";
import type { FetchLike } from "../phases/full-text-resolution/index.js";
import { runGeneration } from "../phases/generation-citation-weaving/index.js";
import type { ParsingService, RankingService, SynthesisService } from "./clients.js";

export interface ProgressEvent {
  phase: number;
  name: string;
  status: "start" | "done";
  detail?: string;
}

export interface PipelineDeps {
  llm: LLMProvider;
  cache: QueryCache;
  adapters: OpenGraphProvider[];
  ranking: RankingService;
  store: ObjectStore;
  parsing: ParsingService;
  synthesis: SynthesisService;
  fetchImpl?: FetchLike;
  onProgress?: (event: ProgressEvent) => void;
  /** Called after Phase 4 with papers that could not be resolved (paywalled). */
  onPaywalled?: (entries: ResolutionManifestEntry[]) => void;
}

export type PipelineResult =
  | { status: "ok"; brief: ResearchBrief }
  | { status: "rejected"; reason: string };

export async function runPipeline(
  request: ResearchQueryRequest,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const emit = (phase: number, name: string, status: "start" | "done", detail?: string) =>
    deps.onProgress?.({ phase, name, status, detail });

  // Phase 1 — Query Orchestration
  emit(1, "Query Orchestration", "start");
  const compiled = await orchestrateQuery(request, { llm: deps.llm, cache: deps.cache });
  if (compiled.status === "rejected") {
    return { status: "rejected", reason: compiled.reason };
  }
  const manifest = compiled.manifest;
  emit(1, "Query Orchestration", "done");

  // Phase 2 — Open Graph Gateway
  emit(2, "Open Graph Gateway", "start");
  const { candidates } = await runGateway(manifest, { adapters: deps.adapters });
  emit(2, "Open Graph Gateway", "done", `${candidates.length} candidates`);

  // Phase 3 — Cross-Encoder Re-Ranking (service)
  emit(3, "Cross-Encoder Re-Ranking", "start");
  const ranked = await deps.ranking.rerank({
    projectId: request.projectId,
    originalQuery: manifest.searchContext.originalQuery,
    candidatePapers: candidates,
  });
  emit(3, "Cross-Encoder Re-Ranking", "done", `${ranked.rankedManifest.length} ranked`);

  // Phase 4 — JIT Full-Text Resolution
  emit(4, "Full-Text Resolution", "start");
  const resolution = await runFullTextResolution(ranked, {
    store: deps.store,
    fetchImpl: deps.fetchImpl,
  });
  emit(4, "Full-Text Resolution", "done", `${resolution.resolutionSummary.successfullyResolved} resolved`);

  const paywalled = resolution.manifest.filter((e) => e.status === "PAYWALLED");
  if (paywalled.length > 0) deps.onPaywalled?.(paywalled);

  // Phase 5 — Ingestion & Parsing (service); feed each resolved PDF's bytes.
  emit(5, "Ingestion & Parsing", "start");
  let claimsExtracted = 0;
  for (const entry of resolution.manifest) {
    if (entry.status !== "RESOLVED_CACHE" && entry.status !== "RESOLVED_DOWNLOAD") continue;
    const bytes = await deps.store.get(storageKey(entry.doi, entry.internalId));
    if (!bytes) continue;
    const pdfBase64 = Buffer.from(bytes).toString("base64");
    const res = await deps.parsing.ingest({ projectId: request.projectId, documentDoi: entry.doi, pdfBase64 });
    claimsExtracted += res.claimsExtracted;
  }
  emit(5, "Ingestion & Parsing", "done", `${claimsExtracted} claims`);

  // Phase 6 — Cross-Source Synthesis & Polarity (service)
  emit(6, "Synthesis & Polarity", "start");
  const graph = await deps.synthesis.synthesize({ projectId: request.projectId });
  emit(6, "Synthesis & Polarity", "done", `${graph.synthesisGraph.length} clusters`);

  // Phase 7 — Constrained Generation & Citation Weaving
  emit(7, "Generation & Citation Weaving", "start");
  const brief = await runGeneration(graph, { llm: deps.llm });
  emit(7, "Generation & Citation Weaving", "done", `${brief.sections.length} sections`);

  return { status: "ok", brief };
}
