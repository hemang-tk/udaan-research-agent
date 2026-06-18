/**
 * Cross-phase contracts (TypeScript view).
 *
 * The JSON Schemas in `schema/` are the source of truth. These types are kept
 * in sync with them and will be code-generated via `pnpm gen`
 * (json-schema-to-typescript). The Python (Pydantic) mirror lives in
 * `python/udaan_contracts/models.py`. Validate payloads against the schema at
 * every phase boundary and every queue job.
 *
 * The runtime JSON Schemas (source of truth) are exposed from the separate
 * `@udaan/contracts/schemas` entry so browser consumers of these types do not
 * pull in the Node filesystem loader.
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

// --- Phase 5: ValidatedClaim ---
export interface ClaimLineage {
  section: string;
  subSection?: string | null;
  pageNumber: number;
  structuralNodeType: string;
}

export interface ValidatedClaim {
  claimId: string;
  projectId: string;
  documentDoi: string | null;
  claimClassification: ClaimClassification;
  claimText: string;
  /** Exact, unmodified substring of the source chunk. */
  sourceQuote: string;
  lineage: ClaimLineage;
  vectorEmbedding?: number[] | null;
}

/** Phase 5 `/ingest` response, consumed by the orchestrator pipeline. */
export interface IngestResult {
  projectId: string;
  claimsExtracted: number;
  claimIds: string[];
}

// --- Phase 6: SynthesisGraph ---
export interface SynthesisClaimRef {
  claimId: string;
  doi: string | null;
  text: string;
}

export interface SynthesisCluster {
  clusterId: string;
  generatedTopicLabel: string;
  polarity: ClusterPolarity;
  claims: SynthesisClaimRef[];
}

export interface SynthesisGraph {
  projectId: string;
  synthesisGraph: SynthesisCluster[];
}

// --- Phase 7: ResearchBrief ---
export interface BibliographyEntry {
  claimId: string;
  doi: string | null;
  text: string;
}

export interface BriefSection {
  heading: string;
  bodyText: string;
}

export interface ResearchBrief {
  projectId: string;
  metadata: { totalClaims: number; sectionsGenerated: number };
  sections: BriefSection[];
  bibliography: Record<string, BibliographyEntry>;
}
