import type {
  PaywalledEntry,
  PipelineResult,
  ProgressEvent,
  ResearchBrief,
  ResearchSummary,
} from "./types.js";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export async function startResearch(query: string): Promise<{ jobId: string; projectId: string }> {
  const res = await fetch(`${API_BASE}/research`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Engine returned ${res.status}`);
  return res.json();
}

export interface StreamHandlers {
  onProgress: (event: ProgressEvent) => void;
  onResult: (result: PipelineResult) => void;
  onError: () => void;
}

/** Subscribe to the SSE progress stream. Returns an unsubscribe function. */
export function streamProgress(jobId: string, handlers: StreamHandlers): () => void {
  const source = new EventSource(`${API_BASE}/research/${jobId}/stream`);

  source.addEventListener("progress", (e) => {
    handlers.onProgress(JSON.parse((e as MessageEvent).data) as ProgressEvent);
  });
  source.addEventListener("result", (e) => {
    handlers.onResult(JSON.parse((e as MessageEvent).data) as PipelineResult);
    source.close();
  });
  source.onerror = () => {
    handlers.onError();
    source.close();
  };

  return () => source.close();
}

export interface JobStatus {
  done: boolean;
  projectId: string;
  paywalled: PaywalledEntry[];
}

export async function getStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${API_BASE}/research/${jobId}`);
  if (!res.ok) throw new Error(`Status ${res.status}`);
  return res.json();
}

/** Past research sessions, most recent first. Empty if persistence is off/unreachable. */
export async function getHistory(): Promise<ResearchSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/history`);
    if (!res.ok) return [];
    const data = (await res.json()) as { researches?: ResearchSummary[] };
    return data.researches ?? [];
  } catch {
    return [];
  }
}

/** Load a past research's brief by id (from the History store). */
export async function getResearch(id: string): Promise<ResearchBrief | null> {
  const res = await fetch(`${API_BASE}/research/${id}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: { brief?: ResearchBrief } };
  return data.result?.brief ?? null;
}

export interface ResearchDetail {
  query: string;
  createdAt?: string;
  brief: ResearchBrief;
  paywalled: PaywalledEntry[];
}

/** Full record for the detail page: the brief plus its query/date and any
 *  paywalled sources. Works for both in-memory (just-run) and persisted jobs. */
export async function getResearchRecord(id: string): Promise<ResearchDetail | null> {
  const res = await fetch(`${API_BASE}/research/${id}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    query?: string;
    createdAt?: string;
    paywalled?: PaywalledEntry[];
    result?: { brief?: ResearchBrief };
  };
  const brief = data.result?.brief;
  if (!brief) return null;
  return {
    query: data.query ?? "",
    createdAt: data.createdAt,
    brief,
    paywalled: data.paywalled ?? [],
  };
}

export async function uploadPdf(input: {
  doi: string | null;
  internalId: string;
  pdfBase64: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}
