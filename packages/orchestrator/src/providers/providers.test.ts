/**
 * Unit tests for Gemini, Groq, and Anthropic LLM providers.
 * All HTTP is mocked — no live API keys required in CI.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiLLMProvider } from "./gemini.js";
import { GroqLLMProvider } from "./groq.js";
import { AnthropicLLMProvider } from "./anthropic.js";
import type { LLMMessage } from "@udaan/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MESSAGES: LLMMessage[] = [{ role: "user", content: "Hello" }];

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

function getFetchRequestBody(): any {
  const call = vi.mocked(fetch).mock.calls[0]!;
  return JSON.parse(((call[1] as RequestInit).body as string));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// GeminiLLMProvider
// ---------------------------------------------------------------------------

describe("GeminiLLMProvider", () => {
  const provider = new GeminiLLMProvider({ apiKey: "test-key", model: "gemini-1.5-pro" });

  it("returns text from candidates[0].content.parts[0].text", async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: "pong" }] } }] });
    expect(await provider.complete(MESSAGES)).toBe("pong");
  });

  it("sends temperature: 0 by default", async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: "" }] } }] });
    await provider.complete(MESSAGES);
    const body = getFetchRequestBody();
    expect(body.generationConfig.temperature).toBe(0);
  });

  it("sets responseMimeType and responseSchema when jsonSchema is provided", async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
    const schema = { type: "object", properties: { x: { type: "string" } } };
    await provider.complete(MESSAGES, { jsonSchema: schema });
    const body = getFetchRequestBody();
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toEqual(schema);
  });

  it("includes systemInstruction when system option is set", async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: "" }] } }] });
    await provider.complete(MESSAGES, { system: "You are helpful" });
    const body = getFetchRequestBody();
    expect(body.systemInstruction.parts[0].text).toBe("You are helpful");
  });

  it("throws on non-ok response", async () => {
    mockFetch({ error: { message: "bad key" } }, 400);
    await expect(provider.complete(MESSAGES)).rejects.toThrow("Gemini request failed: 400");
  });

  it("throws when apiKey is empty", async () => {
    const noKey = new GeminiLLMProvider({ apiKey: "", model: "gemini-1.5-pro" });
    await expect(noKey.complete(MESSAGES)).rejects.toThrow("GEMINI_API_KEY");
  });
});

// ---------------------------------------------------------------------------
// GroqLLMProvider
// ---------------------------------------------------------------------------

describe("GroqLLMProvider", () => {
  const provider = new GroqLLMProvider({ apiKey: "test-key", model: "llama-3.1-70b-versatile" });

  it("returns choices[0].message.content", async () => {
    mockFetch({ choices: [{ message: { content: "pong" } }] });
    expect(await provider.complete(MESSAGES)).toBe("pong");
  });

  it("prepends a system message when system option is set", async () => {
    mockFetch({ choices: [{ message: { content: "" } }] });
    await provider.complete(MESSAGES, { system: "Be concise" });
    const body = getFetchRequestBody();
    expect(body.messages[0]).toEqual({ role: "system", content: "Be concise" });
    expect(body.messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  it("sends temperature: 0 by default", async () => {
    mockFetch({ choices: [{ message: { content: "" } }] });
    await provider.complete(MESSAGES);
    const body = getFetchRequestBody();
    expect(body.temperature).toBe(0);
  });

  it("sets response_format: json_object when jsonSchema is provided", async () => {
    mockFetch({ choices: [{ message: { content: "{}" } }] });
    await provider.complete(MESSAGES, { jsonSchema: { type: "object" } });
    const body = getFetchRequestBody();
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("throws on non-ok response", async () => {
    mockFetch({ error: { message: "rate limit" } }, 429);
    await expect(provider.complete(MESSAGES)).rejects.toThrow("Groq request failed: 429");
  });
});

// ---------------------------------------------------------------------------
// AnthropicLLMProvider — uses the SDK, so mock it differently
// ---------------------------------------------------------------------------

describe("AnthropicLLMProvider", () => {
  let provider: AnthropicLLMProvider;
  let mockCreate: ReturnType<typeof vi.fn>;
    
  // beforeEach(async () => {
  //   // Mock the @anthropic-ai/sdk module before constructing the provider.
  //   mockCreate = vi.fn();
    // vi.mock("@anthropic-ai/sdk", () => ({
    //   default: vi.fn().mockImplementation(() => ({
    //     messages: { create: mockCreate },
    //   })),
    // }));
  //   const { AnthropicLLMProvider: A } = await import("./anthropic.js");
  //   provider = new A({ apiKey: "test-key", model: "claude-opus-4-8" });
  // });
      beforeEach(() => {
  mockCreate = vi.fn();

  const fakeClient = {
    messages: {
      create: mockCreate,
    },
  };

  provider = new AnthropicLLMProvider(
    { apiKey: "test-key", model: "claude-opus-4-8" },
    fakeClient as any,
  );
});

  it("returns joined text blocks", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello from Claude" }],
    });
    expect(await provider.complete(MESSAGES)).toBe("Hello from Claude");
  });

  it("NEVER sends temperature or top_p in the request", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "" }] });
    await provider.complete(MESSAGES, { temperature: 0.5, topP: 0.9 });
    const call = mockCreate.mock.calls[0]?.[0];
    expect(call).not.toHaveProperty("temperature");
    expect(call).not.toHaveProperty("top_p");
  });

  it("sends thinking: { type: adaptive } by default", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "" }] });
    await provider.complete(MESSAGES);
    expect(mockCreate.mock.calls[0]?.[0]?.thinking).toEqual({ type: "adaptive" });
  });

  it("uses a forced tool call for JSON output and returns JSON string", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "__json_output__", input: { answer: 42 } }],
    });
    const result = await provider.complete(MESSAGES, { jsonSchema: { type: "object" } });
    expect(JSON.parse(result)).toEqual({ answer: 42 });
    const call = mockCreate.mock.calls[0]?.[0];
    expect(call?.tool_choice).toEqual({ type: "tool", name: "__json_output__" });
    expect(call?.tools?.[0]?.name).toBe("__json_output__");
  });

  it("passes system as a top-level field, not in messages array", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "" }] });
    await provider.complete(MESSAGES, { system: "Be helpful" });
    const call = mockCreate.mock.calls[0]?.[0];
    expect(call?.system).toBe("Be helpful");
    const hasSystemRole = (call?.messages as Array<{ role: string }>)?.some(
      (m) => m.role === "system",
    );
    expect(hasSystemRole).toBe(false);
  });
});