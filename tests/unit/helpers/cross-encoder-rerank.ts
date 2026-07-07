// P3-A: Cross-Encoder pair-wise reranker.
//
// While the P1 Justifier asks the LLM to score ALL candidates in one
// list-wise call, the Cross-Encoder scores each (question, fact) pair
// INDEPENDENTLY. Pair-wise scoring is more precise because each fact
// gets the model's full attention (no inter-candidate comparison bias),
// but costs more LLM calls.
//
// To control cost we use a BATCH pair-wise strategy: instead of one
// call per candidate, we issue one call per BATCH of candidates
// (default 5), asking the model to score each fact in the batch
// independently. This keeps the per-fact attention benefit while
// reducing N calls → ceil(N / batchSize) calls.
//
// Integration: produces a JustifierResult-compatible shape so the
// existing applyRerank() helper reuses sorting logic unchanged.
// Stage 2 eval uses this as the default reranker; P3_RERANKER=none can
// disable reranking for ablation.

import { callDeepSeek } from "./runtime-memory-real-llm-client";
import type {
  JustifierCandidate,
  JustifierResult,
} from "./justifier-rerank";

// === Types ===

export type CrossEncoderCandidate = JustifierCandidate;

type CrossEncoderLlmCaller = (
  system: string,
  user: string,
  options?: Parameters<typeof callDeepSeek>[2],
) => Promise<{ content: string }>;

export type CrossEncoderOptions = {
  /** Skip LLM call when candidates ≤ this count. Default 5. */
  keepOriginalN?: number;
  /** Candidates scored per LLM call. Default 5. */
  batchSize?: number;
  /** LLM caller override, used by eval runners for cost tracking. */
  callLLM?: CrossEncoderLlmCaller;
};

// === Prompt (batch pair-wise) ===

function buildSystemPrompt(): string {
  return (
    "You are a relevance scorer for a memory-augmented question answering system.\n" +
    "You will be given a question and a batch of facts. For EACH fact,\n" +
    "rate its relevance to answering the question on a scale of 0.0 to 1.0:\n" +
    "  1.0 = directly answers the question (the fact contains the answer)\n" +
    "  0.7 = strongly relevant (contains key information needed to answer)\n" +
    "  0.3 = partially relevant (related context but not the answer itself)\n" +
    "  0.0 = not relevant (wrong entity, wrong time, unrelated topic)\n\n" +
    "Score each fact INDEPENDENTLY — do not compare facts to each other.\n" +
    "Pay special attention to:\n" +
    "  - Entity matching: a fact about Alice is not relevant to a question about Bob.\n" +
    "  - Temporal matching: if the question asks about a specific time, facts\n" +
    "    from a different time period are less relevant.\n" +
    "  - Specificity: prefer facts that directly contain the answer.\n\n" +
    "Return ONLY a JSON array. No preamble, no markdown fences. Each element:\n" +
    '  {"factId": "<id>", "score": <0.0-1.0>, "reason": "<one short sentence>"}\n'
  );
}

function buildUserPrompt(
  question: string,
  batch: ReadonlyArray<CrossEncoderCandidate>,
): string {
  const factLines = batch
    .map((c, i) => {
      const text = `${c.subject} ${c.predicate}: ${c.objectSummary}`.trim();
      return `[${i + 1}] factId: ${c.factId} | ${text}`;
    })
    .join("\n");

  return (
    `Question: ${question}\n\n` +
    `Facts to score (each INDEPENDENTLY):\n${factLines}\n\n` +
    `Return the JSON array of scores:`
  );
}

// === Parse LLM response ===

type ParsedScore = { factId: string; score: number; reason: string };

function parseBatchResponse(content: string): ParsedScore[] | null {
  if (!content || typeof content !== "string") return null;

  // Strip markdown code fences if present
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Extract the JSON array
  const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!arrayMatch) return null;
  const jsonStr = arrayMatch[0];

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;

    const results: ParsedScore[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof item.factId === "string" &&
        typeof item.score === "number"
      ) {
        const score = Math.max(0, Math.min(1, item.score));
        const reason = typeof item.reason === "string" ? item.reason : "";
        results.push({ factId: item.factId, score, reason });
      }
    }
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

// === Main entry point ===

/**
 * Re-rank candidates using pair-wise (batch) LLM scoring.
 *
 * Produces a JustifierResult-compatible shape so applyRerank() works
 * unchanged. Each batch of `batchSize` candidates is scored in a
 * single LLM call where the model evaluates each fact independently.
 *
 * @param question   The user's question.
 * @param candidates Top-K candidates from hybrid retrieval (sorted by RRF).
 * @param options    keepOriginalN: skip when ≤ this count (default 5).
 *                   batchSize: candidates per LLM call (default 5).
 * @returns          JustifierResult with scores map + callCount metadata.
 */
export async function rerankWithCrossEncoder(
  question: string,
  candidates: ReadonlyArray<CrossEncoderCandidate>,
  options: CrossEncoderOptions = {},
): Promise<JustifierResult & { callCount: number }> {
  const keepOriginalN = options.keepOriginalN ?? 5;
  const batchSize = options.batchSize ?? 5;
  const callLLM = options.callLLM ?? callDeepSeek;

  // Skip when too few candidates — pair-wise reranking adds no value for top-5.
  if (candidates.length <= keepOriginalN) {
    const scores = new Map<string, { score: number; reason: string }>();
    for (let i = 0; i < candidates.length; i++) {
      const score = candidates.length > 0 ? 1 - i / candidates.length : 0;
      scores.set(candidates[i].factId, {
        score,
        reason: "skipped (few candidates)",
      });
    }
    return { scores, skipped: true, fallback: false, callCount: 0 };
  }

  const system = buildSystemPrompt();
  const scores = new Map<string, { score: number; reason: string }>();
  let callCount = 0;
  let anyBatchFailed = false;

  // Process candidates in batches. Each batch gets one LLM call where
  // the model scores every fact in the batch independently.
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const user = buildUserPrompt(question, batch);

    try {
      const response = await callLLM(system, user, {
        temperature: 0,
        maxTokens: 600,
      });
      callCount += 1;

      const parsed = parseBatchResponse(response.content);
      if (parsed === null) {
        // Parse failed for this batch — assign rank-based fallback scores
        anyBatchFailed = true;
        for (let j = 0; j < batch.length; j++) {
          const rank = i + j;
          const score = candidates.length > 0 ? 1 - rank / candidates.length : 0;
          scores.set(batch[j].factId, {
            score,
            reason: "fallback (batch JSON parse failed)",
          });
        }
        continue;
      }

      for (const p of parsed) {
        scores.set(p.factId, { score: p.score, reason: p.reason });
      }
      // For candidates in this batch not scored by LLM (defensive)
      for (const c of batch) {
        if (!scores.has(c.factId)) {
          scores.set(c.factId, {
            score: 0,
            reason: "not scored by LLM in batch",
          });
        }
      }
    } catch (err) {
      // LLM call failed for this batch — fallback scores for batch
      anyBatchFailed = true;
      callCount += 1;
      for (let j = 0; j < batch.length; j++) {
        const rank = i + j;
        const score = candidates.length > 0 ? 1 - rank / candidates.length : 0;
        scores.set(batch[j].factId, {
          score,
          reason: `fallback (LLM error: ${(err as Error).message.slice(0, 60)})`,
        });
      }
    }
  }

  // Ensure every candidate has a score (defensive — covers edge cases where
  // a batch was somehow skipped entirely).
  for (const c of candidates) {
    if (!scores.has(c.factId)) {
      const rank = candidates.indexOf(c);
      const score = candidates.length > 0 ? 1 - rank / candidates.length : 0;
      scores.set(c.factId, {
        score,
        reason: "fallback (not reached by any batch)",
      });
    }
  }

  return {
    scores,
    skipped: false,
    fallback: anyBatchFailed,
    callCount,
  };
}
