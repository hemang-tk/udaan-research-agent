import { describe, expect, it } from "vitest";
import { weaveCitations, type ClaimMeta } from "./weaver.js";

const meta = new Map<string, ClaimMeta>([
  ["cl_a", { doi: "10.1/a", text: "finding a" }],
  ["cl_b", { doi: "10.1/b", text: "finding b" }],
]);

describe("weaveCitations", () => {
  it("numbers tags in first-appearance order and dedupes repeats", () => {
    const { sections, bibliography } = weaveCitations(
      [
        { heading: "Conflicts", bodyText: "A [cl_a]. B [cl_b]. A again [cl_a]." },
      ],
      meta,
    );
    expect(sections[0]!.bodyText).toBe("A [1]. B [2]. A again [1].");
    expect(bibliography["1"]!.claimId).toBe("cl_a");
    expect(bibliography["2"]!.claimId).toBe("cl_b");
    expect(Object.keys(bibliography)).toEqual(["1", "2"]);
  });

  it("strips tags with no known claim metadata", () => {
    const { sections, bibliography } = weaveCitations(
      [{ heading: "X", bodyText: "Known [cl_a]. Unknown [cl_zzz]." }],
      meta,
    );
    expect(sections[0]!.bodyText).toBe("Known [1]. Unknown .");
    expect(Object.keys(bibliography)).toEqual(["1"]);
  });
});
