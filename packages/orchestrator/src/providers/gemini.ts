/**
 * Gemini LLM provider — Google AI Studio generateContent.
 * Uses raw fetch (no SDK dep). JSON mode via responseMimeType + responseSchema.
 * Temperature 0 for determinism.
 */

import {
  registerLLMProvider,
  type LLMCompleteOptions,
  type LLMMessage,
  type LLMProvider,
} from "@udaan/shared";

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export class GeminiLLMProvider implements LLMProvider {
  constructor(private readonly opts: { apiKey: string; model: string }) {}

  async complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<string> {
    if (!this.opts.apiKey) {
      throw new Error("GEMINI_API_KEY is required for the gemini LLM provider");
    }

    // Gemini separates system instructions from the conversation turns.
    const systemInstruction = options?.system ? { parts: [{ text: options.system }] } : undefined;

    // Gemini uses "user"/"model" roles (not "assistant").
    const contents: GeminiContent[] = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const generationConfig: Record<string, unknown> = {
      temperature: options?.temperature ?? 0,
      ...(options?.topP !== undefined ? { topP: options.topP } : {}),
      ...(options?.maxTokens !== undefined ? { maxOutputTokens: options.maxTokens } : {}),
    };

    if (options?.jsonSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = options.jsonSchema;
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
      ...(systemInstruction ? { systemInstruction } : {}),
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.opts.model}:generateContent?key=${this.opts.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini request failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as GeminiResponse;
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
}

export function registerGemini(): void {
  registerLLMProvider("gemini", (config) => {
    const apiKey = config.apiKeys.gemini;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set. It is required when LLM_PROVIDER=gemini.");
    }
    return new GeminiLLMProvider({ apiKey, model: config.models.llm });
  });
}
