"""Cross-phase contracts (Pydantic view).

The JSON Schemas in ``../../schema/`` are the source of truth; these models are
kept in sync with them (codegen target: ``datamodel-code-generator``). Field
aliases are camelCase to match the on-the-wire JSON shared with the TypeScript
side. Validate payloads at every phase boundary and queue job.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class _Base(BaseModel):
    # Accept camelCase JSON in, and allow constructing by snake_case field name.
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


# --- Enums (schema/enums.schema.json) ---
class ResolutionStatus(str, Enum):
    PENDING = "PENDING"
    RESOLVED_CACHE = "RESOLVED_CACHE"
    RESOLVED_DOWNLOAD = "RESOLVED_DOWNLOAD"
    PAYWALLED = "PAYWALLED"
    FAILED_CORRUPTED = "FAILED_CORRUPTED"


class ClaimClassification(str, Enum):
    FINDING = "FINDING"
    HYPOTHESIS = "HYPOTHESIS"
    LIMITATION = "LIMITATION"
    METHODOLOGY = "METHODOLOGY"


class ClusterPolarity(str, Enum):
    AGREEMENT = "AGREEMENT"
    CONTRADICTION = "CONTRADICTION"
    THIN_EVIDENCE = "THIN_EVIDENCE"
    NOISE = "NOISE"


# --- Phase 1: CompiledDiscoveryManifest ---
class TemporalBounds(_Base):
    start_year: int | None = Field(default=None, alias="startYear")
    end_year: int | None = Field(default=None, alias="endYear")


class SearchContext(_Base):
    original_query: str = Field(alias="originalQuery")
    temporal_bounds: TemporalBounds | None = Field(default=None, alias="temporalBounds")
    core_concepts: list[str] = Field(alias="coreConcepts")


class Compilations(_Base):
    boolean_standard: str = Field(alias="booleanStandard")
    open_alex_filter: str | None = Field(default=None, alias="openAlexFilter")
    semantic_scholar_payload: dict | None = Field(default=None, alias="semanticScholarPayload")


class DiscoveryTelemetry(_Base):
    input_tokens: int | None = Field(default=None, alias="inputTokens")
    classification_status: str | None = Field(default=None, alias="classificationStatus")
    degraded_mode: bool | None = Field(default=None, alias="degradedMode")


class CompiledDiscoveryManifest(_Base):
    project_id: str = Field(alias="projectId")
    search_context: SearchContext = Field(alias="searchContext")
    compilations: Compilations
    telemetry: DiscoveryTelemetry | None = None


# --- Phase 2: CandidatePaper ---
class CandidatePaper(_Base):
    internal_id: str = Field(alias="internalId")
    doi: str | None
    title: str
    abstract: str = Field(min_length=50)
    authors: list[str]
    publication_date: str = Field(alias="publicationDate")
    citation_count: int = Field(alias="citationCount", ge=0)
    source_providers: list[str] = Field(alias="sourceProviders")
    source_urls: list[str] = Field(alias="sourceUrls")


# --- Phase 3: PrioritizedIngestionIndex ---
class RankedPaper(_Base):
    rank: int = Field(ge=1)
    relevance_score: float = Field(alias="relevanceScore", ge=0, le=1)
    internal_id: str = Field(alias="internalId")
    doi: str | None
    title: str
    abstract: str
    publication_date: str = Field(alias="publicationDate")


class PrioritizedIngestionIndex(_Base):
    project_id: str = Field(alias="projectId")
    total_processed: int = Field(alias="totalProcessed", ge=0)
    total_filtered: int = Field(alias="totalFiltered", ge=0)
    ranked_manifest: list[RankedPaper] = Field(alias="rankedManifest")


# --- Phase 4: ResolutionManifest ---
class MetadataSnapshot(_Base):
    title: str


class ResolutionSummary(_Base):
    total_requested: int = Field(alias="totalRequested", ge=0)
    successfully_resolved: int = Field(alias="successfullyResolved", ge=0)
    paywalled: int = Field(ge=0)


class ResolutionManifestEntry(_Base):
    internal_id: str = Field(alias="internalId")
    doi: str | None
    status: ResolutionStatus
    storage_pointer: str | None = Field(alias="storagePointer")
    metadata_snapshot: MetadataSnapshot = Field(alias="metadataSnapshot")


class ResolutionManifest(_Base):
    project_id: str = Field(alias="projectId")
    resolution_summary: ResolutionSummary = Field(alias="resolutionSummary")
    manifest: list[ResolutionManifestEntry]


# --- Phase 5: ValidatedClaim ---
class ClaimLineage(_Base):
    section: str
    sub_section: str | None = Field(default=None, alias="subSection")
    page_number: int = Field(alias="pageNumber", ge=0)
    structural_node_type: str = Field(alias="structuralNodeType")


class ValidatedClaim(_Base):
    claim_id: str = Field(alias="claimId")
    project_id: str = Field(alias="projectId")
    document_doi: str | None = Field(alias="documentDoi")
    claim_classification: ClaimClassification = Field(alias="claimClassification")
    claim_text: str = Field(alias="claimText")
    source_quote: str = Field(alias="sourceQuote")
    lineage: ClaimLineage
    vector_embedding: list[float] | None = Field(default=None, alias="vectorEmbedding")


# --- Phase 6: SynthesisGraph ---
class SynthesisClaimRef(_Base):
    claim_id: str = Field(alias="claimId")
    doi: str | None
    text: str


class SynthesisCluster(_Base):
    cluster_id: str = Field(alias="clusterId")
    generated_topic_label: str = Field(alias="generatedTopicLabel")
    polarity: ClusterPolarity
    claims: list[SynthesisClaimRef]


class SynthesisGraph(_Base):
    project_id: str = Field(alias="projectId")
    synthesis_graph: list[SynthesisCluster] = Field(alias="synthesisGraph")


# --- Phase 7: ResearchBrief ---
class BibliographyEntry(_Base):
    claim_id: str = Field(alias="claimId")
    doi: str | None
    text: str


class BriefSection(_Base):
    heading: str
    body_text: str = Field(alias="bodyText")


class BriefMetadata(_Base):
    total_claims: int = Field(alias="totalClaims", ge=0)
    sections_generated: int = Field(alias="sectionsGenerated", ge=0)


class ResearchBrief(_Base):
    project_id: str = Field(alias="projectId")
    metadata: BriefMetadata
    sections: list[BriefSection]
    bibliography: dict[str, BibliographyEntry]
