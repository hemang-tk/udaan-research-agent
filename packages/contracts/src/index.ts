/**
 * Cross-phase contracts (TypeScript view).
 *
 * The JSON Schemas in `schema/` are the source of truth. These types are kept
 * in sync with them and will be code-generated via `pnpm gen`
 * (json-schema-to-typescript). The Python (Pydantic) mirror lives in
 * `python/udaan_contracts/models.py`. Validate payloads against the schema at
 * every phase boundary and every queue job.
 */

// --- Enums (schema/enums.schema.json) ---
export type ResolutionStatus =
  | "PENDING"
  | "RESOLVED_CACHE"
  | "RESOLVED_DOWNLOAD"
  | "PAYWALLED"
  | "FAILED_CORRUPTED";

export type ClaimClassification = "FINDING" | "HYPOTHESIS" | "LIMITATION" | "METHODOLOGY";

export type ClusterPolarity = "AGREEMENT" | "CONTRADICTION" | "THIN_EVIDENCE" | "NOISE";

// --- Phase 1: CompiledDiscoveryManifest ---
export interface TemporalBounds {
  startYear?: number;
  endYear?: number;
}

export interface SearchContext {
  originalQuery: string;
  temporalBounds?: TemporalBounds | null;
  coreConcepts: string[];
}

export interface Compilations {
  booleanStandard: string;
  openAlexFilter?: string;
  semanticScholarPayload?: Record<string, unknown>;
}

export interface DiscoveryTelemetry {
  inputTokens?: number;
  classificationStatus?: string;
  degradedMode?: boolean;
}

export interface CompiledDiscoveryManifest {
  projectId: string;
  searchContext: SearchContext;
  compilations: Compilations;
  telemetry?: DiscoveryTelemetry;
}

// --- Phase 2: CandidatePaper ---
export interface CandidatePaper {
  internalId: string;
  doi: string | null;
  title: string;
  abstract: string;
  authors: string[];
  publicationDate: string;
  citationCount: number;
  sourceProviders: string[];
  sourceUrls: string[];
}

// --- Phase 3: PrioritizedIngestionIndex ---
export interface RankedPaper {
  rank: number;
  relevanceScore: number;
  internalId: string;
  doi: string | null;
  title: string;
  abstract: string;
  publicationDate: string;
}

export interface PrioritizedIngestionIndex {
  projectId: string;
  totalProcessed: number;
  totalFiltered: number;
  rankedManifest: RankedPaper[];
}

// --- Phase 4: ResolutionManifest ---
export interface ResolutionManifestEntry {
  internalId: string;
  doi: string | null;
  status: ResolutionStatus;
  storagePointer: string | null;
  metadataSnapshot: { title: string };
}

export interface ResolutionManifest {
  projectId: string;
  resolutionSummary: {
    totalRequested: number;
    successfullyResolved: number;
    paywalled: number;
  };
  manifest: ResolutionManifestEntry[];
}
