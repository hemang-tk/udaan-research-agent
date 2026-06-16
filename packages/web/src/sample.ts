import type { ResearchBrief } from "./types.js";

/** A clearly-labeled sample brief so the UI is viewable without the full
 * backend + services + infra running. Not a live result. */
export const SAMPLE_QUERY =
  "How does micro-caching impact p99 tail latency in distributed stateful architectures?";

export const SAMPLE_BRIEF: ResearchBrief = {
  projectId: "sample",
  metadata: { totalClaims: 3, sectionsGenerated: 3 },
  sections: [
    {
      heading: "Executive Summary",
      bodyText:
        "Micro-caching consistently lowers p99 tail latency under steady-state load [1]. " +
        "Under memory pressure the effect can reverse, with garbage-collection overhead raising latency [2]. " +
        "Evidence on CPU cost remains thin and broadly consistent [3].",
    },
    {
      heading: "Conflicts in the Literature",
      bodyText:
        "Two studies report a roughly 40% p99 reduction during standard operation [1]. " +
        "Recent load-testing contradicts this, showing degradation once memory limits are breached [2].",
    },
    {
      heading: "Open Questions & Thin Evidence",
      bodyText: "CPU utilization is reported to scale linearly with cache volume, but on limited samples [3].",
    },
  ],
  bibliography: {
    "1": {
      claimId: "cl_9f2a1b",
      doi: "10.1038/s41586-023-00000-0",
      text: "the implementation of ephemeral micro-caching resulted in a 40.2% reduction in p99 tail latency",
    },
    "2": {
      claimId: "cl_77c3de",
      doi: "10.1145/3618257",
      text: "under memory-constrained environments, ephemeral caching increases p99 latency by 15% due to garbage collection overhead",
    },
    "3": {
      claimId: "cl_44b8a0",
      doi: "10.1016/j.jss.2024.01",
      text: "processor load maintained a strict 1:1 linear relationship with cached object volume",
    },
  },
};
