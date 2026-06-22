/**
 * Groq LLM provider — OpenAI-compatible /chat/completions endpoint.
 * Uses raw fetch (no SDK dep). JSON mode via response_format: {type: json_object}.
 * Temperature 0 for determinism.
 */

import { registerLLMProvider, type LLMCompleteOptions, type LLMMessage, type LLMProvider } from "@udaan/shared";
import { resilientFetch } from "../util/resilience.js";

interface GroqChatResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

export class GroqLLMProvider implements LLMProvider {
  private static readonly BASE_URL = "https://api.groq.com/openai/v1";

  constructor(private readonly opts: { apiKey: string; model: string }) {}

  async complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<string> {
    if (!this.opts.apiKey) {
      throw new Error("GROQ_API_KEY is required for the groq LLM provider");
    }

    const fullMessages = options?.system
      ? [{ role: "system" as const, content: options.system }, ...messages]
      : messages;

    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: fullMessages,
      temperature: options?.temperature ?? 0,
      ...(options?.topP !== undefined ? { top_p: options.topP } : {}),
      ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    };

    if (options?.jsonSchema) {
      body.response_format = { type: "json_object" };
    }

    // Free Groq tiers rate-limit (429 with a ~40s Retry-After on TPM). Route
    // through resilientFetch so generation honours Retry-After and rides out the
    // per-minute window instead of hard-failing — parity with the Python
    // _post_with_retry path that already lets Phase 5 survive the same limit.
    const res = await resilientFetch(
      `${GroqLLMProvider.BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      { timeoutMs: 60_000, retries: 3, baseDelayMs: 1_000, maxDelayMs: 60_000 },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Groq request failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as GroqChatResponse;
    return data.choices?.[0]?.message?.content ?? "";
  }
}

export function registerGroq(): void {
  registerLLMProvider("groq", (config) => {
    const apiKey = config.apiKeys.groq;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not set. It is required when LLM_PROVIDER=groq.");
    }
    return new GroqLLMProvider({ apiKey, model: config.models.llm });
  });
}