import type { Config } from "@udaan/shared";
import { createLLMProvider } from "@udaan/shared";
import { registerOllama } from "../providers/ollama.js";
import { InMemoryQueryCache } from "../phases/query-orchestration/index.js";
import { defaultAdapters } from "../phases/open-graph-gateway/index.js";
import { S3ObjectStore } from "../phases/full-text-resolution/index.js";
import { HttpParsingService, HttpRankingService, HttpSynthesisService } from "./clients.js";
import type { PipelineDeps, ProgressEvent } from "./runPipeline.js";

export * from "./clients.js";
export { runPipeline, type PipelineDeps, type PipelineResult, type ProgressEvent } from "./runPipeline.js";

/** Construct real pipeline dependencies from config (used by the API/worker). */
export interface BuildDepsHooks {
  onProgress?: PipelineDeps["onProgress"];
  onPaywalled?: PipelineDeps["onPaywalled"];
}

export function buildPipelineDeps(config: Config, hooks: BuildDepsHooks = {}): PipelineDeps {
  registerOllama();
  return {
    llm: createLLMProvider(config),
    cache: new InMemoryQueryCache(),
    adapters: defaultAdapters(),
    ranking: new HttpRankingService(config.services.ranking),
    parsing: new HttpParsingService(config.services.parsing),
    synthesis: new HttpSynthesisService(config.services.synthesis),
    store: new S3ObjectStore(config.s3),
    onProgress: hooks.onProgress,
    onPaywalled: hooks.onPaywalled,
  };
}
