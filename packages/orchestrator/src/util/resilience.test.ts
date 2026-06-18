import { describe, expect, it, vi } from "vitest";
import { parseRetryAfter, resilientFetch, TimeoutError } from "./resilience.js";

function jsonResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => ({}),
  } as unknown as Response;
}

/** A sleep stub that never really waits but records requested delays. */
function recordingSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { delays, sleep };
}

describe("resilientFetch", () => {
  it("returns immediately on success without retrying", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200));
    const res = await resilientFetch("http://x", {}, { fetchImpl, retries: 3 });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable 4xx", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404));
    const res = await resilientFetch("http://x", {}, { fetchImpl, retries: 3 });
    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 and succeeds on the second attempt", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(200));
    const { delays, sleep } = recordingSleep();
    const res = await resilientFetch("http://x", {}, { fetchImpl, retries: 2, sleep, random: () => 0.5 });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(delays).toHaveLength(1);
  });

  it("honours a Retry-After header on a 429", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(429, { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse(200));
    const { delays, sleep } = recordingSleep();
    const res = await resilientFetch("http://x", {}, { fetchImpl, retries: 2, sleep, maxDelayMs: 10_000 });
    expect(res.status).toBe(200);
    expect(delays[0]).toBe(2000); // 2s, not the exponential backoff
  });

  it("throws a TimeoutError when an attempt exceeds the timeout", async () => {
    // fetch hangs until its signal aborts (the per-attempt timeout).
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    const { sleep } = recordingSleep();
    await expect(
      resilientFetch("http://x", {}, { fetchImpl, retries: 0, timeoutMs: 10, sleep }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("does not call fetch when the external signal is already aborted", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200));
    const ac = new AbortController();
    ac.abort();
    await expect(resilientFetch("http://x", {}, { fetchImpl, signal: ac.signal })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gives up after exhausting retries on persistent 500s", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500));
    const { sleep } = recordingSleep();
    const res = await resilientFetch("http://x", {}, { fetchImpl, retries: 2, sleep });
    expect(res.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("5", 0)).toBe(5000);
  });

  it("parses an HTTP date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10_000);
  });

  it("returns null for a missing or unparseable header", () => {
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(parseRetryAfter("soon", 0)).toBeNull();
  });
});
