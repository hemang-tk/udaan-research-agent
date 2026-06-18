/**
 * Ollama LLM provider — the local/offline default (Qwen2.5-7B by config).
 * Registered into the shared provider registry; phases obtain it via
 * createLLMProvider(config).
 */

import { registerLLMProvider, type LLMCompleteOptions, type LLMMessage, type LLMProvider } from "@udaan/shared";

interface OllamaChatResponse {
  message?: { content?: string };
}

export class OllamaLLMProvider implements LLMProvider {
  constructor(private readonly opts: { ollamaUrl: string; model: string }) {}

  async complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<string> {
    const fullMessages: LLMMessage[] = options?.system
      ? [{ role: "system", content: options.system }, ...messages]
      : messages;

    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: fullMessages,
      stream: false,
      // Local provider: determinism via temperature 0 (Anthropic must NOT do this).
      options: { temperature: 0 },
    };
    if (options?.jsonSchema) body.format = "json";

    const res = await fetch(`${this.opts.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as OllamaChatResponse;
    return data.message?.content ?? "";
  }
}

export function registerOllama(): void {
  registerLLMProvider("ollama", (config) => new OllamaLLMProvider({
    ollamaUrl: config.ollamaUrl,
    model: config.models.llm,
  }));
}