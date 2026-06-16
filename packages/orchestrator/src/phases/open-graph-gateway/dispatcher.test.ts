import { describe, expect, it } from "vitest";
import type { CompiledDiscoveryManifest } from "@udaan/contracts";
import { CircuitBreaker, dispatchAll } from "./dispatcher.js";
import type { OpenGraphProvider } from "./types.js";

const manifest: CompiledDiscoveryManifest = {
  projectId: "p",
  searchContext: { originalQuery: "q", temporalBounds: null, coreConcepts: ["q"] },
  compilations: { booleanStandard: "q" },
  telemetry: {},
};

const fast = (name: string): OpenGraphProvider => ({ name, search: async () => [] });

const slow = (name: string): OpenGraphProvider => ({
  name,
  search: () => new Promise((resolve) => setTimeout(() => resolve([]), 300)),
});

const failing = (name: string): OpenGraphProvider => ({
  name,
  search: async () => {
    throw new Error("provider 503");
  },
});

describe("dispatchAll", () => {
  it("abandons a provider that exceeds the timeout but keeps the rest", async () => {
    const results = await dispatchAll([fast("A"), slow("B")], manifest, { timeoutMs: 30 });
    const byName = Object.fromEntries(results.map((r) => [r.provider, r]));
    expect(byName.A!.ok).toBe(true);
    expect(byName.B!.ok).toBe(false);
    expect(byName.B!.error).toContain("TIMEOUT");
  });

  it("isolates a failing provider (batch never rejects)", async () => {
    const results = await dispatchAll([fast("A"), failing("B")], manifest, { timeoutMs: 1000 });
    expect(results.find((r) => r.provider === "A")!.ok).toBe(true);
    expect(results.find((r) => r.provider === "B")!.ok).toBe(false);
  });

  it("skips a provider whose circuit breaker is open", async () => {
    const breaker = new CircuitBreaker(2, 30_000, () => 1000);
    breaker.recordFailure("B");
    breaker.recordFailure("B");
    let called = false;
    const tracked: OpenGraphProvider = {
      name: "B",
      search: async () => {
        called = true;
        return [];
      },
    };
    const results = await dispatchAll([tracked], manifest, { breaker });
    expect(called).toBe(false);
    expect(results[0]!.error).toBe("CIRCUIT_OPEN");
  });
});
