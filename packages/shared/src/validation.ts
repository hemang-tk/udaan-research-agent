/**
 * Runtime schema validation for the TypeScript service boundaries (issue #20).
 *
 * The Python services validate every incoming payload with Pydantic; the TS
 * side used to cast (`as PrioritizedIngestionIndex`) with no runtime check, so a
 * malformed/changed payload from a service or client slipped through and
 * surfaced as a confusing downstream failure. These validators are compiled
 * from the same contract JSON Schemas (`@udaan/contracts`) — no third copy — and
 * throw a descriptive `SchemaValidationError` on the first invalid payload.
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type {
  IngestResult,
  PrioritizedIngestionIndex,
  ResearchBrief,
  SynthesisGraph,
} from "@udaan/contracts";
import {
  ingestResultSchema,
  prioritizedIngestionIndexSchema,
  researchBriefSchema,
  synthesisGraphSchema,
} from "@udaan/contracts/schemas";

export class SchemaValidationError extends Error {
  constructor(
    readonly label: string,
    readonly errors: ErrorObject[],
  ) {
    super(`${label} failed schema validation: ${formatErrors(errors)}`);
    this.name = "SchemaValidationError";
  }
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "unknown error";
  return errors
    .slice(0, 5)
    .map((e) => `${e.instancePath || "(root)"} ${e.message ?? "is invalid"}`)
    .join("; ");
}

// `strict: false` because the contract schemas use draft-2020-12 keywords
// (`additionalProperties`, `$id`) that ajv's strict mode warns about; we want
// validation, not authoring lint here.
const ajv = new Ajv2020({ allErrors: true, strict: false });

function compile<T>(schema: unknown, label: string): (data: unknown) => T {
  const validate: ValidateFunction = ajv.compile(schema as object);
  return (data: unknown): T => {
    if (!validate(data)) {
      throw new SchemaValidationError(label, validate.errors ?? []);
    }
    return data as T;
  };
}

/** Validate a Phase 3 ranking-service response. Throws on mismatch. */
export const validatePrioritizedIngestionIndex = compile<PrioritizedIngestionIndex>(
  prioritizedIngestionIndexSchema,
  "PrioritizedIngestionIndex",
);

/** Validate a Phase 5 parsing-service `/ingest` response. Throws on mismatch. */
export const validateIngestResult = compile<IngestResult>(ingestResultSchema, "IngestResult");

/** Validate a Phase 6 synthesis-service response. Throws on mismatch. */
export const validateSynthesisGraph = compile<SynthesisGraph>(synthesisGraphSchema, "SynthesisGraph");

/** Validate a Phase 7 research brief. Throws on mismatch. */
export const validateResearchBrief = compile<ResearchBrief>(researchBriefSchema, "ResearchBrief");
