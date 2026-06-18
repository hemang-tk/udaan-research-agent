/**
 * HTTP clients for the Python services (Phases 3, 5, 6). Defined behind narrow
 * interfaces so the pipeline can be driven with fakes in tests.
 */

import type { PrioritizedIngestionIndex, CandidatePaper, SynthesisGraph } from "@udaan/contracts";
import { validatePrioritizedIngestionIndex, validateSynthesisGraph } from "@udaan/shared";

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
    pdfBase64: string;
  }): Promise<{ claimsExtracted: number }>;
}

export interface SynthesisService {
  synthesize(input: { projectId: string }): Promise<SynthesisGraph>;
}

async function postJson<T>(url: string, body: unknown, validate: (data: unknown) => T): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  // Validate at the boundary: a malformed/changed service response is rejected
  // here with a descriptive error rather than corrupting the pipeline downstream.
  return validate(await res.json());
}

const validateIngestResult = (data: unknown): { claimsExtracted: number } => {
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as { claimsExtracted?: unknown }).claimsExtracted !== "number"
  ) {
    throw new Error("parsing /ingest response missing numeric claimsExtracted");
  }
  return { claimsExtracted: (data as { claimsExtracted: number }).claimsExtracted };
};

export class HttpRankingService implements RankingService {
  constructor(private readonly baseUrl: string) {}
  rerank(input: { projectId: string; originalQuery: string; candidatePapers: CandidatePaper[] }) {
    return postJson(`${this.baseUrl}/rerank`, input, validatePrioritizedIngestionIndex);
  }
}

export class HttpParsingService implements ParsingService {
  constructor(private readonly baseUrl: string) {}
  ingest(input: { projectId: string; documentDoi: string | null; pdfBase64: string }) {
    return postJson(`${this.baseUrl}/ingest`, input, validateIngestResult);
  }
}

export class HttpSynthesisService implements SynthesisService {
  constructor(private readonly baseUrl: string) {}
  synthesize(input: { projectId: string }) {
    return postJson(`${this.baseUrl}/synthesize`, input, validateSynthesisGraph);
  }
}
