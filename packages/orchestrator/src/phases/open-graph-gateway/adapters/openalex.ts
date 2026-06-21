/** OpenAlex adapter — parses the inverted-index abstract format. */

import { randomUUID } from "node:crypto";
import type { CandidatePaper, CompiledDiscoveryManifest } from "@udaan/contracts";
import { normalizeDoi, reconstructInvertedAbstract, stripTags } from "../normalize.js";
import { resilientFetch } from "../../../util/resilience.js";
import type { OpenGraphProvider } from "../types.js";

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  display_name?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: Array<{ author?: { display_name?: string } }>;
  publication_date?: string | null;
  cited_by_count?: number;
}

export class OpenAlexAdapter implements OpenGraphProvider {
  readonly name = "OpenAlex";

  constructor(
    private readonly baseUrl = "https://api.openalex.org",
    private readonly perPage = 200,
  ) {}

  async search(manifest: CompiledDiscoveryManifest, signal?: AbortSignal): Promise<CandidatePaper[]> {
    const filter = manifest.compilations.openAlexFilter;
    if (!filter) return [];
    const url = `${this.baseUrl}/works?filter=${encodeURIComponent(filter)}&per-page=${this.perPage}`;
    const res = await resilientFetch(
      url,
      { headers: { accept: "application/json" } },
      { signal, retries: 2, baseDelayMs: 200, maxDelayMs: 2000 },
    );
    if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
    const data = (await res.json()) as { results?: OpenAlexWork[] };
    return (data.results ?? []).map((w) => this.toCandidate(w));
  }

  private toCandidate(w: OpenAlexWork): CandidatePaper {
    return {
      internalId: randomUUID(),
      doi: normalizeDoi(w.doi ?? null),
      title: stripTags(w.display_name ?? ""),
      abstract: reconstructInvertedAbstract(w.abstract_inverted_index),
      authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter((n) => n.length > 0),
      publicationDate: w.publication_date ?? "",
      citationCount: w.cited_by_count ?? 0,
      sourceProviders: [this.name],
      sourceUrls: w.id ? [w.id] : [],
    };
  }
}
