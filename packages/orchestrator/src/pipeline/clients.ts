/**
 * HTTP clients for the Python services (Phases 3, 5, 6). Defined behind narrow
 * interfaces so the pipeline can be driven with fakes in tests.
 */

import type {
  PrioritizedIngestionIndex,
  CandidatePaper,
  IngestResult,
  SynthesisGraph,
} from "@udaan/contracts";
import {
  validateIngestResult,
  validatePrioritizedIngestionIndex,
  validateSynthesisGraph,
} from "@udaan/shared";
import { resilientFetch } from "../util/resilience.js";

export interface RankingService {
  rerank(input: {
    projectId: string;
    originalQuery: string;
    candidatePapers: CandidatePaper[];
  }): Promise<PrioritizedIngestionIndex>;
}

export interface ParsingService {
  ingest(input: {
    projectId: string;
    documentDoi: string | null;
    /** Vault pointer (s3://bucket/key); the parser reads the PDF directly. */
    storagePointer: string;
  }): Promise<IngestResult>;
}

export interface SynthesisService {
  synthesize(input: { projectId: string }): Promise<SynthesisGraph>;
}

async function postJson<T>(url: string, body: unknown, validate: (data: unknown) => T): Promise<T> {
  // Inter-service calls are effectively idempotent (rerank/ingest/synthesize for
  // a project), so a bounded retry with timeout is safe and avoids turning a
  // transient blip or a hung service into a hard pipeline failure.
  const res = await resilientFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: 30_000, retries: 2 },
  );
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  // Validate at the boundary: a malformed/changed service response is rejected
  // here with a descriptive error rather than corrupting the pipeline downstream.
  return validate(await res.json());
}

export class HttpRankingService implements RankingService {
  constructor(private readonly baseUrl: string) {}
  rerank(input: { projectId: string; originalQuery: string; candidatePapers: CandidatePaper[] }) {
    return postJson(`${this.baseUrl}/rerank`, input, validatePrioritizedIngestionIndex);
  }
}

export class HttpParsingService implements ParsingService {
  constructor(private readonly baseUrl: string) {}
  ingest(input: { projectId: string; documentDoi: string | null; storagePointer: string }) {
    return postJson(`${this.baseUrl}/ingest`, input, validateIngestResult);
  }
}

export class HttpSynthesisService implements SynthesisService {
  constructor(private readonly baseUrl: string) {}
  synthesize(input: { projectId: string }) {
    return postJson(`${this.baseUrl}/synthesize`, input, validateSynthesisGraph);
  }
}
