import { describe, expect, it } from "vitest";
import type { CandidatePaper } from "@udaan/contracts";
import { dropInvalid, fuzzyHash, normalizeDoi, reconstructInvertedAbstract, stripTags } from "./normalize.js";

const make = (over: Partial<CandidatePaper>): CandidatePaper => ({
  internalId: "x",
  doi: null,
  title: "A title",
  abstract: "x".repeat(60),
  authors: ["Smith, J."],
  publicationDate: "2023-01-01",
  citationCount: 0,
  sourceProviders: ["OpenAlex"],
  sourceUrls: [],
  ...over,
});

describe("normalize helpers", () => {
  it("strips tags and collapses whitespace", () => {
    expect(stripTags("<p>hello   world</p>")).toBe("hello world");
  });

  it("normalizes DOI to bare lowercase form", () => {
    expect(normalizeDoi("https://doi.org/10.1038/ABC")).toBe("10.1038/abc");
    expect(normalizeDoi(null)).toBeNull();
  });

  it("reconstructs an inverted-index abstract in order", () => {
    expect(reconstructInvertedAbstract({ caching: [1], Micro: [0], helps: [2] })).toBe("Micro caching helps");
  });

  it("produces the same fuzzy hash regardless of title punctuation/case", () => {
    expect(fuzzyHash("Micro-Caching!", ["Smith, J."])).toBe(fuzzyHash("micro caching", ["Smith, A."]));
  });
});

describe("dropInvalid", () => {
  it("drops records without an abstract, title, or date", () => {
    const kept = make({ title: "Keep" });
    const noAbstract = make({ title: "Drop", abstract: "short" });
    const noDate = make({ publicationDate: "" });
    expect(dropInvalid([kept, noAbstract, noDate])).toEqual([kept]);
  });
});
