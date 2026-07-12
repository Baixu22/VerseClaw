import type { BlockEntityQuery, BlockQuery, BlockStoreApi, ContextBlock } from "../block.js";

/**
 * DCS Stage 5: context_search tool
 *
 * Per DCS v1.6 spec §第六章:
 * - Rule-extract candidate entities from query string
 * - Non-empty entities → queryByEntity (SAG mode)
 * - Empty entities → query (fallback mode, fallback_mode='vector_only')
 * - query='principles' → block_types=["experience"] filter
 * - Returns top-K (K ≤ 5)
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "shall", "to", "of", "in",
  "on", "at", "by", "for", "with", "about", "as", "into", "through",
  "during", "before", "after", "above", "below", "from", "up", "down",
  "out", "off", "over", "under", "again", "further", "then", "once",
  "here", "there", "when", "where", "why", "how", "all", "each", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not", "only",
  "own", "same", "so", "than", "too", "very", "s", "t", "just", "and",
  "but", "if", "or", "because", "what", "which", "who", "whom",
  "principles",
]);

const MAX_RESULTS = 5;

export function extractEntities(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const tokens = trimmed
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((token) => token.length > 0)
    .filter((token) => !STOP_WORDS.has(token));
  return [...new Set(tokens)];
}

export interface SearchContextParams {
  query: string;
  sessionId: string;
  blockStore: BlockStoreApi;
  limit?: number;
}

export async function searchContext(
  params: SearchContextParams,
): Promise<ContextBlock[]> {
  const entities = extractEntities(params.query);
  const isPrinciplesQuery = params.query.trim().toLowerCase() === "principles";
  const requestedLimit = typeof params.limit === "number"
    ? Math.min(Math.max(1, Math.floor(params.limit)), MAX_RESULTS)
    : MAX_RESULTS;

  let results: ContextBlock[];

  if (entities.length > 0) {
    const queryParams: BlockEntityQuery = {
      requester_session_id: params.sessionId,
      entities,
      limit: requestedLimit,
      ...(isPrinciplesQuery
        ? { block_types: ["experience" as const] }
        : {}),
    };
    results = await params.blockStore.queryByEntity(queryParams);
  } else {
    const queryParams: BlockQuery = {
      requester_session_id: params.sessionId,
      limit: requestedLimit,
      ...(isPrinciplesQuery
        ? { block_types: ["experience" as const] }
        : {}),
    };
    results = await params.blockStore.query(queryParams);
    // Mark fallback_mode on results
    results = results.map((block) => ({
      ...block,
      fallback_mode: "vector_only" as const,
    }));
  }

  return results.slice(0, requestedLimit);
}
