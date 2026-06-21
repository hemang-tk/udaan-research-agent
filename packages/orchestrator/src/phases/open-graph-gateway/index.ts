export * from "./types.js";
export {
  stripTags,
  normalizeDoi,
  reconstructInvertedAbstract,
  fuzzyHash,
  isValidCandidate,
  dropInvalid,
} from "./normalize.js";
export { deduplicate } from "./dedupe.js";
export { dispatchAll, withTimeout, CircuitBreaker, DEFAULT_TIMEOUT_MS } from "./dispatcher.js";
export { OpenAlexAdapter } from "./adapters/openalex.js";
export { SemanticScholarAdapter } from "./adapters/semantic-scholar.js";
export { CrossrefAdapter } from "./adapters/crossref.js";
export {
  runGateway,
  defaultAdapters,
  MAX_CANDIDATES,
  type GatewayDeps,
  type GatewayResult,
} from "./gateway.js";
