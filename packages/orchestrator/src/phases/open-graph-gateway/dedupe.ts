/**
 * Entity Resolution (Phase 2 §2.4). Two passes:
 *   Pass 1 — exact DOI match.
 *   Pass 2 — fuzzy hash (normalized title + first-author last name) for records
 *            without a DOI.
 * Duplicates are merged into one "Super DTO": longest abstract, most complete
 * author list, highest citation count, union of source providers/URLs.
 */

import type { CandidatePaper } from "@udaan/contracts";
import { fuzzyHash, normalizeDoi } from "./normalize.js";

function mergePair(a: CandidatePaper, b: CandidatePaper): CandidatePaper {
  return {
    internalId: a.internalId,
    doi: a.doi ?? b.doi,
    title: a.title.length >= b.title.length ? a.title : b.title,
    abstract: a.abstract.length >= b.abstract.length ? a.abstract : b.abstract,
    authors: a.authors.length >= b.authors.length ? a.authors : b.authors,
    publicationDate: a.publicationDate || b.publicationDate,
    citationCount: Math.max(a.citationCount, b.citationCount),
    sourceProviders: Array.from(new Set([...a.sourceProviders, ...b.sourceProviders])),
    sourceUrls: Array.from(new Set([...a.sourceUrls, ...b.sourceUrls])),
  };
}

export function deduplicate(records: CandidatePaper[]): CandidatePaper[] {
  const byKey = new Map<string, CandidatePaper>();

  for (const record of records) {
    const doi = normalizeDoi(record.doi);
    const key = doi ? `doi:${doi}` : `fuzzy:${fuzzyHash(record.title, record.authors)}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergePair(existing, record) : record);
  }

  return Array.from(byKey.values());
}
