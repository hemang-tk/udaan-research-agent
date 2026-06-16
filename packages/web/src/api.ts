import type { PipelineResult, ProgressEvent } from "./types.js";

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
