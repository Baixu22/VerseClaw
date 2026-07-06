// Conversation chain evaluation for runtime-memory.
// Pure functions: buildChainScenario produces a turn plan; evaluateChain
// consumes pre-computed diagnostics to derive chain-aware metrics.
// Fills the "turn N does not depend on N-1" gap from Phase 35/36 baseline.
//
// Design note: facts with the same (taskId, subject, predicate) are treated
// as conflicting by the consumer (only one winner survives). To test
// cumulative recall across turns, each turn writes a fact with a unique
// predicate (chain_step_N) and issues one query per cumulative predicate.

import type { RuntimeMemoryTemporalFact } from "../../runtime-core/memory-context.js";
import type { TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics } from "../../runtime-core/task-loop-memory-shadow-diagnostics.js";
import type { MultiTurnQueryPlan } from "./multi-turn-driver.js";

export type ChainTurnPlan = {
  turn: number;
  writeFact: RuntimeMemoryTemporalFact;
  queries: readonly MultiTurnQueryPlan[];
  expectedCumulativeFactIds: readonly string[];
};

export type ChainEvalResult = {
  turns: number;
  perTurn: ReadonlyArray<{
    turn: number;
    recall: number;
    depth: number;
    growthRate: number;
  }>;
  aggregateChainRecall: number;
  maxDepth: number;
  meanGrowthRate: number;
};

export function buildChainScenario(options: {
  turns: number;
  taskId: string;
  baseSubject: string;
  referenceTime: number;
}): readonly ChainTurnPlan[] {
  if (options.turns < 1) {
    throw new Error(`buildChainScenario: turns must be >= 1 (got ${options.turns})`);
  }

  const plans: ChainTurnPlan[] = [];
  const cumulativeFactIds: string[] = [];

  for (let turn = 0; turn < options.turns; turn += 1) {
    const predicate = `chain_step_${turn}`;
    const factId = `${options.baseSubject}_chain_${turn}`;
    cumulativeFactIds.push(factId);

    const writeFact: RuntimeMemoryTemporalFact = {
      schemaVersion: 1,
      factId,
      taskId: options.taskId,
      subject: options.baseSubject,
      predicate,
      objectSummary: `Chain fact ${turn} for ${options.baseSubject}.`,
      confidence: 0.9,
      source: "verifier_summary",
      verificationStatus: "verified",
      valid_at: options.referenceTime,
      reference_time: options.referenceTime,
      acceptedAt: options.referenceTime,
      sourceEpisodeRefs: [
        {
          episodeId: `episode_chain_${turn}`,
          taskId: options.taskId,
          kind: "verifier_summary",
          idempotencyKey: `${options.taskId}:chain:${turn}`,
          reference_time: options.referenceTime,
        },
      ],
      evidenceRefs: [
        {
          type: "test",
          ref: "openclaw_runtime/src/agents/runtime-memory-eval/chain-eval.ts",
        },
      ],
      promotion: {
        promotedBy: "verifier",
        evidenceRefs: [
          {
            type: "test",
            ref: "openclaw_runtime/src/agents/runtime-memory-eval/chain-eval.ts",
          },
        ],
      },
    };

    // One query per cumulative predicate — each query expects exactly 1 fact.
    const queries: MultiTurnQueryPlan[] = [];
    for (let i = 0; i <= turn; i += 1) {
      const prevPredicate = `chain_step_${i}`;
      const prevFactId = `${options.baseSubject}_chain_${i}`;
      queries.push({
        queryId: `chain_query_${turn}_${i}`,
        taskId: options.taskId,
        subject: options.baseSubject,
        predicate: prevPredicate,
        referenceTime: options.referenceTime,
        tokenBudget: 512,
        limit: 4,
        expectedFactIds: [prevFactId],
      });
    }

    plans.push({
      turn,
      writeFact,
      queries,
      expectedCumulativeFactIds: [...cumulativeFactIds],
    });
  }

  return plans;
}

export function evaluateChain(
  scenario: readonly ChainTurnPlan[],
  diagnostics: ReadonlyArray<
    TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics
  >,
): ChainEvalResult {
  if (scenario.length === 0) {
    return {
      turns: 0,
      perTurn: [],
      aggregateChainRecall: 0,
      maxDepth: -1,
      meanGrowthRate: 0,
    };
  }
  if (diagnostics.length !== scenario.length) {
    throw new Error(
      `evaluateChain: diagnostics.length (${diagnostics.length}) must equal scenario.length (${scenario.length})`,
    );
  }

  const perTurn = scenario.map((plan, index) => {
    const diag = diagnostics[index];
    const expectedCount = plan.expectedCumulativeFactIds.length;
    const truePositiveCount = diag.queries.reduce(
      (sum, q) => sum + q.truePositiveCount,
      0,
    );

    // Depth = max chain index among accepted facts across all queries.
    const acceptedChainIndices: number[] = [];
    for (const queryResult of diag.queries) {
      const acceptedIds = new Set(queryResult.acceptedFacts.map((f) => f.factId));
      for (let i = 0; i <= plan.turn; i += 1) {
        const chainFactId = `${plan.queries[0].subject}_chain_${i}`;
        if (acceptedIds.has(chainFactId)) {
          acceptedChainIndices.push(i);
        }
      }
    }
    const depth = acceptedChainIndices.length === 0 ? -1 : Math.max(...acceptedChainIndices);

    const recall = expectedCount === 0 ? 1 : truePositiveCount / expectedCount;

    // growthRate: new hits this turn / new expected this turn (always 1 new fact per turn).
    const prevTruePositive =
      index === 0
        ? 0
        : diagnostics[index - 1].queries.reduce(
            (sum, q) => sum + q.truePositiveCount,
            0,
          );
    const newHits = truePositiveCount - prevTruePositive;
    const newExpected = 1;
    const growthRate = newHits / newExpected;

    return { turn: plan.turn, recall, depth, growthRate };
  });

  const totalHits = perTurn.reduce(
    (sum, t) => sum + t.recall * scenario[t.turn].expectedCumulativeFactIds.length,
    0,
  );
  const totalExpected = perTurn.reduce(
    (sum, t) => sum + scenario[t.turn].expectedCumulativeFactIds.length,
    0,
  );
  const aggregateChainRecall = totalExpected === 0 ? 1 : totalHits / totalExpected;

  const maxDepth = perTurn.reduce((max, t) => (t.depth > max ? t.depth : max), -1);
  const meanGrowthRate = perTurn.reduce((sum, t) => sum + t.growthRate, 0) / perTurn.length;

  return {
    turns: scenario.length,
    perTurn,
    aggregateChainRecall,
    maxDepth,
    meanGrowthRate,
  };
}
