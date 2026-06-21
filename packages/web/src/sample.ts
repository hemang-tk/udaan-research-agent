import type { ResearchBrief } from "./types.js";

/** Default first-load brief. Captured from a real (capped) pipeline run so the UI
 * is rich and viewable without the backend running — every claim still traces to a
 * real source. Regenerate by capturing a completed brief. */
export const SAMPLE_QUERY = "How does chain-of-thought prompting affect reasoning accuracy in large language models?";

export const SAMPLE_BRIEF: ResearchBrief = {
  "projectId": "sample",
  "metadata": {
    "totalClaims": 15,
    "sectionsGenerated": 2,
    "degraded": false,
    "degradedStages": []
  },
  "sections": [
    {
      "heading": "Executive Summary",
      "bodyText": "[1] Residual refinement improves the model's ability to recover from suboptimal reasoning [1]. [2] CD-CoT outperforms SCO in 20 out of 30 settings and surpasses BT, CC in all 30 settings [2]."
    },
    {
      "heading": "Open Questions & Thin Evidence",
      "bodyText": "[3] In base-9, digits run from 0 to 8 [3]. [4] Analyze theoretical aspects related to the experiments [4]. [5] The pseudo-code provided outlines the high-level control flow of the proposed optimization [5]. [6] Different LLMs are generally vulnerable to noisy rationales [6]. [7] Active example selection for in-context learning [7]. [8] The chain-of-thought prompting methodology simulates human cognitive processes by decomposing complex problems into smaller sub-problems [8]. [9] Alec Radford et al. wrote about large language model multitask learning [9]. [1] Residual refinement improves the model's ability to recover from suboptimal reasoning [1]. [10] CD-CoT votes all answers into a final answer for selection [10]. [11] Groupthink was discussed in a paper by Irving L Janis [11]. [12] A +5% accuracy gain is achieved without additional training [12]. [13] The Global Media and Social Sciences Research Journal has a volume number of 32 [13]. [14] The Global Media and Social Sciences Research Journal is a publication [14]. [15] The number of demonstrations k is determined by a formula involving the number of identified operations and the sample size [15]. [2] CD-CoT outperforms SCO in 20 out of 30 settings and surpasses BT, CC in all 30 settings [2]."
    }
  ],
  "bibliography": {
    "1": {
      "claimId": "cl_8f0cb29f421250efb5fc11d0290137a1",
      "doi": "10.1609/aaai.v40i40.40659",
      "text": "Residual refinement improves the model's ability to recover from suboptimal reasoning."
    },
    "2": {
      "claimId": "cl_d433f95c362c510abf94b5cfc4412006",
      "doi": "10.48550/arxiv.2410.23856",
      "text": "CD-CoT outperforms SCO in 20 out of 30 settings and surpasses BT, CC in all 30 settings."
    },
    "3": {
      "claimId": "cl_e793abf49e045a35bc79f40e52f11ba7",
      "doi": "10.48550/arxiv.2410.23856",
      "text": "In base-9, digits run from 0 to 8."
    },
    "4": {
      "claimId": "cl_b9ba760c06d55538a581b4b308c3723c",
      "doi": "10.48550/arxiv.2410.23856",
      "text": "Analyze theoretical aspects related to the experiments."
    },
    "5": {
      "claimId": "cl_ade44e1f78c551e7805a0981eb143047",
      "doi": "10.71465/gmssrj183",
      "text": "The pseudo-code provided outlines the high-level control flow of the proposed optimization."
    },
    "6": {
      "claimId": "cl_2ee3bc0f94b05acabc7247e20521ed4a",
      "doi": "10.48550/arxiv.2410.23856",
      "text": "Different LLMs are generally vulnerable to noisy rationales"
    },
    "7": {
      "claimId": "cl_9233141af3f653d5903de8e4d51f96a3",
      "doi": "10.48550/arxiv.2410.23856",
      "text": "Active example selection for in-context learning."
    },
    "8": {
      "claimId": "cl_9ed16e8a454152288023ef9d0c3c88fa",
      "doi": "10.71465/gmssrj183",
      "text": "The chain-of-thought prompting methodology simulates human cognitive processes by decomposing complex problems into smaller sub-problems."
    },
    "9": {
      "claimId": "cl_5e7c82de9b6f5460801f331f9b6eeef7",
      "doi": "10.48550/arxiv.2410.23856",
      "text": "Alec Radford et al. wrote about large language model multitask learning."
    },
    "10": {
      "claimId": "cl_337c35544ef158669bcb37c13fe3e5f6",
      "doi": "10.48550/arxiv.2410.23856",
      "text": "CD-CoT votes all answers into a final answer for selection."
    },
    "11": {
      "claimId": "cl_7c508e52876e585792528b7b4d1e1282",
      "doi": "10.48550/arxiv.2410.23856",
      "text": "Groupthink was discussed in a paper by Irving L Janis."
    },
    "12": {
      "claimId": "cl_842f933d2d8d51f78a083246e6ed1cb4",
      "doi": "10.1609/aaai.v40i40.40659",
      "text": "A +5% accuracy gain is achieved without additional training."
    },
    "13": {
      "claimId": "cl_300bfb01e8605031aa7ceb6ca113f927",
      "doi": "10.71465/gmssrj183",
      "text": "The Global Media and Social Sciences Research Journal has a volume number of 32."
    },
    "14": {
      "claimId": "cl_68f28846f9735fe28c2e37f8a3a17621",
      "doi": "10.71465/gmssrj183",
      "text": "The Global Media and Social Sciences Research Journal is a publication."
    },
    "15": {
      "claimId": "cl_b15237a4415b560a8e6e994045be0459",
      "doi": "10.1609/aaai.v39i24.34793",
      "text": "The number of demonstrations k is determined by a formula involving the number of identified operations and the sample size."
    }
  }
};
