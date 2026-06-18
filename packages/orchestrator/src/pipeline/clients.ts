/**
 * HTTP clients for the Python services (Phases 3, 5, 6). Defined behind narrow
 * interfaces so the pipeline can be driven with fakes in tests.
 */

import type { PrioritizedIngestionIndex, CandidatePaper, SynthesisGraph } from "@udaan/contracts";
import { resilientFetch } from "../util/resilience.js";

/** One service stage's active implementation and whether it is a fallback. */
export interface StageQuality {
  stage: string;
  implementation: string;
  degraded: boolean;
}

export interface RankingService {
  rerank(input: {
    projectId: string;
    originalQuery: string;
    candidatePapers: CandidatePaper[];
  }): Promise<PrioritizedIngestionIndex>;
  /** Report which implementation each stage is running (issue #17). */
  quality?(): Promise<StageQuality[]>;
}

export interface ParsingService {
  ingest(input: {
    projectId: string;
    documentDoi: string | null;
    /** Vault pointer (s3://bucket/key); the parser reads the PDF directly. */
    storagePointer: string;
  }): Promise<{ claimsExtracted: number }>;
  quality?(): Promise<StageQuality[]>;
}

export interface SynthesisService {
  synthesize(input: { projectId: string }): Promise<SynthesisGraph>;
  quality?(): Promise<StageQuality[]>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
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
  return (await res.json()) as T;
}

/** Read a service's `/health`, returning its declared stage quality (or none). */
async function fetchQuality(baseUrl: string): Promise<StageQuality[]> {
  try {
    const res = await fetch(`${baseUrl}/health`, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const data = (await res.json()) as { stages?: StageQuality[] };
    return Array.isArray(data.stages) ? data.stages : [];
  } catch {
    return [];
  }
}

export class HttpRankingService implements RankingService {
  constructor(private readonly baseUrl: string) {}
  rerank(input: { projectId: string; originalQuery: string; candidatePapers: CandidatePaper[] }) {
    return postJson<PrioritizedIngestionIndex>(`${this.baseUrl}/rerank`, input);
  }
  quality() {
    return fetchQuality(this.baseUrl);
  }
}

export class HttpParsingService implements ParsingService {
  constructor(private readonly baseUrl: string) {}
  ingest(input: { projectId: string; documentDoi: string | null; storagePointer: string }) {
    return postJson<{ claimsExtracted: number }>(`${this.baseUrl}/ingest`, input);
  }
  quality() {
    return fetchQuality(this.baseUrl);
  }
}

export class HttpSynthesisService implements SynthesisService {
  constructor(private readonly baseUrl: string) {}
  synthesize(input: { projectId: string }) {
    return postJson<SynthesisGraph>(`${this.baseUrl}/synthesize`, input);
  }
  quality() {
    return fetchQuality(this.baseUrl);
  }
}
