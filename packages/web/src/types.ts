import type { ResearchBrief, ResolutionManifestEntry } from "@udaan/contracts";

export type { ResearchBrief };
export type PaywalledEntry = ResolutionManifestEntry;

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

/** A past research session, as listed in History. */
export interface ResearchSummary {
  id: string;
  query: string;
  createdAt: string;
  totalClaims: number;
  sections: number;
}

/** A passage cited by a chat answer (RAG over the brief's papers). */
export interface ChatCitation {
  n: number;
  quote: string;
  doi: string | null;
  title?: string | null;
}

export interface AskResponse {
  answer: string;
  citations: ChatCitation[];
}

/** Elicit-style per-paper extraction table. */
export interface TableColumn {
  key: string;
  label: string;
}
export interface TableRow {
  doi: string | null;
  values: Record<string, string>;
}
export interface TableResult {
  columns: TableColumn[];
  rows: TableRow[];
}
