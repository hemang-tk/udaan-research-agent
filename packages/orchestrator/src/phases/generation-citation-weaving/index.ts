export { splitSentences, filterHallucinations, type FilterResult } from "./filter.js";
export { weaveCitations, type ClaimMeta, type WovenBrief } from "./weaver.js";
export {
  SECTION_CONFIGS,
  generateSection,
  generateExecutiveSummary,
  type SectionConfig,
} from "./generate.js";
export { runGeneration, type GenerationDeps } from "./weave.js";
