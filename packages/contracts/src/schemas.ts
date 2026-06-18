/**
 * Runtime access to the JSON Schemas in `../schema/` — the single source of
 * truth for cross-phase payloads. Exposed here so validators (see
 * `@udaan/shared`) can be driven by the same files the TypeScript types and the
 * Python Pydantic models mirror, with no third hand-written copy.
 *
 * Schemas are read from disk (relative to this module) rather than imported as
 * JSON so the loading works identically under tsx, vitest, and plain Node ESM.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");

function load(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(schemaDir, file), "utf8")) as Record<string, unknown>;
}

/** Phase 3 output — `PrioritizedIngestionIndex`. */
export const prioritizedIngestionIndexSchema = load("ranked-paper.schema.json");
/** Phase 6 output — `SynthesisGraph`. */
export const synthesisGraphSchema = load("synthesis-graph.schema.json");
/** Phase 7 output — `ResearchBrief`. */
export const researchBriefSchema = load("research-brief.schema.json");
/** Phase 2 record — `CandidatePaper`. */
export const candidatePaperSchema = load("candidate-paper.schema.json");
/** Phase 5 record — `ValidatedClaim`. */
export const validatedClaimSchema = load("validated-claim.schema.json");
/** Phase 5 `/ingest` response — `IngestResult`. */
export const ingestResultSchema = load("ingest-result.schema.json");
