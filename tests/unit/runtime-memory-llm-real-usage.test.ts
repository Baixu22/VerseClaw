// @vitest-environment node
// Layer 3: Real LLM usage verification using DeepSeek API.
// Answers "which memories get used in long conversations" (core) by proving
// that a real LLM references injected memory via unique-token probes + A/B
// ablation (with-memory vs without-memory). Anti-hallucination: unique token
// (Zyxqlwbr-7341 format), A/B attribution, negative assertions, multi-judge vote.
// Anti-overfitting: ground truth is token presence in LLM response (independent
// of consumer design), NOT expectedFactIds. No filterQueriesBySeededGroups.

import { describe, expect, it } from "vitest";
import { createRuntimeMemoryProviderResult } from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import { consumeRuntimeMemoryHydrationFacts } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-consumer";
import type { RuntimeMemoryTemporalFact } from "../../openclaw_runtime/src/runtime-core";
import {
  callDeepSeek,
  callDeepSeekMajorityVote,
  hasDeepSeekKey,
} from "./helpers/runtime-memory-real-llm-client";
import {
  makeProbeFact,
  makeProbeFactSet,
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

type TokenProbeResult = {
  tokenPresent: boolean;
  negativeClean: boolean;
  abAttributable: boolean;
  withMemoryContent: string;
  withoutMemoryContent: string;
};

async function runTokenProbe(
  facts: readonly RuntimeMemoryTemporalFact[],
  query: {
    taskId: string;
    subject: string;
    predicate: string;
    referenceTime: number;
    tokenBudget?: number;
  },
  targetToken: string,
  negativeTokens: readonly string[],
  userQuestion: string,
): Promise<TokenProbeResult> {
  const memoryText = await getMemoryContext(facts, query);
  const promptA = buildProbePrompt(memoryText, userQuestion);
  const resA = await callDeepSeek(promptA.system, promptA.user);
  const promptB = buildProbePrompt("", userQuestion);
  const resB = await callDeepSeek(promptB.system, promptB.user);
  const tokenPresent = resA.content.includes(targetToken);
  const negativeClean = negativeTokens.every((t) => !resA.content.includes(t));
  const abAttributable = tokenPresent && !resB.content.includes(targetToken);
  return {
    tokenPresent,
    negativeClean,
    abAttributable,
    withMemoryContent: resA.content,
    withoutMemoryContent: resB.content,
  };
}

// Skip entire suite when no API key is available — skipped is not failed.
describe.skipIf(!hasDeepSeekKey())("Layer 3: real LLM uses injected memory (DeepSeek)", () => {
  it("single_fact_recall_token_probe", async () => {
    const token = makeUniqueProbeToken(1);
    const { fact } = makeProbeFact({
      factId: "probe_single",
      taskId: "task_single",
      subject: "UserPreference",
      predicate: "preference_code",
      token,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.95,
    });
    const result = await runTokenProbe(
      [fact],
      {
        taskId: "task_single",
        subject: "UserPreference",
        predicate: "preference_code",
        referenceTime: 1000,
      },
      token,
      [],
      "What is the user's preference code? Answer with the code only.",
    );
    expect(result.tokenPresent).toBe(true);
    expect(result.abAttributable).toBe(true);
  });

  it("multi_fact_recall_3_of_5", async () => {
    const probeSet = makeProbeFactSet({
      count: 5,
      taskId: "task_multi",
      subject: "MultiPreference",
      basePredicate: "code",
      seed: 42,
    });
    // Query first 3 facts individually (each has a distinct predicate).
    const targetTokens = probeSet.slice(0, 3).map((p) => p.token);
    const unusedTokens = probeSet.slice(3).map((p) => p.token);

    for (let i = 0; i < 3; i += 1) {
      const probe = probeSet[i];
      const result = await runTokenProbe(
        probeSet.map((p) => p.fact),
        {
          taskId: "task_multi",
          subject: "MultiPreference",
          predicate: probe.fact.predicate,
          referenceTime: 1000,
        },
        probe.token,
        unusedTokens,
        "What is the user's preference code? Answer with the code only.",
      );
      expect(result.tokenPresent).toBe(true);
      expect(result.abAttributable).toBe(true);
      // Negative assertion: unused tokens must not appear in A-arm response.
      expect(result.negativeClean).toBe(true);
    }
    // Sanity: target tokens are distinct from unused tokens.
    expect(targetTokens.some((t) => unusedTokens.includes(t))).toBe(false);
  }, 30_000); // 30s for 6 LLM calls (3 probes × 2 arms)

  it("invalidation_isolation", async () => {
    const tokenValid = makeUniqueProbeToken(10);
    const tokenInvalid = makeUniqueProbeToken(11);
    const { fact: validFact } = makeProbeFact({
      factId: "probe_valid",
      taskId: "task_inval",
      subject: "InvalPreference",
      predicate: "preference_code",
      token: tokenValid,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.9,
    });
    const { fact: invalidatedFact } = makeProbeFact({
      factId: "probe_invalidated",
      taskId: "task_inval",
      subject: "InvalPreference",
      predicate: "preference_code",
      token: tokenInvalid,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.5,
      invalid_at: 50, // invalidated before referenceTime=1000
    });
    const result = await runTokenProbe(
      [validFact, invalidatedFact],
      {
        taskId: "task_inval",
        subject: "InvalPreference",
        predicate: "preference_code",
        referenceTime: 1000,
      },
      tokenValid,
      [tokenInvalid],
      "What is the user's preference code? Answer with the code only.",
    );
    expect(result.tokenPresent).toBe(true);
    expect(result.negativeClean).toBe(true); // invalidated token must not appear
    expect(result.abAttributable).toBe(true);
  });

  it("task_isolation", async () => {
    const tokenA = makeUniqueProbeToken(20);
    const tokenB = makeUniqueProbeToken(21);
    const { fact: factMatch } = makeProbeFact({
      factId: "probe_match",
      taskId: "task_match",
      subject: "TaskPreference",
      predicate: "preference_code",
      token: tokenA,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.9,
    });
    const { fact: factOther } = makeProbeFact({
      factId: "probe_other_task",
      taskId: "task_other",
      subject: "TaskPreference",
      predicate: "preference_code",
      token: tokenB,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.9,
    });
    const result = await runTokenProbe(
      [factMatch, factOther],
      {
        taskId: "task_match",
        subject: "TaskPreference",
        predicate: "preference_code",
        referenceTime: 1000,
      },
      tokenA,
      [tokenB],
      "What is the user's preference code? Answer with the code only.",
    );
    expect(result.tokenPresent).toBe(true);
    expect(result.negativeClean).toBe(true); // non-matching task's token must not appear
    expect(result.abAttributable).toBe(true);
  });

  it("conflict_winner_used", async () => {
    // REAL FINDING: the provider path (createRuntimeMemoryProviderResult)
    // does NOT do conflict resolution — it returns all matching facts sorted
    // by rank. Only the consumer path (consumeRuntimeMemoryHydrationFacts)
    // keeps 1 winner per taskId+subject+predicate. So we use the consumer to
    // pick the winner first, then pass only the winner to the provider/LLM.
    // This mirrors the real hydration pipeline: consumer filters → provider formats.
    const tokenOld = makeUniqueProbeToken(30);
    const tokenNew = makeUniqueProbeToken(31);
    const { fact: factOld } = makeProbeFact({
      factId: "probe_old_conf",
      taskId: "task_conf",
      subject: "ConflictPreference",
      predicate: "preference_code",
      token: tokenOld,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.5,
    });
    const { fact: factNew } = makeProbeFact({
      factId: "probe_new_conf",
      taskId: "task_conf",
      subject: "ConflictPreference",
      predicate: "preference_code",
      token: tokenNew,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.9, // higher confidence wins
    });
    // Step 1: consumer picks the winner (conflict resolution).
    const projections = [factOld, factNew].map((f) => ({
      factId: f.factId,
      recordKind: "fact" as const,
      taskId: f.taskId,
      subject: f.subject,
      predicate: f.predicate,
      objectSummary: f.objectSummary,
      confidence: f.confidence,
      source: f.source,
      verificationStatus: f.verificationStatus,
      valid_at: f.valid_at,
      reference_time: f.reference_time,
      sourceEpisodeRefs: f.sourceEpisodeRefs,
      evidenceRefs: f.evidenceRefs,
    }));
    const consumerResult = consumeRuntimeMemoryHydrationFacts(projections, {
      taskId: "task_conf",
      subject: "ConflictPreference",
      predicate: "preference_code",
      referenceTime: 1000,
      tokenBudget: 256,
      limit: 8,
    });
    expect(consumerResult.acceptedFacts).toHaveLength(1);
    expect(consumerResult.acceptedFacts[0].factId).toBe("probe_new_conf");

    // Step 2: pass only the winner to the provider → LLM.
    const result = await runTokenProbe(
      [factNew],
      {
        taskId: "task_conf",
        subject: "ConflictPreference",
        predicate: "preference_code",
        referenceTime: 1000,
      },
      tokenNew,
      [tokenOld],
      "What is the user's preference code? Answer with the code only.",
    );
    expect(result.tokenPresent).toBe(true);
    expect(result.negativeClean).toBe(true); // loser's token must not appear
    expect(result.abAttributable).toBe(true);
  });

  it("token_budget_truncation_still_usable", async () => {
    const token = makeUniqueProbeToken(40);
    const { fact } = makeProbeFact({
      factId: "probe_budget",
      taskId: "task_budget",
      subject: "BudgetPreference",
      predicate: "preference_code",
      token,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.9,
    });
    // First verify the context still contains the token under tight budget.
    const ctx = await getMemoryContext(
      [fact],
      {
        taskId: "task_budget",
        subject: "BudgetPreference",
        predicate: "preference_code",
        referenceTime: 1000,
        tokenBudget: 64,
      },
    );
    expect(ctx).toContain(token);
    // Then verify the LLM can still use the truncated context.
    const result = await runTokenProbe(
      [fact],
      {
        taskId: "task_budget",
        subject: "BudgetPreference",
        predicate: "preference_code",
        referenceTime: 1000,
        tokenBudget: 64,
      },
      token,
      [],
      "What is the user's preference code? Answer with the code only.",
    );
    expect(result.tokenPresent).toBe(true);
    expect(result.abAttributable).toBe(true);
  });

  it("no_hallucination_of_uninjected_facts", async () => {
    const tokenReal = makeUniqueProbeToken(50);
    const tokenFake = makeUniqueProbeToken(51);
    const { fact } = makeProbeFact({
      factId: "probe_real",
      taskId: "task_halluc",
      subject: "HallucPreference",
      predicate: "preference_code",
      token: tokenReal,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.95,
    });
    // User question mentions tokenFake — LLM must NOT hallucinate it.
    // LLM must use the actual memory (tokenReal).
    const result = await runTokenProbe(
      [fact],
      {
        taskId: "task_halluc",
        subject: "HallucPreference",
        predicate: "preference_code",
        referenceTime: 1000,
      },
      tokenReal,
      [tokenFake],
      `Is the user's preference code ${tokenFake}? If not, what is it? Answer with the code only.`,
    );
    expect(result.tokenPresent).toBe(true);
    expect(result.negativeClean).toBe(true); // fake token must not appear
    expect(result.abAttributable).toBe(true);
  });

  it("multi_judge_vote_consistency", async () => {
    const token = makeUniqueProbeToken(60);
    const { fact } = makeProbeFact({
      factId: "probe_vote",
      taskId: "task_vote",
      subject: "VotePreference",
      predicate: "preference_code",
      token,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.95,
    });
    const memoryText = await getMemoryContext(
      [fact],
      {
        taskId: "task_vote",
        subject: "VotePreference",
        predicate: "preference_code",
        referenceTime: 1000,
      },
    );
    const prompt = buildProbePrompt(
      memoryText,
      "What is the user's preference code? Answer with the code only.",
    );
    const vote = await callDeepSeekMajorityVote(prompt.system, prompt.user, 3, {
      
      maxTokens: 64,
    });
    const tokenAppearances = vote.responses.filter((r) =>
      r.content.includes(token),
    ).length;
    // Anti-hallucination: ≥2/3 judges must agree the token is present.
    expect(tokenAppearances).toBeGreaterThanOrEqual(2);
  });
});
