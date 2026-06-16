/** Semantic Scholar Graph API adapter. */

import { randomUUID } from "node:crypto";
import type { CandidatePaper, CompiledDiscoveryManifest } from "@udaan/contracts";
import { normalizeDoi, stripTags } from "../normalize.js";
import type { OpenGraphProvider } from "../types.js";

interface S2Paper {
  title?: string | null;
  abstract?: string | null;
  year?: number | null;
  citationCount?: number | null;
  externalIds?: { DOI?: string | null } | null;
  authors?: Array<{ name?: string }>;
  url?: string | null;
}

export class SemanticScholarAdapter implements OpenGraphProvider {
  readonly name = "SemanticScholar";

  constructor(private readonly baseUrl = "https://api.semanticscholar.org/graph/v1", private readonly limit = 100) {}

  async search(manifest: CompiledDiscoveryManifest, signal?: AbortSignal): Promise<CandidatePaper[]> {
    const payload = manifest.compilations.semanticScholarPayload as { query?: string } | undefined;
    const query = payload?.query ?? manifest.searchContext.originalQuery;
    const fields = "title,abstract,year,citationCount,externalIds,authors,url";
    const url = `${this.baseUrl}/paper/search?query=${encodeURIComponent(query)}&fields=${fields}&limit=${this.limit}`;
    const res = await fetch(url, { signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`SemanticScholar ${res.status}`);
    const data = (await res.json()) as { data?: S2Paper[] };
    return (data.data ?? []).map((p) => this.toCandidate(p));
  }

  private toCandidate(p: S2Paper): CandidatePaper {
    return {
      internalId: randomUUID(),
      doi: normalizeDoi(p.externalIds?.DOI ?? null),
      title: stripTags(p.title ?? ""),
      abstract: stripTags(p.abstract ?? ""),
      authors: (p.authors ?? []).map((a) => a.name ?? "").filter((n) => n.length > 0),
      publicationDate: p.year ? `${p.year}-01-01` : "",
      citationCount: p.citationCount ?? 0,
      sourceProviders: [this.name],
      sourceUrls: p.url ? [p.url] : [],
    };
  }
}
