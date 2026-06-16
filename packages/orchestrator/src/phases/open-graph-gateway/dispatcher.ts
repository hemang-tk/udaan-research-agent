/**
 * Concurrent Dispatcher (Phase 2 §2.2, §4.1). Dispatches all provider adapters
 * in parallel, enforces a hard per-provider timeout, and trips a circuit
 * breaker on repeated failures. A slow or failing provider is abandoned; the
 * batch proceeds with whatever succeeded.
 */

import type { CompiledDiscoveryManifest } from "@udaan/contracts";
import type { AdapterResult, OpenGraphProvider } from "./types.js";

export const DEFAULT_TIMEOUT_MS = 4000;

/** Runs `work`, rejecting if it exceeds `ms`; aborts the signal on timeout. */
export function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      ac.abort();
      reject(new Error(`TIMEOUT_${ms}MS`));
    }, ms);
    work(ac.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class CircuitBreaker {
  private failures = new Map<string, number>();
  private openUntil = new Map<string, number>();

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  isOpen(name: string): boolean {
    const until = this.openUntil.get(name);
    return until !== undefined && until > this.now();
  }

  recordSuccess(name: string): void {
    this.failures.delete(name);
    this.openUntil.delete(name);
  }

  recordFailure(name: string): void {
    const next = (this.failures.get(name) ?? 0) + 1;
    this.failures.set(name, next);
    if (next >= this.threshold) {
      this.openUntil.set(name, this.now() + this.cooldownMs);
    }
  }
}

export interface DispatchOptions {
  timeoutMs?: number;
  breaker?: CircuitBreaker;
}

export async function dispatchAll(
  adapters: OpenGraphProvider[],
  manifest: CompiledDiscoveryManifest,
  options: DispatchOptions = {},
): Promise<AdapterResult[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const breaker = options.breaker;

  return Promise.all(
    adapters.map(async (adapter): Promise<AdapterResult> => {
      if (breaker?.isOpen(adapter.name)) {
        return { provider: adapter.name, ok: false, records: [], error: "CIRCUIT_OPEN" };
      }
      try {
        const records = await withTimeout((signal) => adapter.search(manifest, signal), timeoutMs);
        breaker?.recordSuccess(adapter.name);
        return { provider: adapter.name, ok: true, records };
      } catch (err) {
        breaker?.recordFailure(adapter.name);
        return {
          provider: adapter.name,
          ok: false,
          records: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}
