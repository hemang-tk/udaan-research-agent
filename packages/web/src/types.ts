import type { ResearchBrief } from "@udaan/contracts";

export type { ResearchBrief };

/** The fixed 7-phase sequence, in order. Names match the orchestrator's emits. */
export const PHASES: { phase: number; name: string }[] = [
  { phase: 1, name: "Query Orchestration" },
  { phase: 2, name: "Open Graph Gateway" },
  { phase: 3, name: "Cross-Encoder Re-Ranking" },
  { phase: 4, name: "Full-Text Resolution" },
  { phase: 5, name: "Ingestion & Parsing" },
  { phase: 6, name: "Synthesis & Polarity" },
  { phase: 7, name: "Generation & Citation Weaving" },
];

export interface ProgressEvent {
  phase: number;
  name: string;
  status: "start" | "done";
  detail?: string;
}

export type PipelineResult =
  | { status: "ok"; brief: ResearchBrief }
  | { status: "rejected"; reason: string }
  | { error: string };

export type PhaseStatus = "pending" | "active" | "done";
