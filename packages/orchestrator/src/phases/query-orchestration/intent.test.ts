import { describe, expect, it } from "vitest";
import type { LLMProvider } from "@udaan/shared";
import { extractIntent, regexTokenize } from "./intent.js";

const stubLLM = (response: string): LLMProvider => ({
  complete: async () => response,
});

const throwingLLM: LLMProvider = {
  complete: async () => {
    throw new Error("ollama down");
  },
};

describe("regexTokenize", () => {
  it("extracts a start year and drops stopwords", () => {
    const r = regexTokenize("How does micro-caching impact latency since 2022");
    expect(r.degraded).toBe(true);
    expect(r.temporalBounds).toEqual({ startYear: 2022 });
    expect(r.coreConcepts).toContain("micro-caching");
    expect(r.coreConcepts).not.toContain("how");
  });
});

describe("extractIntent", () => {
  it("uses valid LLM JSON (not degraded)", async () => {
    const r = await extractIntent(
      "micro-caching latency",
      stubLLM(JSON.stringify({ coreConcepts: ["micro-caching", "tail latency"], temporalBounds: null })),
    );
    expect(r.degraded).toBe(false);
    expect(r.coreConcepts).toEqual(["micro-caching", "tail latency"]);
  });

  it("falls back to the tokenizer on LLM error", async () => {
    const r = await extractIntent("micro-caching latency since 2020", throwingLLM);
    expect(r.degraded).toBe(true);
    expect(r.temporalBounds).toEqual({ startYear: 2020 });
  });

  it("falls back when the LLM returns unparseable output", async () => {
    const r = await extractIntent("micro-caching latency", stubLLM("not json"));
    expect(r.degraded).toBe(true);
  });
});
