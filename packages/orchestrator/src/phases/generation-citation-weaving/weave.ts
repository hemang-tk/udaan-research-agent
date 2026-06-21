/**
 * Phase 7 entrypoint: SynthesisGraph -> ResearchBrief.
 *
 *   dispatch by polarity -> constrained generation -> hallucination filter
 *   -> executive summary (from validated sections) -> citation weaving
 */

import type { BriefSection, ResearchBrief, SynthesisGraph } from "@udaan/contracts";
import type { LLMProvider } from "@udaan/shared";
import { filterHallucinations } from "./filter.js";
import { SECTION_CONFIGS, generateExecutiveSummary, generateSection } from "./generate.js";
import { weaveCitations, type ClaimMeta } from "./weaver.js";

const RETRY_DROP_THRESHOLD = 0.3; // §4.2: retry a section that drops >30% of sentences

export interface GenerationDeps {
  llm: LLMProvider;
}

export async function runGeneration(graph: SynthesisGraph, deps: GenerationDeps): Promise<ResearchBrief> {
  const { llm } = deps;

  const claimMeta = new Map<string, ClaimMeta>();
  for (const cluster of graph.synthesisGraph) {
    for (const ref of cluster.claims) {
      claimMeta.set(ref.claimId, { doi: ref.doi, text: ref.text });
    }
  }
  const allowedAll = new Set(claimMeta.keys());

  const themed: BriefSection[] = [];
  for (const cfg of SECTION_CONFIGS) {
    const clusters = graph.synthesisGraph.filter((c) => c.polarity === cfg.polarity);
    if (clusters.length === 0) continue;

    const allowed = new Set(clusters.flatMap((c) => c.claims.map((x) => x.claimId)));
    let raw = await generateSection(clusters, cfg.instruction, llm);
    let result = filterHallucinations(raw, allowed);
    if (result.dropRate > RETRY_DROP_THRESHOLD) {
      raw = await generateSection(clusters, cfg.instruction, llm);
      result = filterHallucinations(raw, allowed);
    }
    if (result.text.trim().length > 0) {
      themed.push({ heading: cfg.heading, bodyText: result.text });
    }
  }

  const sections: BriefSection[] = [];
  if (themed.length > 0) {
    const execRaw = await generateExecutiveSummary(
      themed.map((s) => s.bodyText),
      llm,
    );
    const execText = filterHallucinations(execRaw, allowedAll).text;
    if (execText.trim().length > 0) {
      sections.push({ heading: "Executive Summary", bodyText: execText });
    }
  }
  sections.push(...themed);

  const woven = weaveCitations(sections, claimMeta);
  return {
    projectId: graph.projectId,
    // degraded/degradedStages are finalised by the pipeline driver once it knows
    // which stages used fallback implementations (issue #17).
    metadata: {
      totalClaims: allowedAll.size,
      sectionsGenerated: woven.sections.length,
      degraded: false,
      degradedStages: [],
    },
    sections: woven.sections,
    bibliography: woven.bibliography,
  };
}
