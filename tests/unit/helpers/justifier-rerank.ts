// P1: Justifier LLM reranker.
//
// After hybrid retrieval produces top-K candidates, this module asks an LLM
// (DeepSeek) to score each candidate's relevance to the question on a 0.0-1.0
// scale. The candidates are then re-sorted by LLM relevance score, with the
// original RRF score as a tiebreaker.
//
// This is the "Justifier" pattern from ByteRover: instead of trusting the
// retrieval pipeline's ranking directly, an LLM acts as a second-pass judge
// that can detect when a fact is lexically similar but semantically irrelevant
// (e.g. wrong date, wrong entity).
//
// Cost: 1 LLM call per query (when candidates > keepOriginalN). With 500
// queries at ~1s/call, this adds ~8 minutes to the eval runtime.
//
// Difference from P0 MultiQuery rewriting (which regressed J from 45.2% to
// 38.6%/39.8%): MultiQuery was input-side (rewrite the query → embed each
// rewrite → retrieve → merge). The regression came from rewrite noise diluting
// the top-K. P1 is output-side: it only reorders existing candidates, it does
// not add new ones. The original RRF order is preserved as a tiebreaker, so
// if Justifier scores are equal, the original ranking wins.

import { callDeepSeek } from "./runtime-memory-real-llm-client";

// === Types ===

export type JustifierCandidate = {
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  rrfScore: number;
};

export type JustifierResult = {
  /** Relevance scores keyed by factId. */
  scores: Map<string, { score: number; reason: string }>;
  /** True if the LLM call was skipped (candidates ≤ keepOriginalN). */
  skipped: boolean;
  /** True if JSON parsing failed and we fell back to original order. */
  fallback: boolean;
};

type JustifierLlmCaller = (
  system: string,
  user: string,
  options?: Parameters<typeof callDeepSeek>[2],
) => Promise<{ content: string }>;

type JustifierOptions = {
  /** Re-rank only when candidates exceed this count. Default 5. */
  keepOriginalN?: number;
  /** LLM caller override, used by eval runners for cost tracking. */
  callLLM?: JustifierLlmCaller;
};

// === Prompt ===

function buildSystemPrompt(): string {
  return (
    "You are a relevance judge for a memory-augmented question answering system.\n" +
    "Given a question and a list of candidate facts, rate each fact's relevance " +
    "to answering the question on a scale of 0.0 to 1.0:\n" +
    "  1.0 = directly answers the question (the fact contains the answer)\n" +
    "  0.7 = strongly relevant (contains key information needed to answer)\n" +
    "  0.3 = partially relevant (related context but not the answer itself)\n" +
    "  0.0 = not relevant (wrong entity, wrong time, unrelated topic)\n\n" +
    "Pay special attention to:\n" +
    "  - Entity matching: a fact about Alice is not relevant to a question about Bob.\n" +
    "  - Temporal matching: if the question asks about a specific time, facts " +
    "from a different time period are less relevant.\n" +
    "  - Specificity: prefer facts that directly contain the answer over " +
    "general context.\n\n" +
    "Return ONLY a JSON array. No preamble, no markdown fences. Each element:\n" +
    '  {"factId": "<id>", "score": <0.0-1.0>, "reason": "<one short sentence>"}\n'
  );
}

function buildUserPrompt(
  question: string,
  candidates: ReadonlyArray<JustifierCandidate>,
): string {
  const candidateLines = candidates
    .map((c, i) => {
      const text = `${c.subject} ${c.predicate}: ${c.objectSummary}`.trim();
      return `[${i + 1}] factId: ${c.factId} | ${text}`;
    })
    .join("\n");

  return (
    `Question: ${question}\n\n` +
    `Candidate facts (in current retrieval order):\n${candidateLines}\n\n` +
    `Return the JSON array of relevance scores:`
  );
}

// === Parse LLM response ===

type ParsedScore = { factId: string; score: number; reason: string };

function parseJustifierResponse(content: string): ParsedScore[] | null {
  if (!content || typeof content !== "string") return null;

  // Strip markdown code fences if present
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Extract the JSON array (LLMs sometimes wrap it in prose)
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
        const reason =
          typeof item.reason === "string" ? item.reason : "";
        results.push({
          factId: item.factId,
          score,
          reason,
        });
      }
    }
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

// === Main entry point ===

/**
 * Re-rank candidates by LLM-judged relevance.
 *
 * @param question   The user's question.
 * @param candidates Top-K candidates from hybrid retrieval (already sorted by RRF).
 * @param options    keepOriginalN: skip LLM call if candidates ≤ this count.
 *                   Default 5 — small candidate lists don't benefit from reranking.
 * @returns          JustifierResult with scores map. Caller re-sorts candidates
 *                   using these scores + original RRF as tiebreaker.
 */
export async function rerankWithJustifier(
  question: string,
  candidates: ReadonlyArray<JustifierCandidate>,
  options: JustifierOptions = {},
): Promise<JustifierResult> {
  const keepOriginalN = options.keepOriginalN ?? 5;
  const callLLM = options.callLLM ?? callDeepSeek;

  // Skip when too few candidates — LLM reranking adds no value for top-5.
  if (candidates.length <= keepOriginalN) {
    const scores = new Map<string, { score: number; reason: string }>();
    for (let i = 0; i < candidates.length; i++) {
      // Score by original rank: earlier = higher (1 - i/total)
      const score = candidates.length > 0 ? 1 - i / candidates.length : 0;
      scores.set(candidates[i].factId, {
        score,
        reason: "skipped (few candidates)",
      });
    }
    return { scores, skipped: true, fallback: false };
  }

  const system = buildSystemPrompt();
  const user = buildUserPrompt(question, candidates);

  try {
    const response = await callLLM(system, user, {
      temperature: 0,
      maxTokens: 800,
    });
    const parsed = parseJustifierResponse(response.content);

    if (parsed === null) {
      // JSON parse failed — fall back to original RRF order
      const scores = new Map<string, { score: number; reason: string }>();
      for (let i = 0; i < candidates.length; i++) {
        const score = candidates.length > 0 ? 1 - i / candidates.length : 0;
        scores.set(candidates[i].factId, {
          score,
          reason: "fallback (LLM JSON parse failed)",
        });
      }
      return { scores, skipped: false, fallback: true };
    }

    const scores = new Map<string, { score: number; reason: string }>();
    for (const p of parsed) {
      scores.set(p.factId, { score: p.score, reason: p.reason });
    }
    // For candidates not scored by the LLM (shouldn't happen but be safe),
    // assign them score 0 so they sort to the end.
    for (const c of candidates) {
      if (!scores.has(c.factId)) {
        scores.set(c.factId, {
          score: 0,
          reason: "not scored by LLM",
        });
      }
    }
    return { scores, skipped: false, fallback: false };
  } catch (err) {
    // LLM call failed — fall back to original RRF order
    const scores = new Map<string, { score: number; reason: string }>();
    for (let i = 0; i < candidates.length; i++) {
      const score = candidates.length > 0 ? 1 - i / candidates.length : 0;
      scores.set(candidates[i].factId, {
        score,
        reason: `fallback (LLM error: ${(err as Error).message.slice(0, 80)})`,
      });
    }
    return { scores, skipped: false, fallback: true };
  }
}

/**
 * Sort candidates by Justifier score (desc), with original RRF score as
 * tiebreaker. Returns a new array — does not mutate the input.
 */
export function applyRerank(
  candidates: ReadonlyArray<JustifierCandidate>,
  result: JustifierResult,
): JustifierCandidate[] {
  return [...candidates].sort((a, b) => {
    const scoreA = result.scores.get(a.factId)?.score ?? 0;
    const scoreB = result.scores.get(b.factId)?.score ?? 0;
    if (scoreA !== scoreB) return scoreB - scoreA;
    // Tiebreaker: original RRF score (higher = better)
    return b.rrfScore - a.rrfScore;
  });
}
