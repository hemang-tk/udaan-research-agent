/**
 * Phase 2 entrypoint: concurrently query the academic graphs, normalize and
 * drop low-quality records, deduplicate, and emit a bounded CandidatePaper pool
 * for Phase 3.
 *
 *   dispatch (concurrent, timed) -> drop invalid -> deduplicate -> truncate
 */

import type { CandidatePaper, CompiledDiscoveryManifest } from "@udaan/contracts";
import { CrossrefAdapter } from "./adapters/crossref.js";
import { OpenAlexAdapter } from "./adapters/openalex.js";
import { SemanticScholarAdapter } from "./adapters/semantic-scholar.js";
import { deduplicate } from "./dedupe.js";
import { CircuitBreaker, dispatchAll, getSharedBreaker } from "./dispatcher.js";
import { dropInvalid } from "./normalize.js";
import type { AdapterResult, OpenGraphProvider } from "./types.js";

/** Bound the pool to constrain Phase 3 compute (Phase 2 §3.2). */
export const MAX_CANDIDATES = 500;

export function defaultAdapters(): OpenGraphProvider[] {
  return [new OpenAlexAdapter(), new SemanticScholarAdapter(), new CrossrefAdapter()];
}

export interface GatewayDeps {
  adapters?: OpenGraphProvider[];
  breaker?: CircuitBreaker;
  timeoutMs?: number;
}

export interface GatewayResult {
  candidates: CandidatePaper[];
  providerResults: AdapterResult[];
}

export async function runGateway(
  manifest: CompiledDiscoveryManifest,
  deps: GatewayDeps = {},
): Promise<GatewayResult> {
  const adapters = deps.adapters ?? defaultAdapters();
  // Default to the process-scoped breaker so repeated provider failures across
  // requests actually trip it (and short-circuit) instead of resetting each run.
  const providerResults = await dispatchAll(adapters, manifest, {
    timeoutMs: deps.timeoutMs,
    breaker: deps.breaker ?? getSharedBreaker(),
  });

  const all = providerResults.flatMap((r) => r.records);
  const deduped = deduplicate(dropInvalid(all));
  // Highest-citation first gives a deterministic, sensible truncation order.
  deduped.sort((a, b) => b.citationCount - a.citationCount);

  return { candidates: deduped.slice(0, MAX_CANDIDATES), providerResults };
}
