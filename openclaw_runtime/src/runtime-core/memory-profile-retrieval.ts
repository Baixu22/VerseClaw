// Open-domain retrieval: augments hybrid search with structured profile dimensions.
// For open-domain questions ("tell me about Alice"), profile dimensions provide
// an O(1) structured summary that the LLM can use directly, while hybrid search
// provides specific evidence facts for synthesis.

import {
  isRuntimeMemoryAcceptedVerificationStatus,
  type RuntimeMemoryQueryableFact,
} from "./memory-context.js";
import {
  OPTIMAL_HYBRID_FUSION,
  type HybridSearchHit,
  type HybridSearchIndex,
} from "./memory-hybrid-retrieval.js";
import {
  selectProfileDimensions,
  type ProfileDimension,
  type UserProfile,
} from "./memory-user-profile.js";

export type OpenDomainRetrievalResult = {
  profileDimensions: ProfileDimension[];
  detailFacts: RuntimeMemoryQueryableFact[];
  detailHits: HybridSearchHit[];
};

export function openDomainRetrieval(
  question: string,
  profile: UserProfile,
  index: HybridSearchIndex,
  queryEmbedding: Float32Array,
  options: {
    topK?: number;
    candidateThreshold?: number;
    referenceTime?: number;
  } = {},
): OpenDomainRetrievalResult {
  const { topK = 5, candidateThreshold = 0.7, referenceTime } = options;

  // Step 1: Get profile dimensions relevant to the question (O(1) lookup)
  const profileDimensions = selectProfileDimensions(question, profile);

  // Step 2: Get detail facts via hybrid search
  const rawHits = index.searchWithEmbedding(
    question,
    queryEmbedding,
    topK * 2, // over-fetch to compensate for post-filtering
    OPTIMAL_HYBRID_FUSION,
  );

  // Step 3: Post-filter (temporal + candidate threshold)
  const filteredHits = rawHits.filter((hit) => {
    const fact = hit.fact;
    if (referenceTime !== undefined && fact.valid_at > referenceTime) {
      return false;
    }
    if (!isRuntimeMemoryAcceptedVerificationStatus(fact.verificationStatus)) {
      if (!(typeof fact.confidence === "number" && fact.confidence >= candidateThreshold)) {
        return false;
      }
    }
    return true;
  });

  const detailHits = filteredHits.slice(0, topK);
  const detailFacts = detailHits.map((h) => h.fact);

  return {
    profileDimensions,
    detailFacts,
    detailHits,
  };
}

export function buildProfileContextString(
  dimensions: ProfileDimension[],
): string[] {
  if (dimensions.length === 0) return [];

  // Group by category
  const byCategory = new Map<string, ProfileDimension[]>();
  for (const dim of dimensions) {
    const list = byCategory.get(dim.category) ?? [];
    list.push(dim);
    byCategory.set(dim.category, list);
  }

  const lines: string[] = ["Profile Summary:"];
  for (const [category, dims] of byCategory) {
    lines.push(`  ${category}:`);
    for (const dim of dims) {
      lines.push(`    - ${dim.subject}: ${dim.value}`);
    }
  }
  return lines;
}
