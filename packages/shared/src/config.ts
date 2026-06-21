/**
 * 12-factor config loader. Every endpoint/credential/model comes from the
 * environment — no hardcoded `localhost` in code, so deploy is a config change.
 */

export type LLMProviderName = "ollama" | "gemini" | "groq" | "anthropic";
export type EmbeddingProviderName = "local" | "cohere";
export type RerankProviderName = "local" | "cohere";

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

export interface Config {
  qdrantUrl: string;
  redisUrl: string;
  /** Postgres connection string for research-session persistence (History).
   *  Optional: when unset, persistence is disabled and runs stay ephemeral. */
  databaseUrl?: string;
  s3: S3Config;
  providers: {
    llm: LLMProviderName;
    embedding: EmbeddingProviderName;
    rerank: RerankProviderName;
  };
  ollamaUrl: string;
  models: { llm: string; embedding: string; rerank: string };
  apiKeys: { gemini?: string; groq?: string; anthropic?: string; cohere?: string };
  services: { ranking: string; parsing: string; synthesis: string };
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

const LLM_PROVIDERS = ["ollama", "gemini", "groq", "anthropic"] as const;
const EMBEDDING_PROVIDERS = ["local", "cohere"] as const;
const RERANK_PROVIDERS = ["local", "cohere"] as const;

/** Validate an env value against an allowed set instead of blind-casting. */
function parseEnum<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid ${name}=${value}. Allowed: ${allowed.join(", ")}`);
}

export function loadConfig(): Config {
  return {
    qdrantUrl: required("QDRANT_URL"),
    redisUrl: required("REDIS_URL"),
    databaseUrl: optional("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT"),
      bucket: required("S3_BUCKET"),
      accessKey: required("S3_ACCESS_KEY"),
      secretKey: required("S3_SECRET_KEY"),
      region: optional("S3_REGION") ?? "us-east-1",
    },
    providers: {
      llm: parseEnum("LLM_PROVIDER", optional("LLM_PROVIDER") ?? "ollama", LLM_PROVIDERS),
      embedding: parseEnum("EMBEDDING_PROVIDER", optional("EMBEDDING_PROVIDER") ?? "local", EMBEDDING_PROVIDERS),
      rerank: parseEnum("RERANK_PROVIDER", optional("RERANK_PROVIDER") ?? "local", RERANK_PROVIDERS),
    },
    ollamaUrl: required("OLLAMA_URL"),
    models: {
      llm: required("LLM_MODEL"),
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
  };
}
