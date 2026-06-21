/**
 * Intent Optimization Engine (Phase 1 §2.2) + deterministic fallback (§4.2).
 *
 * Primary path: a fast LLM emits structured intent (concepts + temporal bounds)
 * as JSON. Failover path: if the LLM errors, times out, or returns unparseable
 * output, a deterministic regex tokenizer produces a degraded result so the
 * pipeline never stalls.
 */

import type { LLMProvider } from "@udaan/shared";
import type { ExtractedIntent } from "./types.js";

export const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["coreConcepts"],
  properties: {
    coreConcepts: { type: "array", items: { type: "string" } },
    temporalBounds: {
      type: ["object", "null"],
      properties: {
        startYear: { type: "integer" },
        endYear: { type: "integer" },
      },
    },
  },
} as const;

const SYSTEM_PROMPT =
  "You are a query analyzer for an academic search engine. Extract the core " +
  "search concepts (noun phrases) and any temporal bounds from the research " +
  "question. Do not answer the question. Respond ONLY with JSON of the form " +
  '{"coreConcepts": string[], "temporalBounds": {"startYear"?: number, "endYear"?: number} | null}.';

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "for",
  "to",
  "and",
  "or",
  "how",
  "does",
  "do",
  "is",
  "are",
  "what",
  "which",
  "with",
  "about",
  "into",
  "across",
  "since",
  "after",
  "before",
  "between",
  "impact",
  "affect",
  "effect",
]);

const CURRENT_YEAR = 2026;

/** Deterministic fallback tokenizer (degraded mode). */
export function regexTokenize(query: string): ExtractedIntent {
  let startYear: number | undefined;
  const sinceMatch = query.match(/\b(?:since|after|from)\s+(\d{4})\b/i);
  if (sinceMatch?.[1]) {
    const year = Number.parseInt(sinceMatch[1], 10);
    if (year >= 1900 && year <= CURRENT_YEAR) startYear = year;
  }

  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d{4}$/.test(w));

  const coreConcepts = Array.from(new Set(words));
  return {
    coreConcepts,
    temporalBounds: startYear ? { startYear } : null,
    degraded: true,
  };
}

function coerceIntent(parsed: unknown): ExtractedIntent | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.coreConcepts)) return null;
  const coreConcepts = obj.coreConcepts.filter((c): c is string => typeof c === "string");
  if (coreConcepts.length === 0) return null;

  let temporalBounds: ExtractedIntent["temporalBounds"] = null;
  if (obj.temporalBounds && typeof obj.temporalBounds === "object") {
    const tb = obj.temporalBounds as Record<string, unknown>;
    const startYear = typeof tb.startYear === "number" ? tb.startYear : undefined;
    const endYear = typeof tb.endYear === "number" ? tb.endYear : undefined;
    if (startYear || endYear) temporalBounds = { startYear, endYear };
  }
  return { coreConcepts, temporalBounds, degraded: false };
}

export async function extractIntent(query: string, llm: LLMProvider): Promise<ExtractedIntent> {
  try {
    const raw = await llm.complete([{ role: "user", content: query }], {
      system: SYSTEM_PROMPT,
      jsonSchema: INTENT_SCHEMA as unknown as Record<string, unknown>,
    });
    const coerced = coerceIntent(JSON.parse(raw));
    return coerced ?? regexTokenize(query);
  } catch {
    return regexTokenize(query);
  }
}
