import type { RerankResultV1 } from "../../../../shared/knowledge/rerank.js";
export type { RerankResultV1 } from "../../../../shared/knowledge/rerank.js";

export type RerankCandidate = { id: string; text: string };
export type RerankProviderV1 = {
  schema: "RerankProvider/v1";
  providerRef: string;
  model: string;
  rerank: (
    query: string,
    candidates: readonly RerankCandidate[],
    options: { signal: AbortSignal; deadlineAtMs: number; batchSize: number; batchChars: number },
  ) => Promise<RerankResultV1>;
};

/** Jina-compatible endpoint used by SiliconFlow and local rerank servers. */
export function createEndpointRerankProvider(options: {
  providerRef: string;
  model: string;
  endpoint: string;
  request: (
    input: { model: string; query: string; documents: string[] },
    signal: AbortSignal,
  ) => Promise<{
    results: Array<{ index: number; relevance_score: number }>;
    tokens?: { input_tokens?: number };
  }>;
}): RerankProviderV1 {
  return {
    schema: "RerankProvider/v1",
    providerRef: options.providerRef,
    model: options.model,
    async rerank(query, candidates, call) {
      const started = performance.now();
      if (
        new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length ||
        candidates.some((candidate) => !candidate.id || !candidate.text)
      ) {
        throw new Error("Rerank candidates require unique IDs and text");
      }
      const all: RerankResultV1["results"] = [];
      let batchCount = 0,
        inputTokens = 0,
        observedTokens = false;
      for (let offset = 0; offset < candidates.length; ) {
        call.signal.throwIfAborted();
        const batch: RerankCandidate[] = [];
        let chars = 0;
        while (offset + batch.length < candidates.length && batch.length < call.batchSize) {
          const candidate = candidates[offset + batch.length];
          if (batch.length && chars + candidate.text.length > call.batchChars) break;
          if (candidate.text.length > call.batchChars)
            throw new Error("Rerank candidate exceeds batch budget");
          batch.push(candidate);
          chars += candidate.text.length;
        }
        const remaining = call.deadlineAtMs - Date.now();
        if (remaining <= 0) throw new DOMException("Rerank deadline exceeded", "TimeoutError");
        const signal = AbortSignal.any([call.signal, AbortSignal.timeout(remaining)]);
        let response;
        try {
          response = await options.request(
            { model: options.model, query, documents: batch.map((candidate) => candidate.text) },
            signal,
          );
        } catch (error) {
          if (call.signal.aborted || signal.aborted) {
            return {
              schema: "RerankResult/v1",
              status: "cancelled",
              providerRef: options.providerRef,
              model: options.model,
              scoreKind: "raw-relevance",
              calibrated: false,
              candidateCount: candidates.length,
              batchCount,
              elapsedMs: performance.now() - started,
              results: [],
            };
          }
          throw error;
        }
        if (
          response.results.length !== batch.length ||
          new Set(response.results.map((row) => row.index)).size !== batch.length ||
          response.results.some(
            (row) =>
              !Number.isInteger(row.index) ||
              row.index < 0 ||
              row.index >= batch.length ||
              !Number.isFinite(row.relevance_score),
          )
        ) {
          throw new Error("Rerank response is not a complete finite-score permutation");
        }
        const ordered = [...response.results]
          .map((row) => ({ id: batch[row.index].id, score: row.relevance_score, index: row.index }))
          .sort((a, b) => b.score - a.score || a.index - b.index);
        all.push(...ordered.map(({ id, score }) => ({ id, score })));
        batchCount += 1;
        offset += batch.length;
        if (
          typeof response.tokens?.input_tokens === "number" &&
          Number.isFinite(response.tokens.input_tokens)
        ) {
          inputTokens += response.tokens.input_tokens;
          observedTokens = true;
        }
      }
      all.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      return {
        schema: "RerankResult/v1",
        status: "complete",
        providerRef: options.providerRef,
        model: options.model,
        scoreKind: "raw-relevance",
        calibrated: false,
        candidateCount: candidates.length,
        batchCount,
        elapsedMs: performance.now() - started,
        ...(observedTokens ? { inputTokens } : {}),
        results: all,
      };
    },
  };
}
