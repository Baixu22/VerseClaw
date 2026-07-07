// P3-B: Question decomposer for multi-hop reasoning.
//
// Multi-hop questions require connecting multiple facts (e.g., "What did
// Alice do after she left her job?"). The chainedRetrievalExpand approach
// (entity-graph traversal) fails when fact extraction is sparse — the
// bridging entity is often missing from the graph.
//
// Question decomposition replaces entity-graph traversal with sub-question
// retrieval: break the multi-hop question into 2-3 independent sub-questions,
// run hybrid retrieval per sub-question, then RRF-merge the hits. This
// surfaces facts containing the bridging entity even when the original
// question doesn't lexically overlap that fact.
//
// Single-hop questions are returned unchanged (no LLM call) for cost.
// On LLM failure or JSON parse error, the original question is returned
// so the caller can fall back to chained retrieval.

import { callDeepSeek } from "./runtime-memory-real-llm-client";
import { isMultiHopQuestion } from "../../../openclaw_runtime/src/runtime-core/memory-temporal-detector";

// === Types ===

export type DecomposedQuestion = {
  original: string;
  subQuestions: string[];
  /** How sub-question answers should be combined to answer the original. */
  mergeStrategy: "intersection" | "chain" | "union";
};

// === Prompt ===

function buildSystemPrompt(): string {
  return (
    "You are a question decomposer for multi-hop reasoning.\n" +
    "Given a complex question that requires connecting multiple facts,\n" +
    "break it into 2-3 simpler sub-questions that can each be answered\n" +
    "by a single fact retrieval.\n\n" +
    "Rules:\n" +
    "- Each sub-question must be self-contained and answerable independently.\n" +
    "- Preserve entity names from the original question.\n" +
    "- If the question is already simple (single-hop), return it unchanged\n" +
    "  as the only sub-question with mergeStrategy \"union\".\n" +
    "- \"chain\": answer of Q1 feeds into Q2 (temporal/causal sequence).\n" +
    "- \"intersection\": all sub-questions must be answered to form the\n" +
    "  final answer (e.g., \"who did X with Y at time Z\").\n" +
    "- \"union\": any sub-question answer could be the final answer.\n\n" +
    "Return ONLY a JSON object, no preamble, no markdown fences:\n" +
    '  {"subQuestions": ["q1", "q2", ...], "mergeStrategy": "chain"|"intersection"|"union"}\n'
  );
}

function buildUserPrompt(question: string): string {
  return `Question: ${question}\n\nDecompose:`;
}

// === Parse LLM response ===

type ParsedDecomposition = {
  subQuestions: string[];
  mergeStrategy: "intersection" | "chain" | "union";
};

function parseDecompositionResponse(content: string): ParsedDecomposition | null {
  if (!content || typeof content !== "string") return null;

  // Strip markdown code fences if present
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Extract the JSON object
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!objMatch) return null;
  const jsonStr = objMatch[0];

  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const obj = parsed as Record<string, unknown>;
    const subQuestionsRaw = obj.subQuestions;
    const mergeStrategyRaw = obj.mergeStrategy;

    if (!Array.isArray(subQuestionsRaw)) return null;

    const subQuestions = subQuestionsRaw.filter(
      (q): q is string => typeof q === "string" && q.trim().length > 0,
    );
    if (subQuestions.length === 0) return null;

    const validStrategies = new Set(["intersection", "chain", "union"]);
    const mergeStrategy =
      typeof mergeStrategyRaw === "string" &&
      validStrategies.has(mergeStrategyRaw)
        ? (mergeStrategyRaw as "intersection" | "chain" | "union")
        : "union";

    return { subQuestions, mergeStrategy };
  } catch {
    return null;
  }
}

// === Main entry point ===

/**
 * Decompose a multi-hop question into 2-3 sub-questions.
 *
 * - Single-hop questions (isMultiHopQuestion === false) skip the LLM call
 *   and return the original question as the only sub-question.
 * - On LLM failure or JSON parse error, returns the original question so
 *   the caller can fall back to chained retrieval.
 *
 * @param question      The user's question.
 * @param options       maxSubQuestions: cap on sub-question count (default 3).
 * @returns             DecomposedQuestion with subQuestions + mergeStrategy.
 */
export async function decomposeQuestion(
  question: string,
  options: { maxSubQuestions?: number } = {},
): Promise<DecomposedQuestion> {
  const maxSubQuestions = options.maxSubQuestions ?? 3;

  // Single-hop questions don't need decomposition — skip LLM call.
  if (!isMultiHopQuestion(question)) {
    return {
      original: question,
      subQuestions: [question],
      mergeStrategy: "union",
    };
  }

  const system = buildSystemPrompt();
  const user = buildUserPrompt(question);

  try {
    const response = await callDeepSeek(system, user, {
      temperature: 0,
      maxTokens: 400,
    });
    const parsed = parseDecompositionResponse(response.content);

    if (parsed === null) {
      // Parse failed — return original as single sub-question
      return {
        original: question,
        subQuestions: [question],
        mergeStrategy: "union",
      };
    }

    // Cap sub-questions at maxSubQuestions
    const subQuestions = parsed.subQuestions.slice(0, maxSubQuestions);

    // If decomposition returned only 1 sub-question, treat as no decomposition
    if (subQuestions.length <= 1) {
      return {
        original: question,
        subQuestions: [question],
        mergeStrategy: "union",
      };
    }

    return {
      original: question,
      subQuestions,
      mergeStrategy: parsed.mergeStrategy,
    };
  } catch (err) {
    // LLM call failed — return original as single sub-question
    return {
      original: question,
      subQuestions: [question],
      mergeStrategy: "union",
    };
  }
}
