import { registerOllama } from "./providers/ollama.js";
import { registerGemini } from "./providers/gemini.js";
import { registerGroq } from "./providers/groq.js";
import { registerAnthropic } from "./providers/anthropic.js";

// Register all LLM providers on import so createLLMProvider() can resolve any
// value of LLM_PROVIDER documented in infra/.env.example.
registerOllama();
registerGemini();
registerGroq();
registerAnthropic();

export * as queryOrchestration from "./phases/query-orchestration/index.js";
export * as openGraphGateway from "./phases/open-graph-gateway/index.js";
export * as fullTextResolution from "./phases/full-text-resolution/index.js";
export * as generationCitationWeaving from "./phases/generation-citation-weaving/index.js";
export { OllamaLLMProvider, registerOllama } from "./providers/ollama.js";
export { GeminiLLMProvider, registerGemini } from "./providers/gemini.js";
export { GroqLLMProvider, registerGroq } from "./providers/groq.js";
export { AnthropicLLMProvider, registerAnthropic } from "./providers/anthropic.js";
