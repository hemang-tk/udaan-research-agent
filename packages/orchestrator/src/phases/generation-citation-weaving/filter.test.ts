import { describe, expect, it } from "vitest";
import { filterHallucinations, splitSentences } from "./filter.js";

describe("splitSentences", () => {
  it("splits on sentence boundaries", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });
});

describe("filterHallucinations", () => {
  const allowed = new Set(["cl_a", "cl_b"]);

  it("keeps tagged sentences and drops untagged ones", () => {
    const out = filterHallucinations("Latency dropped [cl_a]. This has no citation.", allowed);
    expect(out.text).toBe("Latency dropped [cl_a].");
    expect(out.dropRate).toBeCloseTo(0.5);
  });

  it("drops sentences whose tag is not in the allowed set (invented citation)", () => {
    const out = filterHallucinations("Fabricated claim [cl_zzz].", allowed);
    expect(out.text).toBe("");
    expect(out.dropRate).toBe(1);
  });

  it("keeps multiple valid sentences", () => {
    const out = filterHallucinations("A [cl_a]. B [cl_b].", allowed);
    expect(out.text).toBe("A [cl_a]. B [cl_b].");
    expect(out.dropRate).toBe(0);
  });
});
