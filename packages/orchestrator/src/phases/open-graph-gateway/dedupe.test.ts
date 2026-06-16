import { describe, expect, it } from "vitest";
import type { CandidatePaper } from "@udaan/contracts";
import { deduplicate } from "./dedupe.js";

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

describe("deduplicate", () => {
  it("merges records sharing a DOI into a super DTO", () => {
    const a = make({
      doi: "10.1/x",
      abstract: "short abstract that is long enough to pass validation checks",
      citationCount: 5,
      authors: ["Smith, J."],
      sourceProviders: ["OpenAlex"],
    });
    const b = make({
      doi: "https://doi.org/10.1/X",
      abstract: "a considerably longer abstract ".repeat(4),
      citationCount: 12,
      authors: ["Smith, J.", "Doe, A."],
      sourceProviders: ["SemanticScholar"],
    });
    const [merged, ...rest] = deduplicate([a, b]);
    expect(rest).toHaveLength(0);
    expect(merged!.citationCount).toBe(12);
    expect(merged!.authors).toHaveLength(2);
    expect(merged!.abstract.length).toBeGreaterThan(a.abstract.length);
    expect(merged!.sourceProviders.sort()).toEqual(["OpenAlex", "SemanticScholar"]);
  });

  it("merges DOI-less pre-prints by fuzzy hash", () => {
    const a = make({ doi: null, title: "Ephemeral Caching", authors: ["Lee, M."] });
    const b = make({ doi: null, title: "ephemeral caching!", authors: ["Lee, Q."] });
    expect(deduplicate([a, b])).toHaveLength(1);
  });

  it("keeps genuinely distinct records", () => {
    const a = make({ doi: "10.1/a", title: "Paper A" });
    const b = make({ doi: "10.1/b", title: "Paper B" });
    expect(deduplicate([a, b])).toHaveLength(2);
  });
});
