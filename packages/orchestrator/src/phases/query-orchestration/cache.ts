/**
 * Query Hash Cache (Phase 1 §4.1). A SHA-256 of the normalized query keys a
 * Redis entry holding the CompiledDiscoveryManifest, skipping the LLM on repeat
 * queries. An in-memory implementation backs tests and no-infra runs.
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

const TTL_SECONDS = 24 * 60 * 60;

/** Redis-backed cache (24h TTL). Lazily typed to avoid a hard ioredis import in tests. */
export class RedisQueryCache implements QueryCache {
  constructor(
    private readonly redis: {
      get(k: string): Promise<string | null>;
      set(k: string, v: string, mode: "EX", ttl: number): Promise<unknown>;
    },
  ) {}

  async get(key: string): Promise<CompiledDiscoveryManifest | null> {
    const raw = await this.redis.get(`q1:${key}`);
    return raw ? (JSON.parse(raw) as CompiledDiscoveryManifest) : null;
  }

  async set(key: string, value: CompiledDiscoveryManifest): Promise<void> {
    await this.redis.set(`q1:${key}`, JSON.stringify(value), "EX", TTL_SECONDS);
  }
}
