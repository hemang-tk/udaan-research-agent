import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRankingService, HttpSynthesisService } from "./clients.js";

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const res = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: "OK",
    json: async () => body,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => res as unknown as Response),
  );
}

const validIndex = {
  projectId: "p1",
  totalProcessed: 1,
  totalFiltered: 1,
  rankedManifest: [
    {
      rank: 1,
      relevanceScore: 0.9,
      internalId: "i1",
      doi: null,
      title: "t",
      abstract: "a",
      publicationDate: "2024-01-01",
    },
  ],
};

const validGraph = { projectId: "p1", synthesisGraph: [] };

describe("HTTP service clients — boundary validation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns a valid ranking response", async () => {
    mockFetchOnce(validIndex);
    const svc = new HttpRankingService("http://ranking");
    const out = await svc.rerank({ projectId: "p1", originalQuery: "q", candidatePapers: [] });
    expect(out.rankedManifest[0]?.rank).toBe(1);
  });

  it("rejects a ranking response with a wrong-typed field", async () => {
    mockFetchOnce({ ...validIndex, totalProcessed: "nope" });
    const svc = new HttpRankingService("http://ranking");
    await expect(svc.rerank({ projectId: "p1", originalQuery: "q", candidatePapers: [] })).rejects.toThrow(
      /PrioritizedIngestionIndex failed schema validation/,
    );
  });

  it("rejects a ranking response missing a required field", async () => {
    const { rankedManifest, ...missing } = validIndex;
    void rankedManifest;
    mockFetchOnce(missing);
    const svc = new HttpRankingService("http://ranking");
    await expect(svc.rerank({ projectId: "p1", originalQuery: "q", candidatePapers: [] })).rejects.toThrow(
      /failed schema validation/,
    );
  });

  it("accepts a valid synthesis graph and rejects an invalid polarity", async () => {
    mockFetchOnce(validGraph);
    const svc = new HttpSynthesisService("http://synth");
    expect((await svc.synthesize({ projectId: "p1" })).synthesisGraph).toEqual([]);

    mockFetchOnce({
      projectId: "p1",
      synthesisGraph: [{ clusterId: "c1", generatedTopicLabel: "x", polarity: "WRONG", claims: [] }],
    });
    await expect(svc.synthesize({ projectId: "p1" })).rejects.toThrow(/SynthesisGraph failed schema validation/);
  });
});
