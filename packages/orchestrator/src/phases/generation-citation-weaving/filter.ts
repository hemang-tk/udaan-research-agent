/**
 * The Hallucination Filter (Phase 7 §2.2). Splits generated text into sentences
 * and drops any sentence that does not carry a VALID claim-ID tag — i.e. an
 * untagged sentence, or one that invents a tag not present in the Phase 6
 * payload. This is what guarantees every surviving sentence is sourced.
 */

const TAG = /\[([^\]\s]+)\]/g;

export function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : text.trim().length > 0 ? [text.trim()] : [];
}

function tagsIn(sentence: string): string[] {
  return [...sentence.matchAll(TAG)]
    .map((m) => m[1])
    .filter((id): id is string => id !== undefined);
}

export interface FilterResult {
  text: string;
  dropRate: number;
}

/** Keep only sentences carrying at least one allowed claim ID. */
export function filterHallucinations(text: string, allowedIds: Set<string>): FilterResult {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return { text: "", dropRate: 0 };

  const kept = sentences.filter((s) => tagsIn(s).some((id) => allowedIds.has(id)));
  const dropRate = (sentences.length - kept.length) / sentences.length;
  return { text: kept.join(" "), dropRate };
}
