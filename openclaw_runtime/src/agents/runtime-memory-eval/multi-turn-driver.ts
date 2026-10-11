// 30-turn multi-turn TaskLoop driver for runtime-memory evaluation.
// Drives baseline vs treatment arms via ScriptedLlmDriver and
// buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics.

import { performance } from "node:perf_hooks";
import {
  buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
  type TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions,
  type TaskLoopRuntimeMemoryReadHydrationShadowOnlyQuery,
} from "../../runtime-core/task-loop-memory-shadow-diagnostics.js";
import type { ScriptedLlmArm, ScriptedLlmDriver } from "./scripted-llm.js";
import { mean, percentile } from "./statistics.js";

export type MultiTurnArm = ScriptedLlmArm;

export type MultiTurnQueryPlan = {
  queryId: string;
  taskId: string;
  subject: string;
  predicate: string;
  referenceTime: number;
  tokenBudget?: number;
  limit?: number;
  expectedFactIds: readonly string[];
};

export type ArmMetrics = {
  recallAtK: number;
  precision: number;
  latencyMs: number;
  tokenOverhead: number;
  rawLeakRate: number;
  promptInjectionReturnRate: number;
  acceptedFactCount: number;
  rejectedFactCount: number;
};

export type MultiTurnTurnResult = {
  turn: number;
  baseline: ArmMetrics;
  treatment: ArmMetrics;
};

export type MetricSummary = {
  mean: number;
  p50: number;
  p95: number;
  count: number;
};

export type MultiTurnRunResult = {
  turns: MultiTurnTurnResult[];
  aggregateBaseline: Record<keyof ArmMetrics, MetricSummary>;
  aggregateTreatment: Record<keyof ArmMetrics, MetricSummary>;
  totalDurationMs: number;
  turnCount: number;
  queriesPerTurn: number;
};

export type MultiTurnDriverOptions = {
  turns: number;
  queriesPerTurn: number;
  sessionKey: string;
  scriptedLlm: ScriptedLlmDriver;
  baselineDatabasePath: string;
  treatmentDatabasePath: string;
  queries: readonly MultiTurnQueryPlan[];
  config?: unknown;
  baselineOptions: Omit<
    TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions,
    "explicitOptIn" | "testResearchOnly" | "databasePath" | "queries"
  >;
  treatmentOptions: Omit<
    TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions,
    "explicitOptIn" | "testResearchOnly" | "databasePath" | "queries"
  > & {
    breakthroughInjection: {
      enabled: true;
      arm: "treatment";
      acceptedFactsMaxTokens: number;
    };
  };
  loopRunIdPrefix?: string;
};

const DEFAULT_LOOP_RUN_ID_PREFIX = "phase36_multiturn";

const ARM_METRIC_KEYS: ReadonlyArray<keyof ArmMetrics> = [
  "recallAtK",
  "precision",
  "latencyMs",
  "tokenOverhead",
  "rawLeakRate",
  "promptInjectionReturnRate",
  "acceptedFactCount",
  "rejectedFactCount",
];

export function runMultiTurnDriver(
  options: MultiTurnDriverOptions,
): MultiTurnRunResult {
  if (options.turns < 1) {
    throw new Error(`runMultiTurnDriver: turns must be >= 1 (got ${options.turns})`);
  }
  if (options.queriesPerTurn < 1) {
    throw new Error(
      `runMultiTurnDriver: queriesPerTurn must be >= 1 (got ${options.queriesPerTurn})`,
    );
  }
  const requiredQueries = options.turns * options.queriesPerTurn;
  if (options.queries.length < requiredQueries) {
    throw new Error(
      `runMultiTurnDriver: queries.length (${options.queries.length}) must be >= turns * queriesPerTurn (${requiredQueries})`,
    );
  }

  const startedAt = performance.now();
  const loopRunIdPrefix = options.loopRunIdPrefix ?? DEFAULT_LOOP_RUN_ID_PREFIX;

  const turns: MultiTurnTurnResult[] = [];
  for (let turn = 0; turn < options.turns; turn += 1) {
    const turnQueries = options.queries.slice(
      turn * options.queriesPerTurn,
      (turn + 1) * options.queriesPerTurn,
    );

    const baseline = runArm(options, "baseline", turn, turnQueries, loopRunIdPrefix);
    const treatment = runArm(options, "treatment", turn, turnQueries, loopRunIdPrefix);

    turns.push({ turn, baseline, treatment });
  }

  const totalDurationMs = performance.now() - startedAt;

  return {
    turns,
    aggregateBaseline: aggregateArmMetrics(turns.map((t) => t.baseline)),
    aggregateTreatment: aggregateArmMetrics(turns.map((t) => t.treatment)),
    totalDurationMs,
    turnCount: options.turns,
    queriesPerTurn: options.queriesPerTurn,
  };
}

function runArm(
  options: MultiTurnDriverOptions,
  arm: MultiTurnArm,
  turn: number,
  turnQueries: readonly MultiTurnQueryPlan[],
  loopRunIdPrefix: string,
): ArmMetrics {
  // Drive the scripted LLM path to verify integration (response not used by hydration).
  options.scriptedLlm.respondForArm(options.sessionKey, arm);

  const databasePath =
    arm === "baseline" ? options.baselineDatabasePath : options.treatmentDatabasePath;

  const queries: TaskLoopRuntimeMemoryReadHydrationShadowOnlyQuery[] = turnQueries.map(
    (q) => ({
      queryId: q.queryId,
      taskId: q.taskId,
      subject: q.subject,
      predicate: q.predicate,
      referenceTime: q.referenceTime,
      ...(q.tokenBudget !== undefined ? { tokenBudget: q.tokenBudget } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      expectedFactIds: q.expectedFactIds,
    }),
  );

  const armOptions: TaskLoopRuntimeMemoryReadHydrationShadowOnlyOptions =
    arm === "baseline"
      ? {
          ...options.baselineOptions,
          explicitOptIn: true,
          testResearchOnly: true,
          databasePath,
          queries,
        }
      : {
          ...options.treatmentOptions,
          explicitOptIn: true,
          testResearchOnly: true,
          testResearchOnlyBreakthrough: true,
          databasePath,
          queries,
        };

  const diagnostics = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
    config: options.config,
    options: armOptions,
    loopRunId: `${loopRunIdPrefix}_${arm}_turn${turn}`,
    sessionKey: options.sessionKey,
    iteration: turn,
  });

  return extractArmMetrics(diagnostics);
}

function extractArmMetrics(
  diagnostics: ReturnType<typeof buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics>,
): ArmMetrics {
  const metrics = diagnostics.metrics;
  const queries = diagnostics.queries;

  const expectedTotal = sum(queries.map((q) => q.expectedFactIds.length));
  const truePositiveTotal = sum(queries.map((q) => q.truePositiveCount));
  const acceptedTotal = sum(queries.map((q) => q.acceptedFacts.length));
  const rejectedTotal = sum(queries.map((q) => q.rejectedFacts.length));

  return {
    recallAtK: expectedTotal === 0 ? 1 : truePositiveTotal / expectedTotal,
    precision: acceptedTotal === 0 ? 0 : truePositiveTotal / acceptedTotal,
    latencyMs: metrics.latencyOverheadMs,
    tokenOverhead: metrics.tokenOverhead,
    rawLeakRate: metrics.rawLeakRate,
    promptInjectionReturnRate: metrics.promptInjectionReturnRate,
    acceptedFactCount: acceptedTotal,
    rejectedFactCount: rejectedTotal,
  };
}

function aggregateArmMetrics(
  armMetrics: readonly ArmMetrics[],
): Record<keyof ArmMetrics, MetricSummary> {
  const result = {} as Record<keyof ArmMetrics, MetricSummary>;
  for (const key of ARM_METRIC_KEYS) {
    const samples = armMetrics.map((m) => m[key]);
    result[key] = {
      mean: mean(samples),
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      count: samples.length,
    };
  }
  return result;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
