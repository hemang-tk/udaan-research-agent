/**
 * Anthropic LLM provider.
 *
 * CRITICAL CONSTRAINT: DO NOT send temperature or top_p.
 * Sending either param causes a 400 on claude-opus-4-8 / claude-opus-4-7.
 * Use thinking: { type: "adaptive" } instead of temperature-based sampling.
 *
 * JSON output is obtained via a tool-use trick: we define a single tool whose
 * input_schema is the caller's jsonSchema, then force the model to call it
 * with tool_choice: { type: "tool", name: "__json_output__" }.
 */

import Anthropic from "@anthropic-ai/sdk";
import { registerLLMProvider, type LLMCompleteOptions, type LLMMessage, type LLMProvider } from "@udaan/shared";

export class AnthropicLLMProvider implements LLMProvider {
  private readonly client: Anthropic;

  constructor(private readonly opts: { apiKey: string; model: string },
    client?: Anthropic,
  ) {
    this.client =
      client ??
      new Anthropic({
        apiKey: opts.apiKey,
      });
  }

  async complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<string> {
    // Convert to Anthropic MessageParam format (no system role in messages array)
    const anthropicMessages: Anthropic.MessageParam[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // ⚠️ CRITICAL: DO NOT include temperature or top_p — they 400 on Opus 4.8/4.7.
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.opts.model,
      max_tokens: options?.maxTokens ?? 4096,
      thinking: (options?.thinking ?? { type: "adaptive" }) as Anthropic.ThinkingConfigParam,
      messages: anthropicMessages,
      ...(options?.system ? { system: options.system } : {}),
    };

    // JSON mode: use a forced tool call so the model returns structured output.
    if (options?.jsonSchema) {
      params.tools = [
        {
          name: "__json_output__",
          description: "Return the response as a JSON object matching the provided schema.",
          input_schema: options.jsonSchema as Anthropic.Tool["input_schema"],
        },
      ];
      params.tool_choice = { type: "tool", name: "__json_output__" };
    }

    const response = await this.client.messages.create(params);

    // If we used the JSON tool, extract from tool_use block.
    if (options?.jsonSchema) {
      type ResponseContentBlock = { type: string; text?: string; input?: unknown };
      const toolBlock = response.content.find((b: ResponseContentBlock) => b.type === "tool_use");
      if (toolBlock && toolBlock.type === "tool_use") {
        return JSON.stringify(toolBlock.input);
      }
    }

    // Otherwise extract all text blocks and join.
    return response.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { type: string; text?: string }) => (b.type === "text" ? b.text ?? "" : ""))
      .join("");
  }
}

export function registerAnthropic(): void {
  registerLLMProvider("anthropic", (config) => {
    const apiKey = config.apiKeys.anthropic;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set. It is required when LLM_PROVIDER=anthropic.");
    }
    return new AnthropicLLMProvider({ apiKey, model: config.models.llm });
  });
}