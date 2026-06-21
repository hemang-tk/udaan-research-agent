/** Crossref REST API adapter. */

import { randomUUID } from "node:crypto";
import type { CandidatePaper, CompiledDiscoveryManifest } from "@udaan/contracts";
import { normalizeDoi, stripTags } from "../normalize.js";
import { resilientFetch } from "../../../util/resilience.js";
import type { OpenGraphProvider } from "../types.js";

interface CrossrefItem {
  DOI?: string | null;
  title?: string[];
  abstract?: string | null;
  author?: Array<{ family?: string; given?: string }>;
  published?: { "date-parts"?: number[][] };
  "is-referenced-by-count"?: number;
  URL?: string | null;
}

function formatDate(parts?: number[][]): string {
  const dp = parts?.[0];
  if (!dp || dp.length === 0) return "";
  const [year, month = 1, day = 1] = dp;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

export class CrossrefAdapter implements OpenGraphProvider {
  readonly name = "Crossref";

  constructor(
    private readonly baseUrl = "https://api.crossref.org",
    private readonly rows = 100,
  ) {}

  async search(manifest: CompiledDiscoveryManifest, signal?: AbortSignal): Promise<CandidatePaper[]> {
    const query = manifest.searchContext.coreConcepts.join(" ") || manifest.searchContext.originalQuery;
    const url = `${this.baseUrl}/works?query=${encodeURIComponent(query)}&rows=${this.rows}`;
    const res = await resilientFetch(
      url,
      { headers: { accept: "application/json" } },
      { signal, retries: 2, baseDelayMs: 200, maxDelayMs: 2000 },
    );
    if (!res.ok) throw new Error(`Crossref ${res.status}`);
    const data = (await res.json()) as { message?: { items?: CrossrefItem[] } };
    return (data.message?.items ?? []).map((item) => this.toCandidate(item));
  }

  private toCandidate(item: CrossrefItem): CandidatePaper {
    const authors = (item.author ?? [])
      .map((a) => [a.family, a.given].filter(Boolean).join(", "))
      .filter((n) => n.length > 0);
    return {
      internalId: randomUUID(),
      doi: normalizeDoi(item.DOI ?? null),
      title: stripTags(item.title?.[0] ?? ""),
      abstract: stripTags(item.abstract ?? ""),
      authors,
      publicationDate: formatDate(item.published?.["date-parts"]),
      citationCount: item["is-referenced-by-count"] ?? 0,
      sourceProviders: [this.name],
      sourceUrls: item.URL ? [item.URL] : [],
    };
  }
}
