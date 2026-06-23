/**
 * Query Hash Cache (Phase 1 §4.1). A SHA-256 of the normalized query keys a
 * cache entry holding the CompiledDiscoveryManifest, skipping the LLM on repeat
 * queries. The hosted build uses the in-process in-memory implementation.
 */

import { createHash } from "node:crypto";
import type { CompiledDiscoveryManifest } from "@udaan/contracts";

export interface QueryCache {
  get(key: string): Promise<CompiledDiscoveryManifest | null>;
  set(key: string, value: CompiledDiscoveryManifest): Promise<void>;
}

/** SHA-256 of the normalized (lowercased) query. */
export function queryHash(normalized: string): string {
  return createHash("sha256").update(normalized.toLowerCase()).digest("hex");
}

export class InMemoryQueryCache implements QueryCache {
  private readonly store = new Map<string, CompiledDiscoveryManifest>();

  async get(key: string): Promise<CompiledDiscoveryManifest | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: CompiledDiscoveryManifest): Promise<void> {
    this.store.set(key, value);
  }
}
