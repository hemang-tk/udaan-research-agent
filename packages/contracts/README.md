# @udaan/contracts

The cross-phase data contracts — **the source of truth for every phase boundary**.

## How it works

- **`schema/*.schema.json`** — JSON Schema is the single source of truth.
- **`src/index.ts`** — TypeScript view (consumed by the orchestrator + web).
- **`python/udaan_contracts/models.py`** — Pydantic view (consumed by the Python services).

Both language views are kept in sync with the schemas and are intended to be
**code-generated**:

- TS: `pnpm gen` → `json-schema-to-typescript`
- Python: `datamodel-codegen --input ../schema --output udaan_contracts/models.py`

Until codegen is wired into the build, the two views are maintained by hand to
match the schemas. Treat the schema as authoritative if they ever disagree.

## The rule

**Validate at every boundary.** Every cross-service HTTP call (and every payload
handed between phases) validates against the matching schema, so a drift between
the TS and Python sides fails loudly instead of silently corrupting traceability.

## Coverage

Foundation set (vertical slice, Phases 1–3) is defined now:

| Contract | Producer → Consumer |
| --- | --- |
| `CompiledDiscoveryManifest` | Phase 1 → 2 |
| `CandidatePaper` | Phase 2 → 3 |
| `PrioritizedIngestionIndex` / `RankedPaper` | Phase 3 → 4 |
| Enums: `ResolutionStatus`, `ClaimClassification`, `ClusterPolarity` | shared |

Remaining contracts (`ResolutionManifest`, `ValidatedClaim`, `SynthesisGraph`,
`ResearchBrief`) are added to `schema/` as their phase is implemented.
