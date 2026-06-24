/**
 * 12-factor config loader. Every endpoint/credential/model comes from the
 * environment — no hardcoded `localhost` in code, so deploy is a config change.
 */

export type LLMProviderName = "gemini" | "groq" | "anthropic";
export type EmbeddingProviderName = "cohere";
export type RerankProviderName = "cohere";

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

export interface Config {
  qdrantUrl: string;
  /** Postgres connection string for research-session persistence (History).
   *  Optional: when unset, persistence is disabled and runs stay ephemeral. */
  databaseUrl?: string;
  s3: S3Config;
  providers: {
    /** Primary LLM provider (first of llmList). */
    llm: LLMProviderName;
    /** All configured LLM providers. LLM_PROVIDER may be comma-separated
     *  (e.g. "gemini,groq") for round-robin + failover across independent free
     *  tiers, so a run only stalls if every provider is rate-limited at once. */
    llmList: LLMProviderName[];
    embedding: EmbeddingProviderName;
    rerank: RerankProviderName;
  };
  models: {
    llm: string;
    /** Optional per-provider model override (LLM_MODEL_GROQ, LLM_MODEL_GEMINI, …)
     *  used when several providers are listed and need different model ids. */
    llmByProvider: Partial<Record<LLMProviderName, string>>;
    embedding: string;
    rerank: string;
  };
  apiKeys: { gemini?: string; groq?: string; anthropic?: string; cohere?: string };
  services: { ranking: string; parsing: string; synthesis: string };
  /** Per-provider hard timeout (ms) for the Phase 2 academic-graph fan-out.
   *  The 4s default suits a datacenter; raise it (GATEWAY_TIMEOUT_MS) on a slow
   *  residential link, where a single large result page can take longer. */
  gatewayTimeoutMs: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === "" ? undefined : value;
}

/** Parse a positive-integer env var, falling back to `fallback` when unset/invalid. */
function optionalNumber(name: string, fallback: number): number {
  const value = optional(name);
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const LLM_PROVIDERS = ["gemini", "groq", "anthropic"] as const;
const EMBEDDING_PROVIDERS = ["cohere"] as const;
const RERANK_PROVIDERS = ["cohere"] as const;

/** Validate an env value against an allowed set instead of blind-casting. */
function parseEnum<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid ${name}=${value}. Allowed: ${allowed.join(", ")}`);
}

/** Parse a comma-separated list of enum values (each validated). At least one. */
function parseEnumList<T extends string>(name: string, value: string, allowed: readonly T[]): T[] {
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error(`Invalid ${name}: empty`);
  return parts.map((p) => parseEnum(name, p, allowed));
}

export function loadConfig(): Config {
  const llmList = parseEnumList("LLM_PROVIDER", optional("LLM_PROVIDER") ?? "anthropic", LLM_PROVIDERS);
  const llmByProvider: Partial<Record<LLMProviderName, string>> = {};
  for (const p of LLM_PROVIDERS) {
    const m = optional(`LLM_MODEL_${p.toUpperCase()}`);
    if (m) llmByProvider[p] = m;
  }
  return {
    qdrantUrl: required("QDRANT_URL"),
    databaseUrl: optional("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT"),
      bucket: required("S3_BUCKET"),
      accessKey: required("S3_ACCESS_KEY"),
      secretKey: required("S3_SECRET_KEY"),
      region: optional("S3_REGION") ?? "us-east-1",
    },
    providers: {
      llm: llmList[0]!, // parseEnumList guarantees at least one
      llmList,
      embedding: parseEnum("EMBEDDING_PROVIDER", optional("EMBEDDING_PROVIDER") ?? "cohere", EMBEDDING_PROVIDERS),
      rerank: parseEnum("RERANK_PROVIDER", optional("RERANK_PROVIDER") ?? "cohere", RERANK_PROVIDERS),
    },
    models: {
      llm: required("LLM_MODEL"),
      llmByProvider,
      embedding: required("EMBEDDING_MODEL"),
      rerank: required("RERANK_MODEL"),
    },
    apiKeys: {
      gemini: optional("GEMINI_API_KEY"),
      groq: optional("GROQ_API_KEY"),
      anthropic: optional("ANTHROPIC_API_KEY"),
      cohere: optional("COHERE_API_KEY"),
    },
    services: {
      ranking: required("RANKING_SERVICE_URL"),
      parsing: required("PARSING_SERVICE_URL"),
      synthesis: required("SYNTHESIS_SERVICE_URL"),
    },
    gatewayTimeoutMs: optionalNumber("GATEWAY_TIMEOUT_MS", 4000),
  };
}
