/**
 * Normalization helpers + the data-drop heuristic (Phase 2 §2.3).
 * Phase 3 cannot re-rank a paper without an abstract, so records missing a
 * usable abstract, title, or publication date are dropped.
 */

import { createHash } from "node:crypto";
import type { CandidatePaper } from "@udaan/contracts";

const MIN_ABSTRACT_LENGTH = 50;

/** Strip HTML/JATS/Markdown tags and collapse whitespace. */
export function stripTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalize a DOI to its bare form (no scheme/host, lowercased). */
export function normalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const bare = doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  return bare.length > 0 ? bare : null;
}

/** Reconstruct plain text from OpenAlex's abstract_inverted_index. */
export function reconstructInvertedAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return "";
  const positions: Array<[number, string]> = [];
  for (const [word, locs] of Object.entries(index)) {
    for (const loc of locs) positions.push([loc, word]);
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions
    .map(([, word]) => word)
    .join(" ")
    .trim();
}

/** Last name from an author string ("Smith, J." or "Jane Smith"). */
export function lastName(author: string): string {
  const trimmed = author.trim();
  if (trimmed.includes(",")) return trimmed.split(",")[0]!.trim();
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Fuzzy match key for pre-prints without DOIs (Phase 2 §2.4, Pass 2):
 * SHA-256 of lowercase alphanumeric(title) + lowercase first-author last name.
 */
export function fuzzyHash(title: string, authors: string[]): string {
  const normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const author = authors.length > 0 ? lastName(authors[0]!).toLowerCase() : "";
  return createHash("sha256").update(`${normTitle}|${author}`).digest("hex");
}

export function isValidCandidate(c: CandidatePaper): boolean {
  return (
    c.title.trim().length > 0 &&
    c.abstract.trim().length >= MIN_ABSTRACT_LENGTH &&
    c.publicationDate.trim().length > 0
  );
}

/** Drop records that cannot be re-ranked downstream. */
export function dropInvalid(records: CandidatePaper[]): CandidatePaper[] {
  return records.filter(isValidCandidate);
}
