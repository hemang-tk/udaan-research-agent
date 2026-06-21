/**
 * Section-by-Section generation (Phase 7 §2.1, §2.2). The LLM is constrained to
 * a text-weaver role: synthesize ONLY the provided claims and end every factual
 * sentence with its claim ID. (For Claude providers, no temperature/top_p —
 * adaptive thinking; see Phase 7 §4.1.)
 */

import type { ClusterPolarity, SynthesisCluster } from "@udaan/contracts";
import type { LLMProvider } from "@udaan/shared";

export interface SectionConfig {
  polarity: ClusterPolarity;
  heading: string;
  instruction: string;
}

export const SECTION_CONFIGS: SectionConfig[] = [
  {
    polarity: "AGREEMENT",
    heading: "Areas of Consensus",
    instruction: "Synthesize these consistent findings into a coherent consensus.",
  },
  {
    polarity: "CONTRADICTION",
    heading: "Conflicts in the Literature",
    instruction: "Highlight the conflicting outcomes and the conditions under which they diverge.",
  },
  {
    polarity: "THIN_EVIDENCE",
    heading: "Open Questions & Thin Evidence",
    instruction: "Note these as isolated or under-studied findings that warrant further work.",
  },
];

const BASE_SYSTEM =
  "You are a research-brief writer. Using ONLY the claims provided (each shown " +
  "with its claim ID in square brackets), write a short synthesis. Rules: " +
  "(1) never add facts beyond the provided claims; (2) write atomic, independent " +
  "sentences; (3) every factual sentence MUST end with the relevant claim ID in " +
  "square brackets exactly as given (e.g. [cl_abc]); (4) use only the claim IDs provided.";

function clustersToContent(clusters: SynthesisCluster[]): string {
  return clusters
    .map(
      (c) =>
        `Topic: ${c.generatedTopicLabel}\n` + c.claims.map((x) => `- ${x.text} [${x.claimId}]`).join("\n"),
    )
    .join("\n\n");
}

export async function generateSection(
  clusters: SynthesisCluster[],
  instruction: string,
  llm: LLMProvider,
): Promise<string> {
  return llm.complete([{ role: "user", content: clustersToContent(clusters) }], {
    system: `${BASE_SYSTEM} ${instruction}`,
  });
}

export async function generateExecutiveSummary(sectionTexts: string[], llm: LLMProvider): Promise<string> {
  const content = sectionTexts.join("\n");
  const system = `${BASE_SYSTEM} Write a 2-3 sentence executive summary from the sentences below, preserving their claim ID tags.`;
  return llm.complete([{ role: "user", content }], { system });
}
