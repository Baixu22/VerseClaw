// @vitest-environment node
// CV3: Multi-judge vote extension of L3 real LLM usage.
// Cross-validates L3's single-judge results with 3-vote majority at temp=0.3.
//
// Anti-overfitting:
// - Uses same token-probe pattern as L3 (independent ground truth)
// - Fixed step sampling, no cherry-picking
//
// Anti-hallucination:
// - Multi-judge vote (3 calls at temp=0.3, ≥2/3 agreement)
// - A/B ablation stability across votes
// - Negative assertion stability across votes

import { describe, expect, it } from "vitest";
import { createRuntimeMemoryProviderResult } from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import type { RuntimeMemoryTemporalFact } from "../../openclaw_runtime/src/runtime-core";
import {
  callDeepSeek,
  hasDeepSeekKey,
} from "./helpers/runtime-memory-real-llm-client";
import {
  makeProbeFact,
  makeUniqueProbeToken,
} from "./helpers/runtime-memory-real-corpus";

async function getMemoryContext(
  facts: readonly RuntimeMemoryTemporalFact[],
  query: {
    taskId: string;
    subject: string;
    predicate: string;
    referenceTime: number;
    tokenBudget?: number;
  },
): Promise<string> {
  const result = await createRuntimeMemoryProviderResult(
    {
      facts: facts as never,
      defaultTokenBudget: query.tokenBudget ?? 256,
      defaultLimit: 8,
    },
    {
      taskId: query.taskId,
      tokenBudget: query.tokenBudget ?? 256,
      metadata: {
        memoryQuery: {
          taskId: query.taskId,
          subject: query.subject,
          predicate: query.predicate,
          reference_time: query.referenceTime,
          limit: 8,
        },
      },
    },
  );
  return result.contextItems.map((item) => item.text).join("\n");
}

function buildProbePrompt(
  memoryContextText: string,
  userQuestion: string,
): { system: string; user: string } {
  const system = [
    "You are a helpful assistant with access to the user's stored preferences.",
    "If relevant memory is provided below, use it to answer.",
    "If no memory is provided or it is irrelevant, answer based on general knowledge.",
    "Do not invent preferences that are not in the memory.",
    "",
    memoryContextText.length > 0
      ? `=== STORED MEMORY ===\n${memoryContextText}\n=== END MEMORY ===`
      : "=== STORED MEMORY ===\n(no memory stored)\n=== END MEMORY ===",
  ].join("\n");
  return { system, user: userQuestion };
}

// Run a single A/B vote: returns { tokenInA, tokenInB, abAttributable }
async function runAbVote(
  memoryText: string,
  userQuestion: string,
  targetToken: string,
): Promise<{ tokenInA: boolean; tokenInB: boolean; abAttributable: boolean }> {
  const promptA = buildProbePrompt(memoryText, userQuestion);
  const promptB = buildProbePrompt("", userQuestion);
  const resA = await callDeepSeek(promptA.system, promptA.user, {
    temperature: 0.3,
    maxTokens: 64,
  });
  const resB = await callDeepSeek(promptB.system, promptB.user, {
    temperature: 0.3,
    maxTokens: 64,
  });
  const tokenInA = resA.content.includes(targetToken);
  const tokenInB = resB.content.includes(targetToken);
  return { tokenInA, tokenInB, abAttributable: tokenInA && !tokenInB };
}

describe.skipIf(!hasDeepSeekKey())("CV3: multi-judge vote extension of L3", () => {
  it(
    "multi_judge_recall_stability",
    async () => {
      // 3 votes on single-fact recall — ≥2/3 must show token in with-memory response.
      const token = makeUniqueProbeToken(100);
      const { fact } = makeProbeFact({
        factId: "cv3_recall",
        taskId: "task_cv3_recall",
        subject: "Cv3Recall",
        predicate: "preference_code",
        token,
        valid_at: 100,
        reference_time: 100,
        confidence: 0.95,
      });
      const memoryText = await getMemoryContext(
        [fact],
        {
          taskId: "task_cv3_recall",
          subject: "Cv3Recall",
          predicate: "preference_code",
          referenceTime: 1000,
        },
      );
      const question = "What is the user's preference code? Answer with the code only.";

      let recallCount = 0;
      for (let v = 0; v < 3; v += 1) {
        const promptA = buildProbePrompt(memoryText, question);
        const resA = await callDeepSeek(promptA.system, promptA.user, {
          temperature: 0.3,
          maxTokens: 64,
        });
        if (resA.content.includes(token)) recallCount += 1;
      }

      // ≥2/3 votes must recall the token
      expect(recallCount).toBeGreaterThanOrEqual(2);
    },
    60_000,
  ); // 60s for 3 LLM calls

  it(
    "multi_judge_ab_attribution_stability",
    async () => {
      // 3 A/B votes — ≥2/3 must show abAttributable (token in A, not in B).
      const token = makeUniqueProbeToken(101);
      const { fact } = makeProbeFact({
        factId: "cv3_ab",
        taskId: "task_cv3_ab",
        subject: "Cv3Ab",
        predicate: "preference_code",
        token,
        valid_at: 100,
        reference_time: 100,
        confidence: 0.95,
      });
      const memoryText = await getMemoryContext(
        [fact],
        {
          taskId: "task_cv3_ab",
          subject: "Cv3Ab",
          predicate: "preference_code",
          referenceTime: 1000,
        },
      );
      const question = "What is the user's preference code? Answer with the code only.";

      let abCount = 0;
      for (let v = 0; v < 3; v += 1) {
        const result = await runAbVote(memoryText, question, token);
        if (result.abAttributable) abCount += 1;
      }

      // ≥2/3 votes must show A/B attribution
      expect(abCount).toBeGreaterThanOrEqual(2);
    },
    120_000,
  ); // 120s for 6 LLM calls (3 votes × 2 arms)

  it(
    "multi_judge_negative_assertion_stability",
    async () => {
      // 3 votes — ≥2/3 must show negativeClean (no uninjected token).
      const tokenReal = makeUniqueProbeToken(102);
      const tokenFake = makeUniqueProbeToken(103);
      const { fact } = makeProbeFact({
        factId: "cv3_neg",
        taskId: "task_cv3_neg",
        subject: "Cv3Neg",
        predicate: "preference_code",
        token: tokenReal,
        valid_at: 100,
        reference_time: 100,
        confidence: 0.95,
      });
      const memoryText = await getMemoryContext(
        [fact],
        {
          taskId: "task_cv3_neg",
          subject: "Cv3Neg",
          predicate: "preference_code",
          referenceTime: 1000,
        },
      );
      const question = `Is the user's preference code ${tokenFake}? If not, what is it? Answer with the code only.`;

      let cleanCount = 0;
      for (let v = 0; v < 3; v += 1) {
        const promptA = buildProbePrompt(memoryText, question);
        const resA = await callDeepSeek(promptA.system, promptA.user, {
          temperature: 0.3,
          maxTokens: 64,
        });
        if (!resA.content.includes(tokenFake)) cleanCount += 1;
      }

      // ≥2/3 votes must NOT contain the fake token
      expect(cleanCount).toBeGreaterThanOrEqual(2);
    },
    60_000,
  ); // 60s for 3 LLM calls

  it(
    "multi_judge_conflict_winner_stability",
    async () => {
      // 3 votes on conflict resolution — ≥2/3 must show winner token (not loser).
      const tokenWinner = makeUniqueProbeToken(104);
      const tokenLoser = makeUniqueProbeToken(105);
      const { fact: factLoser } = makeProbeFact({
        factId: "cv3_conf_loser",
        taskId: "task_cv3_conf",
        subject: "Cv3Conf",
        predicate: "preference_code",
        token: tokenLoser,
        valid_at: 100,
        reference_time: 100,
        confidence: 0.5,
      });
      const { fact: factWinner } = makeProbeFact({
        factId: "cv3_conf_winner",
        taskId: "task_cv3_conf",
        subject: "Cv3Conf",
        predicate: "preference_code",
        token: tokenWinner,
        valid_at: 100,
        reference_time: 100,
        confidence: 0.9,
      });
      // Provider returns both facts sorted by rank — winner first.
      // The LLM should use the higher-confidence fact (winner).
      const memoryText = await getMemoryContext(
        [factWinner, factLoser],
        {
          taskId: "task_cv3_conf",
          subject: "Cv3Conf",
          predicate: "preference_code",
          referenceTime: 1000,
        },
      );
      const question = "What is the user's preference code? Answer with the code only.";

      let winnerCount = 0;
      let loserCleanCount = 0;
      for (let v = 0; v < 3; v += 1) {
        const promptA = buildProbePrompt(memoryText, question);
        const resA = await callDeepSeek(promptA.system, promptA.user, {
          temperature: 0.3,
          maxTokens: 64,
        });
        if (resA.content.includes(tokenWinner)) winnerCount += 1;
        if (!resA.content.includes(tokenLoser)) loserCleanCount += 1;
      }

      // ≥2/3 votes must show the winner token
      expect(winnerCount).toBeGreaterThanOrEqual(2);
      // ≥2/3 votes must NOT show the loser token
      expect(loserCleanCount).toBeGreaterThanOrEqual(2);
    },
    60_000,
  ); // 60s for 3 LLM calls
});
