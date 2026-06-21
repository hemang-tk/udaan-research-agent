/**
 * Deterministic Citation Weaver (Phase 7 §2.3). Replaces raw [claimId] tags
 * with sequential [1], [2], ... in first-appearance order and compiles the
 * bibliography. Pure application logic — no LLM.
 */

import type { BibliographyEntry, BriefSection } from "@udaan/contracts";

const TAG = /\[([^\]\s]+)\]/g;

export interface ClaimMeta {
  doi: string | null;
  text: string;
}

export interface WovenBrief {
  sections: BriefSection[];
  bibliography: Record<string, BibliographyEntry>;
}

export function weaveCitations(sections: BriefSection[], claimMeta: Map<string, ClaimMeta>): WovenBrief {
  const numbering = new Map<string, number>();
  const bibliography: Record<string, BibliographyEntry> = {};
  let counter = 0;

  const woven = sections.map((section) => {
    const body = section.bodyText
      .replace(TAG, (_full, id: string) => {
        const meta = claimMeta.get(id);
        if (!meta) return ""; // unknown tag (shouldn't survive the filter) — strip
        let num = numbering.get(id);
        if (num === undefined) {
          num = ++counter;
          numbering.set(id, num);
          bibliography[String(num)] = { claimId: id, doi: meta.doi, text: meta.text };
        }
        return `[${num}]`;
      })
      .replace(/\s+/g, " ")
      .trim();
    return { heading: section.heading, bodyText: body };
  });

  return { sections: woven, bibliography };
}
