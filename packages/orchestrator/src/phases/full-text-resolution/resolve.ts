/**
 * Phase 4 entrypoint: resolve the top ranked papers to PDFs via a waterfall
 * (cache -> arXiv -> Unpaywall), with a bounded concurrent worker pool, and
 * emit a ResolutionManifest for Phase 5. Unresolved papers are flagged
 * PAYWALLED for the user-upload queue.
 */

import type {
  PrioritizedIngestionIndex,
  RankedPaper,
  ResolutionManifest,
  ResolutionManifestEntry,
} from "@udaan/contracts";
import { downloadAndStore } from "./downloader.js";
import { resolveArxiv, resolveUnpaywall } from "./resolvers.js";
import { storageKey } from "./storage.js";
import type { FetchLike, ObjectStore } from "./types.js";

export const MAX_CONCURRENCY = 5;

export interface ResolveDeps {
  store: ObjectStore;
  fetchImpl?: FetchLike;
  unpaywallEmail?: string;
  concurrency?: number;
}

async function resolveOne(
  paper: RankedPaper,
  store: ObjectStore,
  fetchImpl: FetchLike,
  email: string,
): Promise<ResolutionManifestEntry> {
  const key = storageKey(paper.doi, paper.internalId);
  const base = {
    internalId: paper.internalId,
    doi: paper.doi,
    metadataSnapshot: { title: paper.title },
  };

  // Track A: local cache.
  if (await store.exists(key)) {
    return { ...base, status: "RESOLVED_CACHE", storagePointer: store.pointerFor(key) };
  }

  // Track B: direct arXiv. Track C: Unpaywall.
  let url = resolveArxiv(paper.doi);
  if (!url) {
    url = await resolveUnpaywall(paper.doi, email, fetchImpl).catch(() => null);
  }
  if (!url) {
    return { ...base, status: "PAYWALLED", storagePointer: null };
  }

  try {
    const outcome = await downloadAndStore(url, key, store, fetchImpl);
    return { ...base, status: outcome.status, storagePointer: outcome.pointer };
  } catch {
    return { ...base, status: "FAILED_CORRUPTED", storagePointer: null };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]!);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function runFullTextResolution(
  ranked: PrioritizedIngestionIndex,
  deps: ResolveDeps,
): Promise<ResolutionManifest> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const email = deps.unpaywallEmail ?? "research@udaan.dev";
  const papers = ranked.rankedManifest;

  const entries = await mapWithConcurrency(papers, deps.concurrency ?? MAX_CONCURRENCY, (paper) =>
    resolveOne(paper, deps.store, fetchImpl, email),
  );

  const successfullyResolved = entries.filter(
    (e) => e.status === "RESOLVED_CACHE" || e.status === "RESOLVED_DOWNLOAD",
  ).length;
  const paywalled = entries.filter((e) => e.status === "PAYWALLED").length;

  return {
    projectId: ranked.projectId,
    resolutionSummary: { totalRequested: papers.length, successfullyResolved, paywalled },
    manifest: entries,
  };
}
