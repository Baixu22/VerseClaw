// Budget pressure evaluation for runtime-memory.
// Pure functions: buildBudgetPressureScenario produces per-level query plans;
// evaluateBudgetPressure consumes pre-computed diagnostics to derive recall
// degradation, rejection counts, and token utilization across budget levels.
// Fills the "no token budget pressure measurement" gap from Phase 35/36.
//
// Design note: the consumer's conflict resolution keeps only ONE winner per
// (taskId, subject, predicate). A single query therefore accepts at most 1
// fact. To measure budget pressure across multiple facts, each fact gets a
// unique subject so queries do not conflict. Each budget level issues one
// query per fact with that level's tokenBudget/limit.

import type { RuntimeMemoryTemporalFact } from "../../runtime-core/memory-context.js";
import type { TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics } from "../../runtime-core/task-loop-memory-shadow-diagnostics.js";
import type { MultiTurnQueryPlan } from "./multi-turn-driver.js";

export type BudgetLevel = {
  tokenBudget: number;
  limit: number;
  label: string;
};

export type BudgetPressureScenario = {
  facts: readonly RuntimeMemoryTemporalFact[];
  levels: readonly BudgetLevel[];
  // Flattened queries: levels[i] owns queries[i * factCount .. (i+1) * factCount - 1].
  queries: readonly MultiTurnQueryPlan[];
  factCount: number;
};

export type BudgetLevelResult = {
  tokenBudget: number;
  limit: number;
  label: string;
  recall: number;
  acceptedFactCount: number;
  rejectedByBudgetCount: number;
  rejectedByLimitCount: number;
  totalEstimatedTokens: number;
  tokenUtilization: number;
};

export type BudgetPressureResult = {
  perLevel: ReadonlyArray<BudgetLevelResult>;
  budgetElasticity: number;
  kneePoint: number;
  maxRecall: number;
  minRecall: number;
};

const DEFAULT_BUDGET_LEVELS: readonly BudgetLevel[] = [
  { tokenBudget: 256, limit: 8, label: "ample" },
  { tokenBudget: 128, limit: 8, label: "comfortable" },
  { tokenBudget: 64, limit: 8, label: "moderate" },
  { tokenBudget: 32, limit: 8, label: "tight" },
  { tokenBudget: 16, limit: 8, label: "scarce" },
  { tokenBudget: 8, limit: 8, label: "extreme" },
];

export function buildBudgetPressureScenario(options: {
  factCount: number;
  taskId: string;
  referenceTime: number;
  levels?: readonly BudgetLevel[];
}): BudgetPressureScenario {
  if (options.factCount < 1) {
    throw new Error(
      `buildBudgetPressureScenario: factCount must be >= 1 (got ${options.factCount})`,
    );
  }

  const levels = options.levels ?? DEFAULT_BUDGET_LEVELS;
  const facts: RuntimeMemoryTemporalFact[] = [];
  const queries: MultiTurnQueryPlan[] = [];

  for (let i = 0; i < options.factCount; i += 1) {
    const subject = `BudgetSubject_${i}`;
    const predicate = "budget_predicate";
    const factId = `budget_fact_${i}`;

    const fact: RuntimeMemoryTemporalFact = {
      schemaVersion: 1,
      factId,
      taskId: options.taskId,
      subject,
      predicate,
      objectSummary: `Budget fact ${i} for pressure testing.`,
      confidence: 0.9,
      source: "verifier_summary",
      verificationStatus: "verified",
      valid_at: options.referenceTime,
      reference_time: options.referenceTime,
      acceptedAt: options.referenceTime,
      sourceEpisodeRefs: [
        {
          episodeId: `episode_budget_${i}`,
          taskId: options.taskId,
          kind: "verifier_summary",
          idempotencyKey: `${options.taskId}:budget:${i}`,
          reference_time: options.referenceTime,
        },
      ],
      evidenceRefs: [
        {
          type: "test",
          ref: "openclaw_runtime/src/agents/runtime-memory-eval/budget-pressure-eval.ts",
        },
      ],
      promotion: {
        promotedBy: "verifier",
        evidenceRefs: [
          {
            type: "test",
            ref: "openclaw_runtime/src/agents/runtime-memory-eval/budget-pressure-eval.ts",
          },
        ],
      },
    };
    facts.push(fact);
  }

  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const level = levels[levelIndex];
    for (let i = 0; i < options.factCount; i += 1) {
      const factId = `budget_fact_${i}`;
      queries.push({
        queryId: `budget_q_l${levelIndex}_f${i}`,
        taskId: options.taskId,
        subject: facts[i].subject,
        predicate: facts[i].predicate,
        referenceTime: options.referenceTime,
        tokenBudget: level.tokenBudget,
        limit: level.limit,
        expectedFactIds: [factId],
      });
    }
  }

  return { facts, levels, queries, factCount: options.factCount };
}

export function evaluateBudgetPressure(
  scenario: BudgetPressureScenario,
  diagnostics: ReadonlyArray<
    TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics
  >,
): BudgetPressureResult {
  const { levels, factCount } = scenario;
  const expectedPerLevel = factCount;

  const expectedTotalQueries = levels.length * factCount;
  if (diagnostics.length !== expectedTotalQueries) {
    throw new Error(
      `evaluateBudgetPressure: diagnostics.length (${diagnostics.length}) must equal levels × factCount (${expectedTotalQueries})`,
    );
  }

  const perLevel: BudgetLevelResult[] = [];
  let diagIndex = 0;

  for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
    const level = levels[levelIndex];
    let truePositive = 0;
    let acceptedCount = 0;
    let rejectedByBudget = 0;
    let rejectedByLimit = 0;
    let totalTokens = 0;

    for (let i = 0; i < factCount; i += 1) {
      const diag = diagnostics[diagIndex];
      diagIndex += 1;
      const queryResult = diag.queries[0];
      if (!queryResult) continue;

      truePositive += queryResult.truePositiveCount;
      acceptedCount += queryResult.acceptedFacts.length;
      totalTokens += queryResult.metrics.estimatedTokens;

      for (const rejected of queryResult.rejectedFacts) {
        if (rejected.reason === "token_budget_exceeded") {
          rejectedByBudget += 1;
        } else if (rejected.reason === "limit_exceeded") {
          rejectedByLimit += 1;
        }
      }
    }

    const recall = expectedPerLevel === 0 ? 1 : truePositive / expectedPerLevel;
    const totalBudget = level.tokenBudget * factCount;
    const tokenUtilization = totalBudget === 0 ? 0 : totalTokens / totalBudget;

    perLevel.push({
      tokenBudget: level.tokenBudget,
      limit: level.limit,
      label: level.label,
      recall,
      acceptedFactCount: acceptedCount,
      rejectedByBudgetCount: rejectedByBudget,
      rejectedByLimitCount: rejectedByLimit,
      totalEstimatedTokens: totalTokens,
      tokenUtilization,
    });
  }

  const recalls = perLevel.map((r) => r.recall);
  const maxRecall = recalls.length > 0 ? Math.max(...recalls) : 0;
  const minRecall = recalls.length > 0 ? Math.min(...recalls) : 0;

  const budgetElasticity = linearRegressionSlope(
    perLevel.map((r) => r.tokenBudget),
    recalls,
  );

  let kneePoint = 0;
  for (const r of perLevel) {
    if (r.recall < 0.5) {
      kneePoint = r.tokenBudget;
      break;
    }
  }

  return {
    perLevel,
    budgetElasticity,
    kneePoint,
    maxRecall,
    minRecall,
  };
}

function linearRegressionSlope(
  xs: readonly number[],
  ys: readonly number[],
): number {
  if (xs.length < 2) return 0;
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}
