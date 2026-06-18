/**
 * Outbound-call resilience (issue #21): a single `resilientFetch` used by the
 * service clients, the Ollama provider, and the Phase 2 adapters.
 *
 * It adds, around the bare `fetch` these paths used to call once:
 *   - a per-attempt timeout (AbortController) so a hung dependency is abandoned;
 *   - bounded exponential backoff with jitter for transient failures;
 *   - 429 / 503 `Retry-After` handling (honoured, then capped);
 *   - cooperation with an external abort signal (e.g. the dispatcher's
 *     per-provider timeout) so a slow upstream still yields promptly.
 *
 * Timing dependencies (`sleep`, `random`, `now`) and `fetch` are injectable so
 * the behaviour is deterministically testable.
 */

/** Statuses worth retrying: request timeout, too-early, rate-limit, and 5xx. */
export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export interface ResilienceOptions {
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Additional attempts after the first (so 2 means up to 3 calls). */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** External cancellation (wins over internal retries). */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

const DEFAULTS = {
  timeoutMs: 30_000,
  retries: 2,
  baseDelayMs: 250,
  maxDelayMs: 10_000,
};

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into ms, or null. */
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export async function resilientFetch(
  url: string,
  init: RequestInit = {},
  options: ResilienceOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const retries = options.retries ?? DEFAULTS.retries;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const external = options.signal;

  const backoff = (attempt: number): number => {
    const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    return Math.round(exp * (0.5 + random() * 0.5)); // full-ish jitter (50–100%)
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (external?.aborted) throw new DOMException("Aborted", "AbortError");

    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);
    const onExternalAbort = () => ac.abort();
    external?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const res = await doFetch(url, { ...init, signal: ac.signal });
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);

      if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === retries) {
        return res;
      }
      // Retryable status with attempts left: respect Retry-After if present.
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"), now());
      const delay = retryAfter !== null ? Math.min(retryAfter, maxDelayMs) : backoff(attempt);
      options.onRetry?.({ attempt, delayMs: delay, reason: `status ${res.status}` });
      await sleep(delay, external);
      continue;
    } catch (err) {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);

      // External cancellation is terminal; don't retry past it.
      if (external?.aborted) throw err;
      if (isAbort(err) && timedOut) {
        lastError = new TimeoutError(timeoutMs);
      } else {
        lastError = err;
      }
      if (attempt === retries) break;
      const delay = backoff(attempt);
      options.onRetry?.({
        attempt,
        delayMs: delay,
        reason: lastError instanceof Error ? lastError.message : String(lastError),
      });
      await sleep(delay, external);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
